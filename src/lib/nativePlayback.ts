import { registerPlugin, Capacitor } from '@capacitor/core';
import { notificationPermissionAsync, requestNotificationPermission } from './notifications';

// Feature (Persistent playback notification): thin JS-side wrapper around
// the custom native plugin (android/app/src/main/java/com/melophile/app/
// PlaybackNotificationPlugin.java) that shows/updates the foreground-
// service notification with play/pause/skip controls. See that file and
// PlaybackForegroundService.java's header comments for the full picture --
// this file's only job is to hide the platform check and artwork
// conversion from player.ts.
//
// registerPlugin() resolves to a no-op/rejecting stub on web (there's no
// matching web implementation registered), which is fine -- every call
// site in player.ts already gates on Capacitor.isNativePlatform() first,
// so these methods are never actually invoked outside the native build.

export interface PlaybackNotificationMeta {
  title: string;
  artist: string;
  album?: string;
  /** A blob: or data: URL, as already used for MediaSession artwork
   *  elsewhere in player.ts -- convertArtworkToDataUrl() below normalizes
   *  it to a data: URL, since a blob: URL is only resolvable inside this
   *  WebView's own process and means nothing to the native Service. */
  artworkUrl?: string;
  isPlaying: boolean;
}

export type PlaybackControl = 'play' | 'pause' | 'next' | 'previous';

interface PlaybackNotificationPlugin {
  start(meta: PlaybackNotificationMeta): Promise<void>;
  update(meta: PlaybackNotificationMeta): Promise<void>;
  stop(): Promise<void>;
  addListener(eventName: 'action', listenerFunc: (data: { control: PlaybackControl }) => void): Promise<{ remove: () => void }>;
}

const NativePlaybackNotification = registerPlugin<PlaybackNotificationPlugin>('PlaybackNotification');

export const isNativePlayback = () => Capacitor.isNativePlatform();

/** Converts a blob: URL (what MediaSession artwork already is elsewhere in
 *  player.ts) into a data: URL the native side can actually decode. Small
 *  images only (album art thumbnails) -- this reads the whole blob into
 *  memory, which is fine at that size but wouldn't be for anything larger. */
async function blobUrlToDataUrl(blobUrl: string): Promise<string | undefined> {
  try {
    const res = await fetch(blobUrl);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

async function toNativeMeta(meta: PlaybackNotificationMeta): Promise<PlaybackNotificationMeta> {
  if (!meta.artworkUrl || !meta.artworkUrl.startsWith('blob:')) return meta;
  const dataUrl = await blobUrlToDataUrl(meta.artworkUrl);
  return { ...meta, artworkUrl: dataUrl };
}

// FIX (missing media control notification in the APK): startPlaybackNotification
// used to call straight through to the native plugin, silently assuming
// POST_NOTIFICATIONS was already granted. The only place that permission
// actually got requested was the separate "Background notifications"
// toggle in Settings -- which defaults off and has nothing to do with
// "press play". Since a persistent playback notification is core to how
// background audio works reliably on Android (not an optional status
// alert like the sleep-timer/import-failure notifications), it needs its
// own permission request, triggered by the thing a person actually does
// (starts playing music) rather than a settings toggle they'd have to go
// find first. `askedThisSession` keeps this to one system prompt per app
// launch even if the person denies it and keeps playing songs.
let askedThisSession = false;
async function ensureNotificationPermission(): Promise<boolean> {
  const current = await notificationPermissionAsync();
  if (current === 'granted') return true;
  if (askedThisSession) return false;
  askedThisSession = true;
  const result = await requestNotificationPermission();
  return result === 'granted';
}

export async function startPlaybackNotification(meta: PlaybackNotificationMeta): Promise<void> {
  if (!isNativePlayback()) return;
  const granted = await ensureNotificationPermission();
  if (!granted) return; // foreground service promotion still happens on the native side even without a visible notification -- see PlaybackForegroundService -- so playback still gets the background-reliability benefit even if the person declines to see the notification itself.
  try { await NativePlaybackNotification.start(await toNativeMeta(meta)); } catch (e) { console.warn('Native playback notification start failed', e); }
}

export async function updatePlaybackNotification(meta: PlaybackNotificationMeta): Promise<void> {
  if (!isNativePlayback()) return;
  if ((await notificationPermissionAsync()) !== 'granted') return;
  try { await NativePlaybackNotification.update(await toNativeMeta(meta)); } catch (e) { console.warn('Native playback notification update failed', e); }
}

export async function stopPlaybackNotification(): Promise<void> {
  if (!isNativePlayback()) return;
  try { await NativePlaybackNotification.stop(); } catch (e) { console.warn('Native playback notification stop failed', e); }
}

/** Registers the listener for notification button taps -- call once, e.g.
 *  from App.tsx alongside the other player.on* wiring. Returns the same
 *  unsubscribe handle Capacitor's addListener normally does; a no-op
 *  unsubscribe on web. */
export function onPlaybackNotificationAction(cb: (control: PlaybackControl) => void): () => void {
  if (!isNativePlayback()) return () => {};
  let handle: { remove: () => void } | null = null;
  NativePlaybackNotification.addListener('action', (data) => cb(data.control))
    .then((h) => { handle = h; })
    .catch((e) => console.warn('Failed to register playback notification listener', e));
  return () => { handle?.remove(); };
}
