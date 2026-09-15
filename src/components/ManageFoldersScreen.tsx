import { useMemo, useState } from 'react';
import { ChevronLeft, Folder, Trash2 } from 'lucide-react';
import type { Song } from '../types';

interface Props {
  songs: Song[];
  accentColor: string;
  onDeleteFolder: (folderSongs: Song[]) => void | Promise<void>;
  onClose: () => void;
}

interface FolderGroup { path: string; songs: Song[]; totalSize: number }

const UNKNOWN_FOLDER = '(no folder — added individually)';

function formatSize(bytes: number): string {
  if (bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

/** Groups the library by `importFolder` (set at import time from
 *  `webkitRelativePath` — see scanner.ts/fsAccess.ts). Songs predating this
 *  field, or added via a picker that doesn't carry folder info, fall into
 *  a single "(no folder)" bucket rather than being dropped from the list. */
function groupByFolder(songs: Song[]): FolderGroup[] {
  const map = new Map<string, Song[]>();
  for (const s of songs) {
    const key = s.importFolder || UNKNOWN_FOLDER;
    const arr = map.get(key);
    if (arr) arr.push(s); else map.set(key, [s]);
  }
  return [...map.entries()]
    .map(([path, songs]) => ({ path, songs, totalSize: songs.reduce((sum, s) => sum + (s.fileSize || 0), 0) }))
    .sort((a, b) => b.songs.length - a.songs.length);
}

export function ManageFoldersScreen({ songs, accentColor, onDeleteFolder, onClose }: Props) {
  const groups = useMemo(() => groupByFolder(songs), [songs]);
  const [confirming, setConfirming] = useState<FolderGroup | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleConfirmDelete = async () => {
    if (!confirming) return;
    setDeleting(true);
    await onDeleteFolder(confirming.songs);
    setDeleting(false);
    setConfirming(null);
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col animate-fade-in" style={{ background: 'rgb(var(--bg-rgb))' }}>
      <div className="flex items-center gap-3 px-4 pt-4 pb-3 shrink-0">
        <button onClick={onClose} className="btn-icon w-9 h-9 hover:bg-fg/10 rounded-full -ml-1.5">
          <ChevronLeft size={22} className="text-fg" />
        </button>
        <h2 className="text-fg font-bold text-lg">Manage Folders</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-[184px] md:pb-8">
        {groups.length === 0 ? (
          <p className="text-fg/30 text-sm py-16 text-center">Your library is empty.</p>
        ) : (
          <>
            <p className="text-fg/30 text-xs mb-3 px-1">
              {groups.length} folder{groups.length !== 1 ? 's' : ''} · {songs.length} song{songs.length !== 1 ? 's' : ''} total
            </p>
            <div className="space-y-1.5">
              {groups.map((g) => (
                <div key={g.path} className="flex items-center gap-3 rounded-xl px-3 py-3" style={{ background: 'rgb(var(--fg-rgb) / 0.04)', border: '1px solid rgb(var(--fg-rgb) / 0.06)' }}>
                  <span className="flex items-center justify-center w-9 h-9 rounded-lg shrink-0" style={{ background: `${accentColor}1c` }}>
                    <Folder size={16} style={{ color: accentColor }} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-fg/90 text-sm font-medium truncate">{g.path}</p>
                    <p className="text-fg/35 text-xs mt-0.5">
                      {g.songs.length} song{g.songs.length !== 1 ? 's' : ''} · {formatSize(g.totalSize)}
                    </p>
                  </div>
                  <button onClick={() => setConfirming(g)}
                    className="btn-icon w-8 h-8 rounded-full text-fg/30 hover:text-red-400 hover:bg-red-400/10 shrink-0" title="Remove this folder's songs">
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(var(--glass-blur-sm))' }}
          onMouseDown={(e) => { if (e.currentTarget === e.target && !deleting) setConfirming(null); }}>
          <div className="w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-slide-up"
            style={{ background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))', border: '1px solid rgb(var(--fg-rgb) / var(--glass-border-alpha))', boxShadow: 'var(--shadow-panel)' }}>
            <h3 className="text-fg font-bold text-lg mb-2">Remove {confirming.songs.length} song{confirming.songs.length !== 1 ? 's' : ''}?</h3>
            <p className="text-fg/50 text-sm mb-5 leading-snug truncate">
              Every song imported from "{confirming.path}" will be removed from your library. This can't be undone — the original files on disk aren't affected.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirming(null)} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-fg/5 hover:bg-fg/10 text-fg/70 text-sm transition-colors disabled:opacity-50">Cancel</button>
              <button onClick={handleConfirmDelete} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-500/90 hover:bg-red-500 text-fg font-semibold text-sm transition-colors disabled:opacity-60">
                {deleting ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
