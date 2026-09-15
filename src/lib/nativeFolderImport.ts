import { FilePicker } from '@capawesome/capacitor-file-picker';
import { Filesystem } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { AUDIO_EXTENSIONS } from '../types';

// FIX (missing "USE THIS FOLDER" button in the APK): the app's only
// folder-picking mechanism was <input type="file" webkitdirectory>, which
// depends on Android WebView correctly mapping that HTML attribute to its
// own Storage Access Framework folder picker -- support for this is
// notoriously inconsistent across Android versions/OEM WebView builds
// (unlike in the full Chrome browser app), and evidently broken/incomplete
// on whatever's actually running the APK, since the picker's confirm
// button never appeared.
//
// This bypasses that entirely: @capawesome/capacitor-file-picker's
// pickDirectory() launches Android's Intent.ACTION_OPEN_DOCUMENT_TREE
// directly via startActivityForResult (verified by reading its actual
// Android source in node_modules, not just its docs) -- the real system
// folder picker, always complete with its "USE THIS FOLDER" button,
// completely independent of WebView's HTML-input quirks. @capacitor/
// filesystem then walks the returned tree and reads each file, since
// pickDirectory() only returns a directory reference, not its contents.
//
// KNOWN LIMITATION: pickDirectory()'s underlying native code (also
// verified by reading its source) never calls
// ContentResolver#takePersistableUriPermission -- the granted access only
// lasts for the current app session. That's fine for a one-off "Import
// folder" or "Rescan library" action (which is what this file is wired
// into), but it means this path can't be reused for Auto Rescan's
// "silently re-check on every app open, forever" use case the way the web
// build's File System Access API handle can. Auto Rescan stays
// unavailable on native for now -- see App.tsx's autoRescan gating.

export const isNativeFolderPickerAvailable = () => Capacitor.isNativePlatform();

const EXT_TO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.opus': 'audio/opus', '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.aiff': 'audio/aiff', '.aif': 'audio/aiff',
};

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i === -1 ? '' : name.slice(i).toLowerCase();
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Recursively walks a picked SAF tree via Filesystem.readdir, reading
 *  every audio file's bytes into a real File object. Crucially, each File
 *  gets a hand-set `webkitRelativePath` (normally a read-only property the
 *  browser sets itself for <input webkitdirectory> results) so every
 *  existing piece of import logic that reads it -- folder-path metadata
 *  inference (scanner.ts), Manage Folders' grouping, missing-file
 *  detection on rescan -- keeps working completely unchanged, as if these
 *  files had come from the browser's own directory input. */
async function walkAndCollect(
  uri: string, rootName: string, relPath: string, out: File[], onProgress?: (found: number) => void,
): Promise<void> {
  const { files } = await Filesystem.readdir({ path: uri });
  for (const entry of files) {
    const entryRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
    if (entry.type === 'directory') {
      await walkAndCollect(entry.uri, rootName, entryRelPath, out, onProgress);
      continue;
    }
    const ext = extOf(entry.name);
    if (!AUDIO_EXTENSIONS.includes(ext)) continue;
    try {
      const { data } = await Filesystem.readFile({ path: entry.uri });
      const bytes = base64ToBytes(data as string);
      const file = new File([bytes], entry.name, { type: EXT_TO_MIME[ext] ?? 'application/octet-stream', lastModified: entry.mtime });
      Object.defineProperty(file, 'webkitRelativePath', { value: `${rootName}/${entryRelPath}`, writable: false });
      out.push(file);
      onProgress?.(out.length);
    } catch (e) {
      console.warn('Native folder import: failed to read', entry.name, e);
      // Skipped, not fatal -- importFiles()'s own per-file error handling
      // covers files that fail to *parse*; this covers files that fail to
      // even be *read* off disk, which is rarer but should degrade the
      // same way (skip that one file, keep going) rather than aborting
      // the whole folder.
    }
  }
}

export interface NativeFolderPickResult { files: File[]; folderName: string }

/** Opens the real system folder picker and returns every audio file found
 *  inside, recursively. Returns null if the person cancels. */
export async function pickNativeFolder(onProgress?: (found: number) => void): Promise<NativeFolderPickResult | null> {
  let path: string;
  try {
    const result = await FilePicker.pickDirectory();
    path = result.path;
  } catch {
    return null; // cancelled, or picker failed -- either way, nothing to import
  }
  // SAF tree URIs look like ".../tree/primary%3AMusic" -- decode and take
  // whatever's after the last ':' as a human-readable folder name (falls
  // back to the raw last path segment for non-primary-storage volumes,
  // which use a different, less friendly encoding).
  const decoded = decodeURIComponent(path);
  const lastSegment = decoded.split('/').pop() ?? 'Folder';
  const rootName = lastSegment.includes(':') ? lastSegment.split(':').pop()! : lastSegment;

  const files: File[] = [];
  await walkAndCollect(path, rootName || 'Folder', '', files, onProgress);
  return { files, folderName: rootName || 'Folder' };
}
