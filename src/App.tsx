import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Search, X, FolderOpen, Loader as Loader2, Heart, Trash2, Menu, Music as MusicIcon, TrendingUp, RefreshCw, Plus,
  ChevronLeft, ArrowUpDown, CheckSquare, ListPlus, FolderPlus, Shuffle, Pencil, Download,
} from 'lucide-react';

import { Onboarding } from './components/Onboarding';
import { Sidebar } from './components/Sidebar';
import { SongRow, invalidateArt } from './components/SongRow';
import { AlphaScrollBar } from './components/AlphaScrollBar';
import { VirtualList, type VirtualListHandle } from './components/VirtualList';
import { PlayerBar } from './components/PlayerBar';
import { SettingsPanel } from './components/SettingsPanel';
import { ManageFoldersScreen } from './components/ManageFoldersScreen';
import { AlbumArtEditModal } from './components/AlbumArtEditModal';
import { EditTagsModal } from './components/EditTagsModal';
import { SongEQModal } from './components/SongEQModal';
import { QueuePanel } from './components/QueuePanel';
import { StatsScreen } from './components/StatsScreen';
import { AddSongsModal } from './components/AddSongsModal';
import { ArtistsGrid, AlbumsGrid } from './components/BrowseGrid';
import { LyricsModal } from './components/LyricsModal';
import { MetadataHealthScreen } from './components/MetadataHealthScreen';
import { SmartPlaylistModal } from './components/SmartPlaylistModal';
import { evaluateSmartPlaylist } from './lib/smartPlaylist';
import { getDominantColor } from './lib/dominantColor';
import {
  notificationsSupported, notificationPermissionAsync, requestNotificationPermission, showBackgroundNotification,
} from './lib/notifications';

import { usePlayer } from './hooks/usePlayer';
import { useVisualViewportRect } from './hooks/useVisualViewportRect';
import { player } from './lib/player';
import { EQ_FLAT, type EQBandKey, type EQState } from './lib/eqPresets';
import {
  getAllSongs, getLikedIds, setLiked as dbSetLiked,
  getPinnedIds, setPinned as dbSetPinned,
  getPlaylists, savePlaylist, deletePlaylist as dbDeletePlaylist,
  getPreferences, savePreferences,
  recordHistoryEntry, incrementPlayCount, getHistory, clearHistory,
  deleteSong as dbDeleteSong,
  clearAllSongs,
  updateSongsBatch,
  exportLibraryBackup, importLibraryBackup, type LibraryBackup,
  saveAutoRescanHandle, getAutoRescanHandle,
} from './lib/db';
import { importFiles, getTitleArtistDuplicateIds, rescanMissingArt, folderOf, type ImportProgress, type ArtRescanProgress } from './lib/scanner';
import { analyzeLoudness, type LoudnessProgress } from './lib/loudness';
import { onPlaybackNotificationAction } from './lib/nativePlayback';
import { pickNativeFolder, isNativeFolderPickerAvailable } from './lib/nativeFolderImport';
import {
  supportsFileSystemAccess, pickAutoRescanDirectory, checkReadPermission, requestReadPermission, collectFilesFromHandle,
  type FSDirectoryHandle,
} from './lib/fsAccess';
import { useListeningStats } from './hooks/useListeningStats';
import { primaryArtist } from './lib/artistParser';
import type { AppView, HistoryEntry, LibraryRow, Playlist, Song, SortKey, SmartPlaylistConfig } from './types';
import { DEFAULT_ACCENT, PINNED_HEADER_HEIGHT, ROW_HEIGHTS, type RowSize, type PlayerBarStyle } from './types';
import { getContrastText, resolveAccentColor, isNeutralAccent } from './lib/color';

const artUrlCache = new Map<string, string>();
function getCachedArtUrl(song: Song | null): string | null {
  if (!song?.albumArtData) return null;
  if (artUrlCache.has(song.id)) return artUrlCache.get(song.id)!;
  const url = URL.createObjectURL(new Blob([song.albumArtData], { type: song.albumArtMime || 'image/jpeg' }));
  artUrlCache.set(song.id, url);
  return url;
}

// Feature (Sort options -- Random): deterministic Fisher-Yates shuffle keyed
// off `seed` so the resulting order stays stable across re-renders (query
// changes, playback ticks, etc.) and only reshuffles when the seed itself
// changes -- i.e. each time the user (re-)picks "Random" in the sort menu.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffleSeeded<T>(arr: T[], seed: number): T[] {
  const rand = mulberry32(seed);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// FIX (inconsistent toast dismiss timing): this component used to own its
// own dismiss timer via `useEffect(() => setTimeout(onDone, 3000), [onDone])`.
// `onDone` was passed in as a fresh inline arrow function on every App
// render (`onDone={() => setToast(null)}`), so its identity changed on
// *any* unrelated App re-render (playback progress ticking, listening-stats
// updates, etc.) — not just when a new toast was shown. Every such render
// re-ran the effect, which cancelled the in-flight timer and started a new
// 3000ms one from scratch, so the real dismiss delay depended on how many
// unrelated renders happened to land during that window. The timer is now
// owned by App itself (see `showToast` below) using a ref that isn't tied
// to render identity, so it always fires exactly once at a fixed 1500ms
// and is cancelled/replaced cleanly if a new toast is triggered first. This
// component is now just a dumb, timer-free renderer.
function Toast({ message, accentColor }: { message: string; accentColor: string }) {
  return (
    // FIX (notification hidden behind Player Bar): this offset was last
    // tuned when the mobile Player Bar container was 128px tall
    // (`bottom-36` = 144px gave a 16px gap above it). The bar's mobile
    // height was since bumped to 176px (see the `h-[176px] md:h-[68px]`
    // wrapper around <PlayerBar> below) without updating this, so the
    // toast's 144px offset sat *inside* the bar's 176px again -- the toast
    // rendered underneath/behind the bar and looked like it never showed
    // up. Bumped to clear the current 176px bar with a small gap; desktop's
    // bar is unchanged so its offset is untouched.
    //
    // Feature (More prominent notifications): bigger type, more padding, a
    // glowing accent-colored indicator dot, and an accent-tinted outer glow
    // (in addition to the drop shadow) so it reads as a deliberate status
    // message instead of a barely-there caption.
    <div className="fixed bottom-[192px] md:bottom-24 left-1/2 -translate-x-1/2 z-50 animate-toast-slide-up flex items-center gap-2.5"
      style={{
        background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))',
        backdropFilter: 'blur(var(--glass-blur-md)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))', border: '1px solid rgb(var(--fg-rgb) / 0.12)', borderRadius: 999,
        padding: '12px 22px', color: 'rgb(var(--fg-rgb))', fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap',
        boxShadow: `var(--shadow-toast), 0 0 0 1px ${accentColor}20, 0 0 24px -4px ${accentColor}40`,
      }}>
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: accentColor, boxShadow: `0 0 8px ${accentColor}` }} />
      {message}
    </div>
  );
}

function NewPlaylistModal({ accentColor, onCreated, onClose }: {
  accentColor: string; onCreated: (name: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // FIX (modal centered behind the on-screen keyboard on mobile), now
  // shared: see useVisualViewportRect for the full explanation (this was
  // the original inline version of that fix; AddSongsModal needed the
  // identical logic afterwards, so it's now a shared hook and this just
  // calls it).
  const viewportRect = useVisualViewportRect();

  return (
    /* FIX (modal overlapping/hidden behind the sidebar on mobile): this is
       reachable straight from the "+" button inside the Sidebar itself, so
       it can open while the mobile drawer (App.tsx, `z-[70]`) is still
       open. At the old `z-50` this modal rendered *behind* that drawer
       instead of over it -- only the sliver not covered by the sidebar was
       visible, looking like an overlapping/cut-off card. `z-[1100]` matches
       the convention ConfirmDialog/DeletePlaylistDialog already use below
       for exactly this reason: always above every drawer/overlay in the
       app, not just the ones open at the time this was written. */
    /* FIX (Apple-alert layout kept, but back on the shared Liquid Glass
       tokens): the previous version of this comment hardcoded a flat,
       always-opaque surface here to move away from "glass". That
       overlooked that Liquid Glass is a real, user-facing Settings toggle
       (SettingsPanel.tsx, `liquidGlass`/`data-glass`) driving the
       --glass-* variables every other panel in the app reads from --
       hardcoding this one panel meant the toggle silently stopped doing
       anything here, whichever way the user had it set. Back on
       `--glass-surface-alpha`/`--glass-blur-lg`/etc. like every other
       modal, so this dialog now turns glassy or flat along with the rest
       of the app, in sync with the user's actual setting. The iOS/macOS
       alert *layout* (centered title, divided button row, scale-pop
       entrance) is unrelated to the glass-vs-flat question and stays. */
    <div className="fixed left-0 right-0 z-[1100] flex items-center justify-center px-4"
      style={{ top: viewportRect.top, height: viewportRect.height, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(var(--glass-blur-sm))' }}
      onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="w-72 rounded-[14px] overflow-hidden animate-alert-pop"
        style={{
          background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))',
          backdropFilter: 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))',
          border: '1px solid rgb(var(--fg-rgb) / var(--glass-border-alpha))',
          boxShadow: 'var(--shadow-panel)',
        }}>
        <div className="px-5 pt-5 pb-4">
          <h3 className="text-fg font-semibold text-[17px] text-center mb-4">New Playlist</h3>
          <input ref={inputRef} type="text" placeholder="Playlist name" value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { onCreated(name.trim()); onClose(); } }}
            className="w-full bg-fg/[0.06] border border-fg/10 rounded-[10px] px-3.5 py-2.5 text-fg text-[15px] text-center placeholder-fg/35 focus:outline-none focus:border-fg/25" />
        </div>
        <div className="flex border-t border-fg/10">
          <button onClick={onClose}
            className="flex-1 py-3 text-[15px] text-fg/70 hover:bg-fg/5 active:bg-fg/10 transition-colors">Cancel</button>
          <div className="w-px bg-fg/10" />
          <button onClick={() => { if (name.trim()) { onCreated(name.trim()); onClose(); } }} disabled={!name.trim()}
            className="flex-1 py-3 text-[15px] font-semibold hover:bg-fg/5 active:bg-fg/10 transition-colors disabled:opacity-35 disabled:hover:bg-transparent"
            style={{ color: accentColor }}>Create</button>
        </div>
      </div>
    </div>
  );
}

// Feature (Playlist delete confirmation): mirrors SongRow.tsx's
// DeleteConfirmDialog exactly (same layout/styling/Escape-to-cancel
// behavior) so deleting a playlist gets the same "are you sure" guard that
// deleting a song already has, instead of the previous single-click
// straight-to-delete button.
// Feature (Bulk multi-select delete + Folder re-scan/auto-sync removal):
// generic confirmation dialog, styled to match DeletePlaylistDialog below.
function ConfirmDialog({ title, message, confirmLabel, onCancel, onConfirm }: {
  title: string; message: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(var(--glass-blur-sm))' }}
      onMouseDown={(e) => { if (e.currentTarget === e.target) onCancel(); }}>
      <div className="w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-slide-up"
        style={{ background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))', border: '1px solid rgb(var(--fg-rgb) / var(--glass-border-alpha))', boxShadow: 'var(--shadow-panel)' }}>
        <h3 className="text-fg font-bold text-lg mb-2">{title}</h3>
        <p className="text-fg/50 text-sm mb-5 leading-snug">{message}</p>
        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl bg-fg/5 hover:bg-fg/10 text-fg/70 text-sm transition-colors">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl bg-red-500/90 hover:bg-red-500 text-fg font-semibold text-sm transition-colors">{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// Feature (Import failure report): a dismiss-only panel listing every file
// that couldn't be imported, with its specific error reason -- replaces the
// old "count only, check devtools" experience. Deliberately not a
// ConfirmDialog (no destructive action here, just information), and
// scrollable since a bad rip of an entire album folder could fail dozens
// of files at once.
function ImportFailuresDialog({ failures, onClose }: {
  failures: { fileName: string; reason: string }[]; onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(var(--glass-blur-sm))' }}
      onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="w-full max-w-sm max-h-[70vh] flex flex-col rounded-2xl p-6 shadow-2xl animate-slide-up"
        style={{ background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))', border: '1px solid rgb(var(--fg-rgb) / var(--glass-border-alpha))', boxShadow: 'var(--shadow-panel)' }}>
        <h3 className="text-fg font-bold text-lg mb-1 shrink-0">
          {failures.length} file{failures.length !== 1 ? 's' : ''} couldn't be imported
        </h3>
        <p className="text-fg/50 text-sm mb-4 leading-snug shrink-0">Usually a corrupted file or an unsupported variant of the format.</p>
        <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-1.5 mb-5">
          {failures.map((f, i) => (
            <div key={`${f.fileName}-${i}`} className="rounded-lg px-3 py-2 bg-fg/[0.04]">
              <p className="text-fg/85 text-sm font-medium truncate">{f.fileName}</p>
              <p className="text-fg/40 text-xs truncate mt-0.5">{f.reason}</p>
            </div>
          ))}
        </div>
        <button onClick={onClose} className="w-full py-2.5 rounded-xl bg-fg/5 hover:bg-fg/10 text-fg/70 text-sm transition-colors shrink-0">
          Dismiss
        </button>
      </div>
    </div>
  );
}


// the already-active key, switches to ascending when picking a new one.
// BUG FIX (Sort button doing nothing): this dropdown used to be
// `position: absolute` inside the button's own wrapper (`top-11 right-0`).
// That wrapper sits inside the header's collapsing-header animation
// container (see the `grid-template-rows` + `overflow-hidden` wrapper
// around the toolbar in App.tsx), and that `overflow-hidden` is what clips
// any child that visually extends past the row's own height -- exactly
// what an absolutely-positioned dropdown does. So the button's onClick was
// firing and `open` was correctly flipping to true, but the dropdown
// itself was being clipped to zero visible height, which read as "nothing
// happens" when tapped. Portaling to `document.body` with `fixed`
// coordinates computed from the button's own bounding rect escapes that
// ancestor entirely -- the same fix already used for the Player Bar's
// SleepTimerMenu/PlaybackSpeedMenu popovers, which hit this identical
// clipping problem for the identical reason.
function SortMenu({ sortBy, sortDir, accentColor, onChange }: {
  sortBy: SortKey; sortDir: 'asc' | 'desc'; accentColor: string;
  onChange: (by: SortKey, dir: 'asc' | 'desc') => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const MENU_WIDTH = 176; // w-44

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (menuRef.current && !menuRef.current.contains(target)) setOpen(false);
    };
    setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Recompute position whenever the menu opens, and keep it correct across
  // resizes while it's open (fixed coordinates don't auto-follow the
  // button otherwise).
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
      setMenuPos({ top: rect.bottom + 6, left });
    };
    reposition();
    window.addEventListener('resize', reposition);
    // FIX (menu stuck open while the song list scrolls behind it): this
    // button doesn't move when the list scrolls, so close the menu instead
    // of repositioning it -- matching the same fix on the Player Bar's
    // popovers.
    const scrollClose = () => setOpen(false);
    window.addEventListener('scroll', scrollClose, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', scrollClose, true);
    };
  }, [open]);

  const options: { key: SortKey; label: string }[] = [
    { key: 'title', label: 'Title' }, { key: 'artist', label: 'Artist' },
    { key: 'dateAdded', label: 'Date added' }, { key: 'duration', label: 'Duration' },
    { key: 'random', label: 'Random' },
  ];
  return (
    <div className="relative shrink-0">
      <button ref={btnRef} onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-full bg-fg/5 hover:bg-fg/10 transition-colors text-fg/60">
        <ArrowUpDown size={14} /> Sort
      </button>
      {open && menuPos && createPortal(
        <div ref={menuRef}
          className="fixed w-44 rounded-xl overflow-hidden shadow-2xl border border-fg/10 z-50 p-1 animate-fade-in"
          style={{ top: menuPos.top, left: menuPos.left, background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-md)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))' }}>
          {options.map((opt) => (
            <button key={opt.key}
              onClick={() => {
                // Random has no ascending/descending direction -- every
                // click (including re-clicking while already active) just
                // asks for a fresh shuffle, handled by onChange bumping a
                // seed whenever 'random' is passed.
                onChange(opt.key, opt.key === 'random' ? 'asc' : (opt.key === sortBy ? (sortDir === 'asc' ? 'desc' : 'asc') : 'asc'));
                setOpen(false);
              }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm hover:bg-fg/10 transition-colors"
              style={{ color: sortBy === opt.key ? accentColor : 'rgb(var(--fg-rgb) / 0.75)' }}>
              <span className="flex items-center gap-2">
                {opt.key === 'random' && <Shuffle size={12} />}
                {opt.label}
              </span>
              {sortBy === opt.key && opt.key !== 'random' && <span className="text-xs">{sortDir === 'asc' ? '↑' : '↓'}</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

// Feature (Bulk multi-select actions in the library)
function BulkActionBar({ count, accentColor, onSelectAll, onClear, onQueue, onLike, onAddToPlaylist, onDelete, onCancel }: {
  count: number; accentColor: string;
  onSelectAll: () => void; onClear: () => void; onQueue: () => void;
  onLike: () => void; onAddToPlaylist: () => void; onDelete: () => void; onCancel: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 shrink-0" style={{ borderBottom: '1px solid rgb(var(--fg-rgb) / 0.06)', background: `${accentColor}12` }}>
      <button onClick={onCancel} className="btn-icon w-7 h-7 hover:bg-fg/10 rounded-lg shrink-0" title="Exit selection">
        <X size={15} className="text-fg/60" />
      </button>
      <span className="text-fg text-sm font-semibold shrink-0">{count} selected</span>
      <button onClick={onSelectAll} className="text-xs text-fg/40 hover:text-fg/70 transition-colors shrink-0">Select all</button>
      {count > 0 && <button onClick={onClear} className="text-xs text-fg/40 hover:text-fg/70 transition-colors shrink-0">Clear</button>}
      <div className="ml-auto flex items-center gap-1 shrink-0">
        <button onClick={onQueue} disabled={count === 0} className="btn-icon w-8 h-8 hover:bg-fg/10 rounded-lg disabled:opacity-30" title="Add to queue">
          <ListPlus size={16} className="text-fg/60" />
        </button>
        <button onClick={onLike} disabled={count === 0} className="btn-icon w-8 h-8 hover:bg-fg/10 rounded-lg disabled:opacity-30" title="Like">
          <Heart size={16} className="text-fg/60" />
        </button>
        <button onClick={onAddToPlaylist} disabled={count === 0} className="btn-icon w-8 h-8 hover:bg-fg/10 rounded-lg disabled:opacity-30" title="Add to playlist">
          <FolderPlus size={16} className="text-fg/60" />
        </button>
        <button onClick={onDelete} disabled={count === 0} className="btn-icon w-8 h-8 hover:bg-red-500/15 rounded-lg disabled:opacity-30" title="Delete">
          <Trash2 size={16} className="text-red-400/70" />
        </button>
      </div>
    </div>
  );
}

function DeletePlaylistDialog({ playlist, onCancel, onConfirm }: {
  playlist: Playlist; onCancel: () => void; onConfirm: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(var(--glass-blur-sm))' }}
      onMouseDown={(e) => { if (e.currentTarget === e.target) onCancel(); }}
      onClick={(e) => e.stopPropagation()}>
      <div className="w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-slide-up"
        style={{ background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))', border: '1px solid rgb(var(--fg-rgb) / var(--glass-border-alpha))', boxShadow: 'var(--shadow-panel)' }}>
        <h3 className="text-fg font-bold text-lg mb-2">Delete playlist?</h3>
        <p className="text-fg/50 text-sm mb-5 leading-snug">
          <span className="text-fg/80 font-medium">{playlist.name}</span> ({playlist.songIds.length} {playlist.songIds.length === 1 ? 'song' : 'songs'}) will be permanently deleted. Your songs themselves won't be removed from your library. This can't be undone.
        </p>
        <div className="flex gap-2">
          <button onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl bg-fg/5 hover:bg-fg/10 text-fg/70 text-sm transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-2.5 rounded-xl bg-red-500/90 hover:bg-red-500 text-fg font-semibold text-sm transition-colors">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const playerState = usePlayer();
  const listeningStats = useListeningStats();
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<AppView>('library');
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [accentColor, setAccentColor] = useState(DEFAULT_ACCENT);
  // Feature (Dynamic theming): `accentColor` is the *effective* color shown
  // throughout the app. When autoTheme is on, it tracks the current song's
  // dominant art color instead of the manually-picked one; manualAccentColor
  // remembers the manual pick underneath so turning autoTheme back off (or
  // playing a song with no usable art) restores it instead of getting stuck
  // on whatever the last song's color happened to be.
  const [manualAccentColor, setManualAccentColor] = useState(DEFAULT_ACCENT);
  const [autoTheme, setAutoTheme] = useState(false);
  const [osNotifications, setOsNotifications] = useState(false);
  // Feature (Native Android/Capacitor scaffold): notificationPermission()
  // is synchronous and always returns 'default' on native (Capacitor's
  // permission check is async-only) -- this state holds the real,
  // resolved value for both platforms, refreshed on load and after every
  // permission-affecting action below.
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>('default');
  // Feature (Light/Dark theme toggle): drives `document.documentElement`'s
  // `data-theme` attribute, which every color in the app resolves through
  // (see index.css). Defaults to 'dark' -- the app's original look -- and
  // is overwritten below once saved preferences load.
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  // Feature (Liquid Glass theme toggle): drives `document.documentElement`'s
  // `data-glass` attribute, which every frosted/blurred surface in the app
  // resolves through (see the --glass-* variables in index.css). Defaults
  // to true -- the app's current look -- and is overwritten below once
  // saved preferences load.
  const [liquidGlass, setLiquidGlass] = useState(true);
  // Feature (Row size): controls song row height + thumbnail/text scale
  // across Library, playlists, artist/album views, search, etc.
  const [rowSize, setRowSize] = useState<RowSize>('comfortable');
  // Feature (Minimized Now Playing bar): 'normal' (default) or 'minimized'.
  // Minimized only changes the mobile layout -- desktop always renders the
  // full bar regardless of this setting (see PlayerBar's mobile-only block).
  const [playerBarStyle, setPlayerBarStyle] = useState<PlayerBarStyle>('normal');
  const [toast, setToast] = useState<string | null>(null);
  // FIX (inconsistent toast dismiss timing): a single ref-held timer, not
  // tied to any prop/render identity, guarantees a fixed 1500ms dismiss and
  // guarantees only one timer is ever running — a new toast always clears
  // the previous timer first, so overlapping toasts replace cleanly instead
  // of racing.
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, durationMs = 1500) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }, []);
  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  // FIX (progress bar "sometimes visible sometimes not"): importProgress
  // flips to non-null and back to null in a single synchronous burst when a
  // scan is fast (few new files, or an art-cache-warm rescan) -- fast enough
  // that the browser never paints a frame in between, so the bar mounts and
  // unmounts without ever actually appearing. `visibleImportProgress` mirrors
  // importProgress but, once shown, stays shown for at least
  // MIN_PROGRESS_VISIBLE_MS -- so a fast scan still gets one clean visible
  // pulse instead of sometimes nothing at all. Slow scans are unaffected
  // (they're already visible far longer than the minimum).
  const MIN_PROGRESS_VISIBLE_MS = 500;
  const [visibleImportProgress, setVisibleImportProgress] = useState<ImportProgress | null>(null);
  const progressShownAt = useRef<number | null>(null);
  const progressHideTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (importProgress) {
      if (progressShownAt.current === null) progressShownAt.current = Date.now();
      if (progressHideTimer.current !== undefined) { clearTimeout(progressHideTimer.current); progressHideTimer.current = undefined; }
      setVisibleImportProgress(importProgress);
    } else if (progressShownAt.current !== null) {
      const remaining = Math.max(0, MIN_PROGRESS_VISIBLE_MS - (Date.now() - progressShownAt.current));
      progressHideTimer.current = window.setTimeout(() => {
        setVisibleImportProgress(null);
        progressShownAt.current = null;
        progressHideTimer.current = undefined;
      }, remaining);
    }
  }, [importProgress]);
  useEffect(() => () => { if (progressHideTimer.current !== undefined) clearTimeout(progressHideTimer.current); }, []);
  const [showSettings, setShowSettings] = useState(false);
  const [showManageFolders, setShowManageFolders] = useState(false);

  const [showHealthCheck, setShowHealthCheck] = useState(false);
  const [showQueueModal, setShowQueueModal] = useState(false);
  const [editSong, setEditSong] = useState<Song | null>(null);
  const [editTagsSong, setEditTagsSong] = useState<Song | null>(null);
  const [editSongEQSong, setEditSongEQSong] = useState<Song | null>(null);
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  // Feature (Smart/rule-based playlists): showNewSmartPlaylist opens the
  // editor in create mode; editingSmartPlaylist opens it in edit mode
  // (pre-filled from that playlist's existing name/rules), reached from the
  // "Edit rules" button in a smart playlist's toolbar.
  const [showNewSmartPlaylist, setShowNewSmartPlaylist] = useState(false);
  const [editingSmartPlaylist, setEditingSmartPlaylist] = useState<Playlist | null>(null);
  // Feature (Playlist delete confirmation): holds the playlist awaiting a
  // "are you sure?" before it's actually deleted. Set by requestDeletePlaylist
  // (wired to both the sidebar trash icon and the playlist toolbar's "Delete
  // playlist" button); cleared on cancel or after the dialog's own confirm.
  const [deletingPlaylist, setDeletingPlaylist] = useState<Playlist | null>(null);
  const [newPlaylistSong, setNewPlaylistSong] = useState<Song | null>(null);
  // Drives the AddSongsModal picker opened from the playlist detail
  // toolbar's "Add Songs" button (Task 1). A boolean is enough -- the modal
  // only ever targets whichever playlist is currently open (`currentPlaylist`).
  const [showAddSongs, setShowAddSongs] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Feature (Sort options)
  const [sortBy, setSortBy] = useState<SortKey>('title');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  // Feature (Sort options -- Random): bumped every time "Random" is picked
  // (including re-picking it while already active) to force a fresh
  // shuffle -- see shuffleSeeded() and the `filtered` memo below.
  const [randomSeed, setRandomSeed] = useState(1);
  // Feature (Bulk multi-select actions)
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [showBulkPlaylistMenu, setShowBulkPlaylistMenu] = useState(false);
  const [showBulkNewPlaylist, setShowBulkNewPlaylist] = useState(false);
  // Feature (Lyrics)
  const [showLyrics, setShowLyrics] = useState(false);
  // Feature (consolidated import menu): the header used to show "Import
  // folder" / "Rescan folder" / "Import files" as three always-visible icon
  // buttons, which crowded the header next to search. They're now collapsed
  // behind a single toggle button; clicking it reveals the same three
  // actions in a small dropdown anchored underneath.
  const [showImportMenu, setShowImportMenu] = useState(false);
  const importMenuRef = useRef<HTMLDivElement>(null);
  const importMenuBtnRef = useRef<HTMLButtonElement>(null);
  const importMenuContentRef = useRef<HTMLDivElement>(null);
  const [importMenuPos, setImportMenuPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!showImportMenu) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // BUG FIX (Import menu doing nothing / closing immediately on any
      // click inside it): now that the dropdown itself is portaled to
      // document.body (see below), it's no longer a DOM descendant of
      // importMenuRef, so the old `importMenuRef.current.contains(...)`
      // check alone would treat every click *inside* the menu as an
      // "outside" click and close it before the label/file-input click
      // could register. Checking both the trigger button and the portaled
      // menu content keeps clicks on either of those from closing it.
      if (importMenuRef.current?.contains(target)) return;
      if (importMenuContentRef.current?.contains(target)) return;
      setShowImportMenu(false);
    };
    // Also close on any scroll (song list, page, etc.) — the menu is
    // anchored to the header button rather than the scroll container, so
    // without this it stays open and floats over the list as it scrolls.
    const onScroll = () => setShowImportMenu(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [showImportMenu]);
  // BUG FIX (Import folder button doing nothing): mirrors the SortMenu fix
  // above -- this dropdown used to be `position: absolute` inside a
  // wrapper that sits inside the header's collapsing-header
  // `overflow-hidden` animation container, which silently clipped it to
  // zero visible height. Recomputes `fixed` coordinates from the trigger
  // button's own bounding rect whenever the menu opens (and on resize)
  // so the portaled version below lands in the same visual spot as before.
  useEffect(() => {
    if (!showImportMenu) return;
    const MENU_WIDTH = 208; // w-52
    const reposition = () => {
      const btn = importMenuBtnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8));
      setImportMenuPos({ top: rect.bottom + 8, left });
    };
    reposition();
    window.addEventListener('resize', reposition);
    return () => window.removeEventListener('resize', reposition);
  }, [showImportMenu]);
  const listRef = useRef<VirtualListHandle>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rescanInputRef = useRef<HTMLInputElement>(null);

  // Feature (header pinned at top): the header (Library title + search +
  // import icon) and the toolbar row beneath it (song count + Sort, or the
  // playlist/most-played toolbar) now stay fixed in place at all times
  // instead of collapsing on scroll. The previous collapse-on-scroll
  // animation (a 300ms grid-template-rows transition) changed the song
  // list's available height on every animation frame, and the list's own
  // virtualization had to re-measure and re-render its visible rows in
  // lockstep -- on a large library that read as persistent stutter no
  // amount of throttling fully smoothed out. Removing the animation
  // removes the cause rather than continuing to chase the symptom.
  const listAreaRef = useRef<HTMLDivElement>(null);

  const loadAll = useCallback(async () => {

    const [allSongs, liked, pinned, pls, prefs, hist] = await Promise.all([
      getAllSongs(), getLikedIds(), getPinnedIds(), getPlaylists(), getPreferences(), getHistory(50),
    ]);
    setSongs(allSongs); setLikedIds(liked); setPinnedIds(pinned); setPlaylists(pls);
    // NEUTRAL ACCENT FIX: prefs.accentColor may be the NEUTRAL_ACCENT
    // sentinel rather than a real hex (see lib/color.ts) -- resolve it
    // against the theme being loaded in this same call, not the `theme`
    // state variable, which is still last render's value (its own
    // setTheme call below hasn't committed yet).
    setAccentColor(resolveAccentColor(prefs.accentColor, prefs.theme ?? 'dark')); setManualAccentColor(prefs.accentColor); setHistory(hist); setLoading(false);
    setSortBy(prefs.sortBy ?? 'title'); setSortDir(prefs.sortDir ?? 'asc');
    // Feature (Gapless/Crossfade + Basic EQ): the player module is a
    // singleton created at import time, before preferences have loaded from
    // IndexedDB — seed it here once they're available.
    player.setCrossfadeSeconds(prefs.crossfadeSeconds ?? 0);
    player.setEQAll(prefs.eq ?? EQ_FLAT);
    player.setPlaybackRate(prefs.playbackRate ?? 1);
    player.setPreservePitch(prefs.preservePitch ?? true);
    player.setNormalizeVolume(prefs.normalizeVolume ?? false);
    setAutoTheme(prefs.autoTheme ?? false);
    const perm = await notificationPermissionAsync();
    setNotifPermission(perm);
    setOsNotifications((prefs.osNotifications ?? false) && perm === 'granted');
    setRowSize(prefs.rowSize ?? 'comfortable');
    setPlayerBarStyle(prefs.playerBarStyle ?? 'normal');
    setTheme(prefs.theme ?? 'dark');
    setLiquidGlass(prefs.liquidGlass ?? true);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => { document.documentElement.style.setProperty('--accent-color', accentColor); }, [accentColor]);

  // NEUTRAL ACCENT FIX (live theme-following for "Transparent"): a real
  // hex accent doesn't care about theme, so nothing previously needed to
  // react to `theme` changes here. NEUTRAL_ACCENT does -- its resolved
  // color flips between white and near-black depending on dark/light mode
  // -- so switching theme while it's selected (and autoTheme is off, which
  // owns accentColor otherwise -- see the album-art effect above) needs to
  // re-resolve and update accentColor immediately, not just the next time
  // manualAccentColor itself changes.
  useEffect(() => {
    if (autoTheme) return;
    if (!isNeutralAccent(manualAccentColor)) return;
    setAccentColor(resolveAccentColor(manualAccentColor, theme));
  }, [theme, autoTheme, manualAccentColor]);

  // Feature (Light/Dark theme toggle): every color in the app reads from
  // the --fg-rgb/--bg-rgb/--surface-rgb/--elevated-rgb CSS variables (see
  // index.css), which are scoped under `[data-theme="dark"]` /
  // `[data-theme="light"]`. Setting the attribute here is the one place
  // that actually flips the whole app's palette.
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  // Feature (Liquid Glass theme toggle): every frosted/blurred surface in
  // the app reads from the --glass-* CSS variables (see index.css), scoped
  // under `[data-glass="on"]` / `[data-glass="off"]`. Setting the attribute
  // here is the one place that actually turns the glass effect on or off
  // app-wide.
  useEffect(() => { document.documentElement.setAttribute('data-glass', liquidGlass ? 'on' : 'off'); }, [liquidGlass]);

  // ── Listening time tracking: accumulate minutes while audio is actually playing ──
  useEffect(() => {
    if (playerState.isPlaying) {
      listeningStats.startSession();
    } else {
      listeningStats.stopSession();
    }
    // Make sure we don't leave a dangling open session if the tab/app closes mid-play.
    return () => { listeningStats.stopSession(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerState.isPlaying]);

  // ── "Recently Played" history: logged as soon as a song starts playing ──
  useEffect(() => {
    player.onPlayStart = async (song) => {
      await recordHistoryEntry(song.id);
      const entry: HistoryEntry = { id: `${song.id}-${Date.now()}`, songId: song.id, playedAt: Date.now() };
      setHistory((prev) => [entry, ...prev].slice(0, 50));
    };
    return () => { player.onPlayStart = null; };
  }, []);

  // ── Play count tracking (TASK 3): only counts once the listener has
  // actually heard at least 75% of the song, fired by player.ts's
  // onThresholdReached — see that file for the continuous-session guard
  // that stops scrubbing back/forward from double-counting a single listen. ──
  useEffect(() => {
    player.onThresholdReached = async (song) => {
      await incrementPlayCount(song.id);
      // Update local song state so UI (Stats, Library play-count badge,
      // Most Played view) reflects the new count immediately.
      setSongs((prev) => prev.map((s) => s.id === song.id
        ? { ...s, playCount: (s.playCount ?? 0) + 1, lastPlayedAt: Date.now() } : s));
    };
    return () => { player.onThresholdReached = null; };
  }, []);

  // Feature (Notification gaps): sleep timer completion
  useEffect(() => {
    player.onSleepTimerFired = () => {
      showBackgroundNotification('Melophile', 'Sleep timer ended — playback paused.');
    };
    return () => { player.onSleepTimerFired = null; };
  }, []);

  // Feature (Persistent playback notification): routes taps on the native
  // notification's Play/Pause/Next/Previous buttons to the same player
  // methods the in-app transport controls use -- see lib/nativePlayback.ts
  // and the Android PlaybackNotificationPlugin/PlaybackForegroundService
  // for where these events originate. No-op subscription on web.
  useEffect(() => {
    const unsubscribe = onPlaybackNotificationAction((control) => {
      switch (control) {
        case 'play': case 'pause': player.togglePlay(); break;
        case 'next': player.next(); break;
        case 'previous': player.previous(); break;
      }
    });
    return unsubscribe;
  }, []);

  const getViewSongs = useCallback((): Song[] => {
    if (view === 'library') return songs;
    if (view === 'liked') return songs.filter((s) => likedIds.has(s.id));
    if (view === 'most-played') {
      return [...songs].filter((s) => (s.playCount ?? 0) > 0).sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0)).slice(0, 20);
    }
    if (view === 'queue') return []; // Queue view is handled separately
    if (view === 'stats') return []; // Stats view is handled separately
    // Feature (Browse by Artist/Album): the top-level grids render their own
    // groupings directly from `songs` (see ArtistsGrid/AlbumsGrid), so there's
    // no flat song list for them here; the drill-down detail views below
    // filter to just that artist's/album's tracks.
    if (view === 'artists' || view === 'albums') return [];
    if (typeof view === 'object' && view.type === 'artist') {
      // Matches groupByArtist()'s primaryArtist()-based key (see BrowseGrid) --
      // a song only shows up under the artist it's primarily credited to,
      // not under every featured/guest name also on its Artist tag.
      return songs.filter((s) => primaryArtist(s.artist) === view.name);
    }
    if (typeof view === 'object' && view.type === 'album') {
      // Matches groupByAlbum()'s primaryArtist()-based key (see BrowseGrid) --
      // an exact match against the full raw Artist field would only ever
      // show the one song whose featured-singer credits happen to match
      // `view.artist` verbatim, even though the tile that was tapped to get
      // here now represents the whole album.
      return songs.filter((s) => s.album?.trim() === view.album && primaryArtist(s.artist) === view.artist);
    }
    if (typeof view === 'object' && view.type === 'playlist') {
      const pl = playlists.find((p) => p.id === view.id);
      if (!pl) return [];
      if (pl.smart) return evaluateSmartPlaylist(songs, pl.smart, likedIds);
      const idSet = new Set(pl.songIds);
      return songs.filter((s) => idSet.has(s.id));
    }
    return songs;
  }, [view, songs, likedIds, playlists]);

  const viewSongs = useMemo(() => getViewSongs(), [getViewSongs]);

  // Change (duplicate imports): duplicates are always imported now, so this
  // replaces the old import-time "N duplicates found" prompt with a
  // non-blocking signal shown inline per-row instead (see SongRow's
  // `isDuplicateTitleArtist` prop).
  const dupTitleArtistIds = useMemo(() => getTitleArtistDuplicateIds(songs), [songs]);

  const filtered = useMemo(() => {
    const base = !query.trim() ? viewSongs : (() => {
      const q = query.toLowerCase();
      return viewSongs.filter((s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));
    })();
    // Feature (Sort options): title/asc matches getAllSongs()'s natural
    // IndexedDB ordering already, so skip re-sorting in the (default,
    // common) case — every other combination sorts a copy explicitly.
    if (sortBy === 'title' && sortDir === 'asc') return base;
    // Feature (Sort options -- Random): shuffled separately from the
    // comparator-based sorts below since it has no direction and needs to
    // stay stable across re-renders -- only randomSeed changing should
    // reshuffle it.
    if (sortBy === 'random') return shuffleSeeded(base, randomSeed);
    const cmp: Record<Exclude<SortKey, 'random'>, (a: Song, b: Song) => number> = {
      title: (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
      artist: (a, b) => a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) || a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }),
      dateAdded: (a, b) => a.addedAt - b.addedAt,
      duration: (a, b) => a.duration - b.duration,
    };
    const sorted = [...base].sort(cmp[sortBy]);
    if (sortDir === 'desc') sorted.reverse();
    return sorted;
  }, [viewSongs, query, sortBy, sortDir, randomSeed]);

  // Feature (Pin/Unpin): pinned songs float to the top of the Library and
  // Playlist views specifically (per spec), set off by a "Pinned" section
  // header row -- Liked Songs / Most Played keep their existing ordering
  // (this doesn't touch them; pinning still shows the pin badge there via
  // SongRow's isPinned prop, it just doesn't regroup those two views).
  // `rows` is what VirtualList actually renders (song rows + optional
  // header); `alphaSongs`/`alphaOffset` are the matching inputs for
  // AlphaScrollBar, which needs the same pinned-then-unpinned order plus
  // how many extra rows (the header) sit above the first song.
  const supportsPinnedGrouping = view === 'library' || (typeof view === 'object' && view.type === 'playlist');
  const { rows, alphaSongs, alphaOffset } = useMemo(() => {
    if (!supportsPinnedGrouping || pinnedIds.size === 0) {
      const songRows: LibraryRow[] = filtered.map((song, i) => ({ kind: 'song', song, displayIndex: i }));
      return { rows: songRows, alphaSongs: filtered, alphaOffset: 0 };
    }
    // FIX (pin order): don't derive the pinned list by filtering `filtered`
    // -- that just keeps them in whatever (alphabetical) order they already
    // had. Instead walk `pinnedIds` itself, whose iteration order is pin
    // order (oldest pin first, see db.ts's getPinnedIds/setPinned), and
    // look each song up. That's what makes "first pinned song is first".
    const filteredById = new Map(filtered.map((s) => [s.id, s] as const));
    const pinned = Array.from(pinnedIds)
      .map((id) => filteredById.get(id))
      .filter((s): s is Song => s !== undefined);
    const unpinned = filtered.filter((s) => !pinnedIds.has(s.id));
    const ordered = [...pinned, ...unpinned];
    const songRows: LibraryRow[] = ordered.map((song, i) => ({ kind: 'song', song, displayIndex: i }));
    const rows: LibraryRow[] = pinned.length > 0
      ? [{ kind: 'header', id: '__pinned-header__', label: 'Pinned' }, ...songRows]
      : songRows;
    return { rows, alphaSongs: ordered, alphaOffset: pinned.length > 0 ? 1 : 0 };
  }, [filtered, pinnedIds, supportsPinnedGrouping]);

  useEffect(() => {
    player.setLibrary(songs, viewSongs);
    if (songs.length > 0 && playerState.queue.length === 0) player.initQueue(songs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songs]);

  useEffect(() => {
    player.setLibrary(songs, viewSongs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewSongs]);

  const handlePlay = useCallback(async (song: Song) => { await player.playSong(song, filtered); }, [filtered]);

  const handleLike = useCallback(async (song: Song) => {
    const nowLiked = !likedIds.has(song.id);
    await dbSetLiked(song.id, nowLiked);
    setLikedIds((prev) => { const n = new Set(prev); if (nowLiked) n.add(song.id); else n.delete(song.id); return n; });
    showToast(nowLiked ? `Liked "${song.title}"` : `Removed from Liked Songs`);
  }, [likedIds]);

  // Pin/Unpin (3-dot menu). Mirrors handleLike's persist-then-update-state
  // shape exactly, using the same pattern as the existing Liked Songs
  // toggle -- a dedicated IndexedDB store (see lib/db.ts's 'pinned-songs')
  // plus local Set state. Updating pinnedIds re-derives `rows` below
  // immediately, so the song jumps to/from the Pinned section without a
  // restart.
  const handlePin = useCallback(async (song: Song) => {
    const nowPinned = !pinnedIds.has(song.id);
    await dbSetPinned(song.id, nowPinned);
    setPinnedIds((prev) => { const n = new Set(prev); if (nowPinned) n.add(song.id); else n.delete(song.id); return n; });
    showToast(nowPinned ? `Pinned "${song.title}"` : `Unpinned "${song.title}"`);
  }, [pinnedIds]);

  const handleQueue = useCallback((song: Song) => {
    player.addToQueue(song);
    showToast(`Queued "${song.title}"`);
  }, []);

  const handlePlayFromQueue = useCallback(async (song: Song, index: number) => {
    // BUG FIX (duplicates in queue): removeFromQueue now takes the row's
    // index rather than song.id, so jumping to one copy of a duplicated
    // song only removes that specific queue entry, not every copy of it.
    // (If `index` falls outside the user queue — i.e. this was one of the
    // auto-queued songs after it — removeFromQueue is a no-op, which is
    // correct: those aren't part of the user queue to begin with.)
    player.removeFromQueue(index);
    await player.loadSong(song, true);
    setShowQueueModal(false);
  }, []);

  const handleAddToPlaylist = useCallback(async (song: Song, playlistId: string) => {
    const pl = playlists.find((p) => p.id === playlistId);
    if (!pl || pl.songIds.includes(song.id)) { if (pl) showToast('Already in playlist'); return; }
    const updated = { ...pl, songIds: [...pl.songIds, song.id] };
    await savePlaylist(updated);
    setPlaylists((prev) => prev.map((p) => (p.id === playlistId ? updated : p)));
    showToast(`Added to "${pl.name}"`);
  }, [playlists]);

  // Task 1: bulk-add handler for the new "Add Songs" playlist-toolbar
  // button + AddSongsModal picker. Mirrors handleAddToPlaylist above but
  // takes multiple song ids and performs a single savePlaylist() write
  // instead of one per song -- consistent with the batching approach
  // already used elsewhere in this codebase (see saveSongsBatch in
  // lib/db.ts) to avoid one IndexedDB transaction per item.
  // Data model: persistence reuses the existing Playlist.songIds string[]
  // field and the existing savePlaylist()/IndexedDB 'playlists' store --
  // no new storage layer or dependency was needed since playlist-song
  // membership was already modeled and persisted this way.
  const handleAddSongsToPlaylist = useCallback(async (songIds: string[]) => {
    if (typeof view !== 'object' || view.type !== 'playlist') return;
    const pl = playlists.find((p) => p.id === view.id);
    if (!pl) return;
    // Edge case (duplicates): dedupe against a Set so a song can never
    // appear twice in songIds, even if it was somehow already added
    // (e.g. via the per-song context menu) between opening the picker
    // and confirming the selection.
    const existing = new Set(pl.songIds);
    const toAdd = songIds.filter((id) => !existing.has(id));
    if (toAdd.length === 0) return;
    const updated = { ...pl, songIds: [...pl.songIds, ...toAdd] };
    await savePlaylist(updated);
    setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? updated : p)));
    showToast(`Added ${toAdd.length} song${toAdd.length !== 1 ? 's' : ''} to "${pl.name}"`);
  }, [view, playlists]);

  const handleCreatePlaylist = useCallback(async (name: string, forSong?: Song) => {
    const pl: Playlist = { id: `pl-${Date.now()}-${Math.random().toString(36).slice(2)}`, name, songIds: forSong ? [forSong.id] : [], createdAt: Date.now() };
    await savePlaylist(pl);
    setPlaylists((prev) => [...prev, pl]);
    showToast(`Created "${name}"`);
    return pl;
  }, []);

  // Feature (Smart/rule-based playlists): songIds stays [] -- membership
  // is always computed from `smart` at view time (see getViewSongs above),
  // never persisted as a static id list.
  const handleCreateSmartPlaylist = useCallback(async (name: string, smart: SmartPlaylistConfig) => {
    const pl: Playlist = { id: `pl-${Date.now()}-${Math.random().toString(36).slice(2)}`, name, songIds: [], createdAt: Date.now(), smart };
    await savePlaylist(pl);
    setPlaylists((prev) => [...prev, pl]);
    showToast(`Created "${name}"`);
    setShowNewSmartPlaylist(false);
  }, []);

  const handleUpdateSmartPlaylist = useCallback(async (id: string, name: string, smart: SmartPlaylistConfig) => {
    const pl = playlists.find((p) => p.id === id);
    if (!pl) return;
    const updated = { ...pl, name, smart };
    await savePlaylist(updated);
    setPlaylists((prev) => prev.map((p) => (p.id === id ? updated : p)));
    showToast('Playlist rules updated');
    setEditingSmartPlaylist(null);
  }, [playlists]);

  const handleDeletePlaylist = useCallback(async (id: string) => {
    await dbDeletePlaylist(id);
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
    if (typeof view === 'object' && view.type === 'playlist' && view.id === id) setView('library');
    showToast('Playlist deleted');
  }, [view]);

  // Feature (Playlist delete confirmation): the trash icon / toolbar button
  // now call this instead of handleDeletePlaylist directly -- it just opens
  // the confirm dialog. The dialog's onConfirm is what actually calls
  // handleDeletePlaylist.
  const requestDeletePlaylist = useCallback((id: string) => {
    const pl = playlists.find((p) => p.id === id);
    if (pl) setDeletingPlaylist(pl);
  }, [playlists]);

  const handleRemoveFromPlaylist = useCallback(async (song: Song) => {
    if (typeof view !== 'object' || view.type !== 'playlist') return;
    const pl = playlists.find((p) => p.id === view.id);
    if (!pl) return;
    const updated = { ...pl, songIds: pl.songIds.filter((id) => id !== song.id) };
    await savePlaylist(updated);
    setPlaylists((prev) => prev.map((p) => (p.id === view.id ? updated : p)));
  }, [view, playlists]);

  const handleDeleteSong = useCallback(async (song: Song) => {
    // Remove from IndexedDB (both the song record and its audio blob).
    await dbDeleteSong(song.id, song.fileKey);

    // Drop any cached album-art object URL so it doesn't leak.
    invalidateArt(song.id);
    artUrlCache.delete(song.id);

    // Update local state immediately so the row disappears without a reload.
    setSongs((prev) => prev.filter((s) => s.id !== song.id));

    if (likedIds.has(song.id)) {
      setLikedIds((prev) => { const n = new Set(prev); n.delete(song.id); return n; });
      await dbSetLiked(song.id, false);
    }
    if (pinnedIds.has(song.id)) {
      setPinnedIds((prev) => { const n = new Set(prev); n.delete(song.id); return n; });
      await dbSetPinned(song.id, false);
    }

    // Edge case: the song may still be referenced by one or more playlists.
    // Those stale ids would otherwise linger in storage forever (they're
    // already invisible in playlist views since we filter by the live
    // `songs` list, but we clean them up so the playlist data stays tidy).
    const affected = playlists.filter((p) => p.songIds.includes(song.id));
    if (affected.length > 0) {
      const updated = affected.map((p) => ({ ...p, songIds: p.songIds.filter((id) => id !== song.id) }));
      await Promise.all(updated.map((p) => savePlaylist(p)));
      setPlaylists((prev) => prev.map((p) => updated.find((u) => u.id === p.id) ?? p));
    }

    // Edge case: the song may be currently playing, queued, or up next —
    // player.removeSong() strips it out and advances playback if needed.
    player.removeSong(song.id);

    showToast(`Deleted "${song.title}"`);
  }, [likedIds, pinnedIds, playlists]);

  // "Delete all songs" (Settings → Danger Zone): mirrors handleDeleteSong's
  // cleanup above but for the whole library at once, instead of looping
  // handleDeleteSong per song (which would fire a separate player.removeSong
  // + toast + playlist save for every track — slow and visually noisy for a
  // library of any real size).
  const handleDeleteAllSongs = useCallback(async () => {
    await clearAllSongs();

    // Drop every cached album-art object URL so none of them leak.
    songs.forEach((s) => { invalidateArt(s.id); artUrlCache.delete(s.id); });

    setSongs([]);
    setLikedIds(new Set());
    setPinnedIds(new Set());

    // Playlists no longer reference any songs, but the playlists themselves
    // (their names) are left intact — same "keep the shell, drop the dead
    // ids" behavior as single-song delete.
    if (playlists.some((p) => p.songIds.length > 0)) {
      const updated = playlists.map((p) => ({ ...p, songIds: [] }));
      await Promise.all(updated.map((p) => savePlaylist(p)));
      setPlaylists(updated);
    }

    player.clearAll();
    showToast('Deleted all songs from your library');
  }, [songs, playlists]);

  // "Fix missing album art" (Settings → Library): re-parses the audio blob
  // already stored for every song, using the same extractMeta() import
  // uses. Covers songs imported before an art-parsing bug fix landed (the
  // UTF-16 description bug, the unsynchronisation bug -- see
  // metadataParser.ts's comments) -- those files never get a second look
  // otherwise, since importing only runs once per file. Deliberately scans
  // every song, not just ones with no art data at all: the UTF-16 bug left
  // `albumArtData` populated with corrupted-but-non-empty bytes, so a
  // "missing art" filter would skip right past exactly the songs that need
  // fixing (see rescanMissingArt's comments in scanner.ts).
  const [artRescan, setArtRescan] = useState<(ArtRescanProgress & { running: boolean }) | null>(null);
  const handleRescanArt = useCallback(async () => {
    setArtRescan({ current: 0, total: 0, found: 0, running: true });
    const result = await rescanMissingArt((p) => setArtRescan({ ...p, running: true }));
    // Re-pull from IndexedDB rather than patching state in place -- simplest
    // way to pick up every song rescanMissingArt touched without threading
    // per-song updates back out of it.
    const allSongs = await getAllSongs();
    songs.forEach((s) => { invalidateArt(s.id); artUrlCache.delete(s.id); });
    setSongs(allSongs);
    setArtRescan(null);
    showToast(result.fixed > 0
      ? `Fixed art for ${result.fixed} of ${result.scanned} song${result.scanned === 1 ? '' : 's'}`
      : result.scanned > 0 ? 'No art issues found' : 'Your library is empty');
  }, [songs]);

  // Feature (Loudness normalization)
  const [loudnessScan, setLoudnessScan] = useState<(LoudnessProgress & { running: boolean }) | null>(null);
  const handleAnalyzeLoudness = useCallback(async () => {
    setLoudnessScan({ current: 0, total: 0, analyzed: 0, running: true });
    const result = await analyzeLoudness((p) => setLoudnessScan({ ...p, running: true }));
    const allSongs = await getAllSongs();
    setSongs(allSongs);
    setLoudnessScan(null);
    showToast(result.scanned > 0
      ? `Analyzed ${result.scanned} song${result.scanned === 1 ? '' : 's'}`
      : 'Every song is already analyzed');
  }, []);
  const handleToggleNormalizeVolume = useCallback((on: boolean) => {
    player.setNormalizeVolume(on);
    savePreferences({ normalizeVolume: on });
  }, []);

  // REMOVED: the playlist-toolbar "Like all" bulk-like button and the
  // library-view "Add all to Liked Songs" bulk-like button (and their
  // handlers) have both been removed per request. Individual per-song like
  // buttons (SongRow's `onLike`/`handleLike`) are untouched.

  // Extracted so both the <input webkitdirectory>/file-input change
  // handler AND the native folder-picker path (see handleNativeFolderImport
  // below) can share the exact same import + toast + failure-report logic.
  const runImport = async (fileArr: File[]) => {
    if (!fileArr.length) return;
    setImportProgress({ current: 0, total: fileArr.length, fileName: '' });
    const result = await importFiles(fileArr, setImportProgress);
    setImportProgress(null);
    const allSongs = await getAllSongs();
    setSongs(allSongs);
    // BUG FIX (songs silently missing after import): this used to only ever
    // show `Added ${result.added} songs`, completely ignoring
    // `result.skipped`. Any per-file failure inside importFiles/finalizeOne
    // (a thrown error is caught there, not surfaced) meant a song could
    // just vanish from the import with zero indication -- no toast, no
    // error, nothing visible unless devtools happened to be open reading a
    // console.warn. Onboarding's first-run import screen already surfaced
    // this count; this button (the one used for every import after the
    // first) did not.
    showToast(
      `Added ${result.added} song${result.added !== 1 ? 's' : ''}` +
      (result.skipped > 0 ? `, ${result.skipped} file${result.skipped !== 1 ? 's' : ''} could not be imported` : '')
    );
    if (result.failed.length > 0) setImportFailures(result.failed);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    await runImport(Array.from(files));
    e.target.value = '';
  };

  // FIX (missing "USE THIS FOLDER" button in the APK): native platforms
  // route folder import through @capawesome/capacitor-file-picker instead
  // of the unreliable <input webkitdirectory> -- see
  // lib/nativeFolderImport.ts's header comment for the full story. Wired
  // up in the "Import folder" button below, gated on Capacitor.
  // isNativePlatform() so the web build is completely unaffected.
  const handleNativeFolderImport = async () => {
    setShowImportMenu(false);
    setImportProgress({ current: 0, total: 0, fileName: 'Scanning folder…' });
    try {
      const result = await pickNativeFolder((found) => {
        setImportProgress({ current: found, total: found, fileName: 'Scanning folder…' });
      });
      if (!result) return; // cancelled
      if (result.files.length === 0) { showToast('No audio files found in that folder'); return; }
      await runImport(result.files);
    } finally {
      setImportProgress(null);
    }
  };

  const [rescanning, setRescanning] = useState(false);
  // Feature (Folder re-scan/auto-sync): songs whose folder was covered by
  // the just-reselected batch but whose file is no longer in it -- offered
  // up for removal rather than removed automatically (see the importFolder
  // scoping comment below for why this check is safe to run at all).
  const [removedCandidates, setRemovedCandidates] = useState<Song[] | null>(null);

  // Feature (Import failure report): {fileName, reason} for every file that
  // importFiles couldn't parse/save, from either the manual "Add Songs"
  // flow or a rescan/auto-rescan. Previously this info only ever reached a
  // console.warn -- the toast showed a bare count with no way to see which
  // files or why. Shared across both import entry points below.
  const [importFailures, setImportFailures] = useState<{ fileName: string; reason: string }[] | null>(null);

  // Feature (Auto Rescan): the actual scan-and-import logic, pulled out of
  // the <input webkitdirectory> change handler so it can be driven by *any*
  // File[] source -- the manual picker (below) or a silently-collected
  // File[] from a stored File System Access API directory handle (see
  // runAutoRescan further down). `silent` suppresses the "No new songs
  // found" toast, which would otherwise fire every single time the app
  // auto-rescans and finds nothing new -- expected almost every time,
  // and not something worth interrupting the person for.
  const runRescan = useCallback(async (fileArr0: File[], opts?: { silent?: boolean }) => {
    if (rescanning || fileArr0.length === 0) return;
    const selectedKeys = new Set(fileArr0.map((f) => `${f.name}|${f.size}`));
    // Only folders actually represented in this reselection are eligible for
    // "missing file" detection below -- a song from a folder that simply
    // wasn't part of this particular reselect (e.g. rescanning one album
    // subfolder out of a whole library) must never be flagged as removed.
    const selectedFolders = new Set(fileArr0.map((f) => folderOf(f)));
    const existing = new Set(songs.map((s) => `${s.fileName}|${s.fileSize}`));
    const fileArr = fileArr0.filter((f) => !existing.has(`${f.name}|${f.size}`));
    const skipped = fileArr0.length - fileArr.length;
    const missing = songs.filter((s) =>
      s.importFolder !== undefined && selectedFolders.has(s.importFolder) && !selectedKeys.has(`${s.fileName}|${s.fileSize}`));

    if (fileArr.length === 0) {
      if (!opts?.silent) showToast(`No new songs found (${skipped} already in library)`);
      if (missing.length > 0) setRemovedCandidates(missing);
      return;
    }
    setRescanning(true);
    setImportProgress({ current: 0, total: fileArr.length, fileName: '' });
    try {
      const result = await importFiles(fileArr, setImportProgress);
      const allSongs = await getAllSongs();
      setSongs(allSongs);
      // Success message auto-dismisses after 3s (longer than the default
      // 1.5s toast) so it's easy to read after watching a scan run.
      if (result.added > 0) {
        showToast(`Library updated — ${allSongs.length} song${allSongs.length !== 1 ? 's' : ''} found`, 3000);
        // Feature (OS notifications): the toast above is invisible if the
        // tab isn't focused when a background auto-rescan finishes --
        // showBackgroundNotification only actually displays anything when
        // the tab is hidden, so this is a no-op (not a duplicate) on a
        // manual foreground rescan.
        showBackgroundNotification('Melophile', `Found ${result.added} new song${result.added !== 1 ? 's' : ''}`);
      } else if (!opts?.silent) {
        showToast(`No new songs found (${skipped} already in library)`, 3000);
      }
      // Feature (Import failure report): a rescan/auto-rescan used to fail
      // files just as silently as the original manual import did (see the
      // BUG FIX comment on handleImport above) -- this closes that same gap
      // for the folder-watching path, which is the one most likely to run
      // unattended and therefore the one where silent data loss matters most.
      if (result.failed.length > 0) {
        setImportFailures(result.failed);
        // Feature (Notification gaps): the dialog above only exists once
        // the app is open to see it -- without this, a background rescan
        // that hits a batch of corrupt files gives no signal at all until
        // someone happens to reopen the app and stumbles onto it.
        showBackgroundNotification('Melophile', `${result.failed.length} file${result.failed.length !== 1 ? 's' : ''} couldn't be imported — open the app to see details`);
      }
    } finally {
      setImportProgress(null);
      setRescanning(false);
      if (missing.length > 0) setRemovedCandidates(missing);
    }
  }, [songs, rescanning, showToast]);

  // "Rescan folder" (toolbar, refresh icon): re-select the same folder you
  // originally imported and only the files that aren't in the library yet
  // get added -- everything already imported is skipped instead of being
  // duplicated, unlike the plain "Import folder" button above. This picker-
  // based flow always needs a fresh click (browsers won't let JS trigger a
  // file/directory picker without one) -- see runAutoRescan below for the
  // File System Access API path that avoids that for people who opt in.
  const handleRescanFolder = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const fileArr0 = files?.length ? Array.from(files) : [];
    e.target.value = '';
    if (fileArr0.length > 0) await runRescan(fileArr0);
  };

  // FIX (missing "USE THIS FOLDER" button in the APK): same native
  // folder-picker swap as handleNativeFolderImport above, applied to the
  // "Rescan library" action.
  const handleNativeRescanFolder = async () => {
    setShowImportMenu(false);
    setImportProgress({ current: 0, total: 0, fileName: 'Scanning folder…' });
    try {
      const result = await pickNativeFolder((found) => {
        setImportProgress({ current: found, total: found, fileName: 'Scanning folder…' });
      });
      if (!result) return; // cancelled
      if (result.files.length === 0) { showToast('No audio files found in that folder'); return; }
      await runRescan(result.files);
    } finally {
      setImportProgress(null);
    }
  };

  // Feature (Auto Rescan): silently re-scans a previously-picked directory
  // handle with zero prompts, as long as read permission is still granted --
  // this is what actually removes the need to tap Rescan every time. Kept
  // as a ref-mirrored callback (see runRescanRef below) so the mount/focus
  // effects that call it don't need to be re-subscribed every time `songs`
  // changes (which is what would otherwise force runRescan -- and therefore
  // this -- to be recreated constantly).
  const [autoRescanHandle, setAutoRescanHandle] = useState<FSDirectoryHandle | null>(null);
  // Drives a small "needs permission" banner: browsers don't guarantee a
  // File System Access API grant survives forever (a full browser restart
  // can reset it back to 'prompt'), and re-requesting it requires an actual
  // user gesture -- so when that happens, this asks once instead of just
  // silently going stale forever.
  const [autoRescanNeedsPermission, setAutoRescanNeedsPermission] = useState(false);
  // Feature (Notification gaps): without this, a background auto-rescan
  // hitting an expired permission would call showBackgroundNotification
  // again on every retry (every AUTO_RESCAN_MIN_INTERVAL_MS) for as long as
  // the tab stays hidden -- one notification per lost-permission episode,
  // reset the moment permission is regained, is the right cadence.
  const autoRescanPermissionNotifiedRef = useRef(false);
  const runRescanRef = useRef(runRescan);
  useEffect(() => { runRescanRef.current = runRescan; }, [runRescan]);
  // Throttles auto-triggered rescans (app focus/visibility regain can fire
  // repeatedly in a short span) without limiting explicit ones (enabling it
  // in Settings, or resuming after a permission prompt) -- those pass force.
  const AUTO_RESCAN_MIN_INTERVAL_MS = 60_000;
  const lastAutoRescanAt = useRef(0);
  const runAutoRescan = useCallback(async (handle: FSDirectoryHandle, force = false) => {
    if (!force && Date.now() - lastAutoRescanAt.current < AUTO_RESCAN_MIN_INTERVAL_MS) return;
    const perm = await checkReadPermission(handle);
    if (perm !== 'granted') {
      setAutoRescanNeedsPermission(true);
      // Feature (Notification gaps): previously this just sat in the UI as
      // a banner -- if the tab wasn't open when access expired, syncing
      // silently stalled with zero signal until the app happened to be
      // reopened. showBackgroundNotification already no-ops while the tab
      // is visible, so this is a pure background-only addition.
      if (!autoRescanPermissionNotifiedRef.current) {
        autoRescanPermissionNotifiedRef.current = true;
        showBackgroundNotification('Melophile', 'Folder access expired — reopen the app to reconnect your music folder.');
      }
      return;
    }
    autoRescanPermissionNotifiedRef.current = false;
    setAutoRescanNeedsPermission(false);
    lastAutoRescanAt.current = Date.now();
    try {
      const files = await collectFilesFromHandle(handle);
      await runRescanRef.current(files, { silent: true });
    } catch (e) {
      console.warn('Auto rescan: scan failed', e);
    }
  }, []);

  // Kicks off the first auto-rescan of the session once the initial library
  // load has actually finished (`loading` false) -- not on raw mount, since
  // `songs` is still empty at that point and runRescan would (wrongly) treat
  // every file in the folder as new. `initialAutoRescanDone` makes sure this
  // only ever fires once even though `loading` and `runAutoRescan` are both
  // in the dependency array.
  const initialAutoRescanDone = useRef(false);
  useEffect(() => {
    if (loading || initialAutoRescanDone.current || !supportsFileSystemAccess) return;
    initialAutoRescanDone.current = true;
    (async () => {
      const handle = await getAutoRescanHandle();
      if (handle) {
        setAutoRescanHandle(handle);
        runAutoRescan(handle, true);
      }
    })();
  }, [loading, runAutoRescan]);

  // Re-checks whenever the app regains focus/visibility -- covers "reopened
  // the PWA from the home screen" or "switched back to this tab", which is
  // when new files are actually likely to have shown up, without needing a
  // full page reload to trigger the mount effect above again.
  useEffect(() => {
    if (!autoRescanHandle) return;
    const trigger = () => { if (document.visibilityState === 'visible') runAutoRescan(autoRescanHandle); };
    document.addEventListener('visibilitychange', trigger);
    window.addEventListener('focus', trigger);
    return () => {
      document.removeEventListener('visibilitychange', trigger);
      window.removeEventListener('focus', trigger);
    };
  }, [autoRescanHandle, runAutoRescan]);

  const handleEnableAutoRescan = useCallback(async () => {
    const handle = await pickAutoRescanDirectory();
    if (!handle) return;
    await saveAutoRescanHandle(handle);
    setAutoRescanHandle(handle);
    setAutoRescanNeedsPermission(false);
    showToast('Auto rescan enabled');
    runAutoRescan(handle, true);
  }, [runAutoRescan, showToast]);

  const handleDisableAutoRescan = useCallback(async () => {
    await saveAutoRescanHandle(null);
    setAutoRescanHandle(null);
    setAutoRescanNeedsPermission(false);
    showToast('Auto rescan disabled');
  }, [showToast]);

  const handleResumeAutoRescanPermission = useCallback(async () => {
    if (!autoRescanHandle) return;
    const perm = await requestReadPermission(autoRescanHandle);
    if (perm === 'granted') { setAutoRescanNeedsPermission(false); runAutoRescan(autoRescanHandle, true); }
    else showToast('Permission denied — auto rescan paused');
  }, [autoRescanHandle, runAutoRescan, showToast]);

  const handleConfirmRemoveMissing = useCallback(async () => {
    const toRemove = removedCandidates ?? [];
    setRemovedCandidates(null);
    for (const s of toRemove) await handleDeleteSong(s);
    showToast(`Removed ${toRemove.length} song${toRemove.length !== 1 ? 's' : ''} no longer in that folder`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [removedCandidates]);

  const handleSongUpdated = useCallback((updated: Song) => {
    invalidateArt(updated.id);
    artUrlCache.delete(updated.id);
    setSongs((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    player.patchCurrentSong(updated);
  }, []);

  // Feature (Metadata health check): applies a batch of per-song partial
  // patches (bulk-fill year/genre, copy album art across an album, or an
  // artist-name merge rewriting the Artist field) in one IndexedDB
  // transaction, then folds the same patches into local `songs` state so the
  // health check screen's counts update immediately without a reload.
  const handleBatchPatch = useCallback(async (patches: { id: string; patch: Partial<Song> }[]) => {
    if (patches.length === 0) return;
    await updateSongsBatch(patches);
    const patchById = new Map(patches.map((p) => [p.id, p.patch] as const));
    setSongs((prev) => prev.map((s) => {
      const patch = patchById.get(s.id);
      if (!patch) return s;
      if ('albumArtData' in patch) { invalidateArt(s.id); artUrlCache.delete(s.id); }
      return { ...s, ...patch };
    }));
    showToast(`Updated ${patches.length} song${patches.length !== 1 ? 's' : ''}`);
  }, [showToast]);

  const handleAccentChange = useCallback(async (color: string) => {
    // NEUTRAL ACCENT FIX: `color` may be the NEUTRAL_ACCENT sentinel
    // (user picked "Transparent" in Settings) -- store the raw setting in
    // manualAccentColor/prefs so it round-trips correctly and keeps
    // following theme changes, but resolve it before it reaches
    // `accentColor`, which every other consumer in the app treats as a
    // real, usable hex color.
    setAccentColor(resolveAccentColor(color, theme));
    setManualAccentColor(color);
    await savePreferences({ accentColor: color });
  }, [theme]);

  // Feature (Dynamic theming): toggling on immediately re-derives from
  // whatever's currently playing (the effect below also handles every
  // subsequent song change); toggling off restores the manually-picked
  // color right away rather than leaving the last song's color stuck.
  const handleToggleAutoTheme = useCallback(async (v: boolean) => {
    setAutoTheme(v);
    await savePreferences({ autoTheme: v });
    // NEUTRAL ACCENT FIX: resolve manualAccentColor (may be the
    // NEUTRAL_ACCENT sentinel) before restoring it as the effective color.
    if (!v) setAccentColor(resolveAccentColor(manualAccentColor, theme));
  }, [manualAccentColor, theme]);

  // Feature (Light/Dark theme toggle): passed down to SettingsPanel.
  const handleSetTheme = useCallback(async (t: 'dark' | 'light') => {
    setTheme(t);
    await savePreferences({ theme: t });
  }, []);

  // Feature (Liquid Glass theme toggle): passed down to SettingsPanel.
  const handleToggleLiquidGlass = useCallback(async (v: boolean) => {
    setLiquidGlass(v);
    await savePreferences({ liquidGlass: v });
  }, []);

  // Feature (OS notifications): turning this on is the explicit user
  // action that triggers the actual browser permission prompt -- nothing
  // requests it on page load. If the person denies (or has previously
  // blocked notifications for this site), the toggle stays off and
  // SettingsPanel explains why via notifPermission.
  const handleToggleOSNotifications = useCallback(async () => {
    if (osNotifications) {
      setOsNotifications(false);
      await savePreferences({ osNotifications: false });
      return;
    }
    const perm = await requestNotificationPermission();
    setNotifPermission(perm);
    const granted = perm === 'granted';
    setOsNotifications(granted);
    await savePreferences({ osNotifications: granted });
    if (!granted) showToast('Notifications blocked in browser settings');
  }, [osNotifications, showToast]);

  // Feature (Notification gaps): "Send test notification" button
  const handleSendTestNotification = useCallback(() => {
    showBackgroundNotification('Melophile', "This is what a background notification looks like.", { force: true });
    showToast('Test notification sent');
  }, []);

  // Feature (Row size)
  const handleRowSizeChange = useCallback(async (size: RowSize) => {
    setRowSize(size);
    await savePreferences({ rowSize: size });
  }, []);

  // Feature (Minimized Now Playing bar)
  const handlePlayerBarStyleChange = useCallback(async (style: PlayerBarStyle) => {
    setPlayerBarStyle(style);
    await savePreferences({ playerBarStyle: style });
  }, []);

  // Feature (Sort options)
  const handleSortChange = useCallback((by: SortKey, dir: 'asc' | 'desc') => {
    setSortBy(by); setSortDir(dir);
    if (by === 'random') setRandomSeed((s) => s + 1);
    savePreferences({ sortBy: by, sortDir: dir });
  }, []);

  // Feature (Gapless/Crossfade)
  const handleCrossfadeChange = useCallback((seconds: number) => {
    player.setCrossfadeSeconds(seconds);
    savePreferences({ crossfadeSeconds: seconds });
  }, []);

  // Feature (5-band EQ + presets)
  const handleEQChange = useCallback((band: EQBandKey, db: number) => {
    player.setEQBand(band, db);
    savePreferences({ eq: { ...player.state.eq, [band]: db } });
  }, []);
  const handleEQPreset = useCallback((bands: EQState) => {
    player.setEQAll(bands);
    savePreferences({ eq: bands });
  }, []);

  // Feature (Library backup/restore)
  const handleExportBackup = useCallback(async () => {
    const backup = await exportLibraryBackup();
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `melophile-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Backup exported');
  }, []);

  // Feature (M3U playlist export): unlike the JSON library backup above
  // (Melophile's own format, meant for restoring into Melophile), this
  // exports a single playlist as a standard .m3u8 file any other media
  // player understands. Since songs live in IndexedDB rather than on disk
  // at a stable path, an EXTM3U file referencing real paths isn't possible
  // -- this instead uses the #EXTINF metadata lines (duration, artist,
  // title) as the primary payload, with the original filename as a
  // best-effort path hint for players that happen to have the same files
  // available locally under the same name.
  const handleExportPlaylistM3U = useCallback((playlist: Playlist, playlistSongs: Song[]) => {
    if (playlistSongs.length === 0) { showToast('Nothing to export — playlist is empty'); return; }
    const lines = ['#EXTM3U'];
    for (const s of playlistSongs) {
      lines.push(`#EXTINF:${Math.round(s.duration)},${s.artist} - ${s.title}`);
      lines.push(s.fileName);
    }
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'audio/x-mpegurl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${playlist.name.replace(/[/\\?%*:|"<>]/g, '_')}.m3u8`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Playlist exported as M3U');
  }, []);

  const handleImportBackupFile = useCallback(async (file: File) => {
    const text = await file.text();
    const backup = JSON.parse(text) as LibraryBackup;
    const result = await importLibraryBackup(backup);
    // Refresh everything the import could have touched: liked/pinned status,
    // playlists, preferences (including crossfade/EQ), and play counts.
    const [liked, pinned, pls, prefs, allSongs] = await Promise.all([
      getLikedIds(), getPinnedIds(), getPlaylists(), getPreferences(), getAllSongs(),
    ]);
    setLikedIds(liked); setPinnedIds(pinned); setPlaylists(pls);
    // NEUTRAL ACCENT FIX: same resolution as loadAll above -- `theme`
    // itself isn't touched by a backup restore, so the current state
    // value is accurate here (unlike the initial load).
    setAccentColor(resolveAccentColor(prefs.accentColor, theme)); setManualAccentColor(prefs.accentColor);
    setAutoTheme(prefs.autoTheme ?? false);
    setLiquidGlass(prefs.liquidGlass ?? true);
    const perm = await notificationPermissionAsync();
    setNotifPermission(perm);
    setOsNotifications((prefs.osNotifications ?? false) && perm === 'granted');
    setSortBy(prefs.sortBy ?? 'title'); setSortDir(prefs.sortDir ?? 'asc');
    player.setCrossfadeSeconds(prefs.crossfadeSeconds ?? 0);
    player.setEQAll(prefs.eq ?? EQ_FLAT);
    player.setPlaybackRate(prefs.playbackRate ?? 1);
    player.setPreservePitch(prefs.preservePitch ?? true);
    setSongs(allSongs);
    return result;
  }, [theme]);

  const handleShuffleToggle = useCallback(() => {
    player.setShuffle(playerState.shuffleMode === 'off' ? 'view' : 'off');
  }, [playerState.shuffleMode]);

  const handleClearHistory = useCallback(async () => {
    await clearHistory();
    setHistory([]);
    showToast('History cleared');
  }, []);

  // Feature (Bulk multi-select actions in the library)
  const toggleSelectionMode = useCallback(() => {
    setSelectionMode((v) => !v);
    setSelectedIds(new Set());
  }, []);
  const toggleSongSelected = useCallback((song: Song) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(song.id)) n.delete(song.id); else n.add(song.id);
      return n;
    });
  }, []);
  const selectAllVisible = useCallback(() => setSelectedIds(new Set(filtered.map((s) => s.id))), [filtered]);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const exitSelectionMode = useCallback(() => { setSelectionMode(false); setSelectedIds(new Set()); }, []);

  const selectedSongs = useMemo(() => filtered.filter((s) => selectedIds.has(s.id)), [filtered, selectedIds]);

  const handleBulkAddToQueue = useCallback(() => {
    selectedSongs.forEach((s) => player.addToQueue(s));
    showToast(`Queued ${selectedSongs.length} song${selectedSongs.length !== 1 ? 's' : ''}`);
    exitSelectionMode();
  }, [selectedSongs, exitSelectionMode]);

  const handleBulkLike = useCallback(async () => {
    const toLike = selectedSongs.filter((s) => !likedIds.has(s.id));
    if (toLike.length === 0) { showToast('Already liked'); exitSelectionMode(); return; }
    for (const s of toLike) await dbSetLiked(s.id, true);
    setLikedIds((prev) => { const n = new Set(prev); toLike.forEach((s) => n.add(s.id)); return n; });
    showToast(`Liked ${toLike.length} song${toLike.length !== 1 ? 's' : ''}`);
    exitSelectionMode();
  }, [selectedSongs, likedIds, exitSelectionMode]);

  const handleBulkAddToPlaylist = useCallback(async (playlistId: string) => {
    const pl = playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    const existing = new Set(pl.songIds);
    const toAdd = selectedSongs.map((s) => s.id).filter((id) => !existing.has(id));
    setShowBulkPlaylistMenu(false);
    if (toAdd.length === 0) { showToast('Already in playlist'); exitSelectionMode(); return; }
    const updated = { ...pl, songIds: [...pl.songIds, ...toAdd] };
    await savePlaylist(updated);
    setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? updated : p)));
    showToast(`Added ${toAdd.length} song${toAdd.length !== 1 ? 's' : ''} to "${pl.name}"`);
    exitSelectionMode();
  }, [playlists, selectedSongs, exitSelectionMode]);

  const handleBulkDelete = useCallback(async () => {
    setConfirmBulkDelete(false);
    const toDelete = selectedSongs;
    for (const s of toDelete) await handleDeleteSong(s);
    showToast(`Deleted ${toDelete.length} song${toDelete.length !== 1 ? 's' : ''}`);
    exitSelectionMode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSongs, exitSelectionMode]);

  // Feature (Manage Folders): removes every song from one imported folder
  // at once. Loops handleDeleteSong (same as handleBulkDelete above) so all
  // of its cleanup — art cache, liked/pinned sets, playlist references,
  // player queue — stays correct per song rather than being re-derived here.
  const handleDeleteFolder = useCallback(async (folderSongs: Song[]) => {
    for (const s of folderSongs) await handleDeleteSong(s);
    showToast(`Removed ${folderSongs.length} song${folderSongs.length !== 1 ? 's' : ''}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Feature (Keyboard shortcuts): Space to play/pause, Left/Right to skip
  // tracks, Up/Down for volume, M to mute, L to like the current song.
  // Ignored while typing in any text field (search box, playlist-name
  // input, hex color field, etc.) so plain letters/space still type normally.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          player.togglePlay();
          break;
        case 'ArrowRight':
          player.next(false);
          break;
        case 'ArrowLeft':
          player.previous();
          break;
        case 'ArrowUp':
          e.preventDefault();
          player.setVolume(Math.min(1, Math.round((player.state.volume + 0.1) * 100) / 100));
          break;
        case 'ArrowDown':
          e.preventDefault();
          player.setVolume(Math.max(0, Math.round((player.state.volume - 0.1) * 100) / 100));
          break;
        case 'm': case 'M':
          player.setMuted(!player.state.muted);
          break;
        case 'l': case 'L':
          if (player.state.currentSong) handleLike(player.state.currentSong);
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleLike]);

  const artUrl = useMemo(() => getCachedArtUrl(playerState.currentSong),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [playerState.currentSong?.id, playerState.currentSong?.albumArtData]);

  // Feature (Dynamic theming): re-derives the accent color from the current
  // song's album art whenever autoTheme is on. Deliberately re-runs on
  // every song change (not "live" beyond that -- matches how this was
  // scoped: a per-song theme, not a continuously-sampled one). Falls back
  // to the manually-picked color when there's no art to sample or
  // extraction fails, rather than leaving a stale color from a previous
  // song showing.
  useEffect(() => {
    if (!autoTheme) return;
    // NEUTRAL ACCENT FIX: both fallbacks below used to hand manualAccentColor
    // straight to setAccentColor -- resolving it here covers the case where
    // the underlying manual pick is "Transparent" (the NEUTRAL_ACCENT
    // sentinel) and this song has no usable album art to sample instead.
    if (!artUrl) { setAccentColor(resolveAccentColor(manualAccentColor, theme)); return; }
    let cancelled = false;
    getDominantColor(artUrl).then((color) => {
      if (cancelled) return;
      setAccentColor(color ?? resolveAccentColor(manualAccentColor, theme));
    });
    return () => { cancelled = true; };
  }, [autoTheme, artUrl, manualAccentColor, theme]);

  const currentPlaylist = typeof view === 'object' && view.type === 'playlist' ? playlists.find((p) => p.id === view.id) : null;
  // Feature (Smart/rule-based playlists): manual "add to playlist" pickers
  // (per-song context menu, bulk action bar) only make sense for regular
  // playlists -- a smart playlist's membership is entirely rule-derived, so
  // it's excluded from those lists rather than silently accepting adds that
  // get thrown away on the next open.
  const manualPlaylists = useMemo(() => playlists.filter((p) => !p.smart), [playlists]);
  const playlistCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const songIdSet = new Set(songs.map((s) => s.id));
    for (const pl of playlists) {
      counts[pl.id] = pl.smart ? evaluateSmartPlaylist(songs, pl.smart, likedIds).length : pl.songIds.filter((id) => songIdSet.has(id)).length;
    }
    return counts;
  }, [playlists, songs, likedIds]);
  const viewLabel = view === 'library' ? 'Library'
    : view === 'liked' ? 'Liked Songs'
    : view === 'most-played' ? 'Most Played'
    : view === 'stats' ? 'Stats'
    : view === 'queue' ? 'Queue'
    : view === 'artists' ? 'Artists'
    : view === 'albums' ? 'Albums'
    : (typeof view === 'object' && view.type === 'artist') ? view.name
    : (typeof view === 'object' && view.type === 'album') ? view.album
    : currentPlaylist?.name ?? 'Playlist';

  const isSpecialView = view === 'stats' || view === 'queue' || view === 'artists' || view === 'albums';
  // Feature (Browse by Artist/Album): true for the drill-down detail views
  // reached by tapping a card in the Artists/Albums grid — used to show a
  // back chevron and to skip the sort/select toolbar's title-based A-Z bar.
  const browseBackTarget = typeof view === 'object' && view.type === 'artist' ? 'artists'
    : typeof view === 'object' && view.type === 'album' ? 'albums'
    : null;

  // Build the full upcoming list: manually-queued songs first, then the
  // rest of the playback queue after the current index.
  const upcomingSongs = useMemo(() => {
    const songMap = new Map(songs.map((s) => [s.id, s]));
    const userQ = playerState.userQueue.map((q) => songMap.get(q.id)).filter(Boolean) as Song[];
    const autoQ = playerState.queue
      .slice(playerState.currentIndex + 1)
      .map((q) => songMap.get(q.id))
      .filter(Boolean) as Song[];
    return [...userQ, ...autoQ];
  }, [playerState.userQueue, playerState.queue, playerState.currentIndex, songs]);

  // Songs that came from the manual userQueue (first N items) — these are
  // the only ones that can be removed/reordered via the panel.
  const userQueueLen = playerState.userQueue.length;
  const queuedIds = useMemo(() => new Set(playerState.userQueue.map((s) => s.id)), [playerState.userQueue]);

  if (!loading && songs.length === 0) {
    return (
      <>
        <style>{`:root { --accent-color: ${accentColor}; }`}</style>
        <Onboarding accentColor={accentColor} onComplete={loadAll} />
      </>
    );
  }

  return (
    <>
      <style>{`:root { --accent-color: ${accentColor}; }`}</style>

      <div className="h-full flex flex-col bg-bg overflow-hidden">
        <div className="flex-1 min-h-0 flex overflow-hidden">

          {/* Mobile sidebar overlay */}
          {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/60 md:hidden" onClick={() => setSidebarOpen(false)} />}
          {/* FIX (Settings hidden behind mobile Player Bar): the Player Bar
              sits in normal flow at the bottom with z-[60] (needed so it
              stays above the Queue overlay's z-50 backdrop). The drawer used
              to be z-50, so on mobile the Player Bar rendered on top of it and
              covered "Metadata Health"/"Settings" at the bottom of the nav
              list. Rather than shrinking the drawer to dodge the bar (which
              left the bar visible/tappable behind an open drawer -- not what
              was wanted), the drawer now goes full-height again (`h-full`)
              and outranks the bar with `z-[70]` on mobile, so opening the menu
              covers the whole screen -- Player Bar included -- and every nav
              item is reachable. Desktop keeps its own stacking (`md:z-auto`)
              since the sidebar there is a normal in-flow column, not an
              overlay. */}
          <div className={`fixed md:relative z-[70] md:z-auto w-64 h-full md:h-auto shrink-0 transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
            <Sidebar
              currentView={view}
              onViewChange={(v) => { setView(v); setQuery(''); setSidebarOpen(false); }}
              playlists={playlists}
              playlistCounts={playlistCounts}
              likedCount={likedIds.size}
              accentColor={accentColor}
              queueCount={playerState.userQueue.length}
              onCreatePlaylist={() => setShowNewPlaylist(true)}
              onCreateSmartPlaylist={() => setShowNewSmartPlaylist(true)}
              onDeletePlaylist={requestDeletePlaylist}
              /* FIX (Settings/Metadata Health opening behind the still-open
                  drawer): these two nav items are outside the normal
                  onViewChange path, which is the only place that was closing
                  sidebarOpen. So tapping "Settings" opened the panel but left
                  the mobile drawer sitting on top of it -- and since the
                  drawer is only w-64 wide, the Player Bar (higher z-index
                  than the dimming backdrop) kept peeking through on the
                  uncovered right side too. Closing the drawer here mirrors
                  what onViewChange already does for every other nav item. */
              onOpenSettings={() => { setShowSettings(true); setSidebarOpen(false); }}
              onOpenHealthCheck={() => { setShowHealthCheck(true); setSidebarOpen(false); }}
            />
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            {/* Header + song-list toolbar row are pinned here at all
                times (no more collapse-on-scroll animation -- see the
                comment above listAreaRef for why it was removed). */}
            <div className="shrink-0">
              <div>
            {/* Header */}
            <div className="flex items-center gap-2 px-3 md:px-4 pt-3 pb-2 shrink-0" style={{ borderBottom: '1px solid rgb(var(--fg-rgb) / 0.06)' }}>
              <button className="md:hidden btn-icon w-9 h-9 hover:bg-fg/8 shrink-0" onClick={() => setSidebarOpen(true)}>
                <Menu size={20} className="text-fg/60" />
              </button>
              {browseBackTarget && (
                <button className="btn-icon w-8 h-8 hover:bg-fg/8 shrink-0" onClick={() => setView(browseBackTarget)} title="Back">
                  <ChevronLeft size={19} className="text-fg/50" />
                </button>
              )}
              <h2 className="text-fg font-bold text-base md:text-lg truncate shrink-0 mr-1">{viewLabel}</h2>
              {!isSpecialView && (
                <div className="flex-1 relative max-w-xs ml-auto">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/30" />
                  <input type="text" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)}
                    className="w-full rounded-full pl-8 pr-8 py-2 text-sm text-fg placeholder-fg/30 focus:outline-none transition-colors"
                    style={{ background: 'rgb(var(--fg-rgb) / 0.07)', border: '1px solid rgb(var(--fg-rgb) / 0.09)' }}
                    onFocus={(e) => { e.currentTarget.style.background = 'rgb(var(--fg-rgb) / 0.1)'; e.currentTarget.style.borderColor = 'rgb(var(--fg-rgb) / 0.18)'; }}
                    onBlur={(e) => { e.currentTarget.style.background = 'rgb(var(--fg-rgb) / 0.07)'; e.currentTarget.style.borderColor = 'rgb(var(--fg-rgb) / 0.09)'; }} />
                  {query && <button onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg/30 hover:text-fg/60"><X size={13} /></button>}
                </div>
              )}
              <div className={`${isSpecialView ? 'ml-auto' : ''} flex items-center gap-1 relative`} ref={importMenuRef}>
                {/* Feature (consolidated import menu): single toggle button
                    replaces the three always-visible icon buttons below. */}
                <button
                  ref={importMenuBtnRef}
                  className={`btn-icon w-9 h-9 shrink-0 ${showImportMenu ? 'bg-fg/10' : 'hover:bg-fg/8'}`}
                  title="Import songs"
                  aria-label="Import songs"
                  aria-expanded={showImportMenu}
                  onClick={() => setShowImportMenu(v => !v)}>
                  {rescanning ? <Loader2 size={17} className="text-fg/50 animate-spin" /> : <FolderOpen size={17} className="text-fg/50" />}
                </button>
                {/* Inline scan status, next to the toggle button (Task 2) */}
                {rescanning && visibleImportProgress && (
                  <span className="hidden sm:inline text-fg/50 text-xs whitespace-nowrap animate-fade-in">
                    Scanning… {visibleImportProgress.current} / {visibleImportProgress.total} found
                  </span>
                )}
                {/* BUG FIX (Import folder button doing nothing): portaled to
                    document.body with `fixed` coordinates (importMenuPos,
                    computed above) instead of `position: absolute` inside
                    this row -- see the comment on importMenuPos's effect
                    for why the old absolute version was invisible. */}
                {showImportMenu && importMenuPos && createPortal(
                  <div ref={importMenuContentRef}
                    className="fixed w-52 rounded-xl overflow-hidden shadow-2xl border border-fg/10 z-50 animate-fade-in"
                    style={{ top: importMenuPos.top, left: importMenuPos.left, background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-md)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))' }}>
                    <div className="p-1">
                      {/* Folder import */}
                      <label className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-fg/80 hover:bg-fg/10 text-sm transition-colors cursor-pointer"
                        onClick={(e) => {
                          setShowImportMenu(false);
                          // FIX (missing "USE THIS FOLDER" button in the
                          // APK): native platforms skip the <input
                          // webkitdirectory> below entirely -- see
                          // lib/nativeFolderImport.ts.
                          if (isNativeFolderPickerAvailable()) { e.preventDefault(); handleNativeFolderImport(); }
                        }}>
                        <FolderOpen size={15} className="text-fg/50 shrink-0" /> Import folder
                        <input type="file" ref={folderInputRef}
                          // @ts-expect-error — webkitdirectory is non-standard but widely supported
                          webkitdirectory="" directory="" multiple accept="audio/*" className="hidden" onChange={handleImport} />
                      </label>
                      {/* Rescan folder: re-pick the same folder, only new files get added.
                          Disabled while a scan is already running (Task 2) so a second
                          scan can't be started on top of the first. */}
                      <label
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-fg/80 text-sm transition-colors ${rescanning ? 'opacity-40 pointer-events-none cursor-not-allowed' : 'hover:bg-fg/10 cursor-pointer'}`}
                        aria-disabled={rescanning}
                        onClick={(e) => {
                          setShowImportMenu(false);
                          if (isNativeFolderPickerAvailable()) { e.preventDefault(); handleNativeRescanFolder(); }
                        }}>
                        {rescanning ? <Loader2 size={15} className="text-fg/50 animate-spin shrink-0" /> : <RefreshCw size={15} className="text-fg/50 shrink-0" />}
                        {rescanning ? 'Scanning…' : 'Rescan library'}
                        <input type="file" ref={rescanInputRef} disabled={rescanning}
                          // @ts-expect-error — webkitdirectory is non-standard but widely supported
                          webkitdirectory="" directory="" multiple accept="audio/*" className="hidden" onChange={handleRescanFolder} />
                      </label>
                      {/* Individual file import */}
                      <label className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-fg/80 hover:bg-fg/10 text-sm transition-colors cursor-pointer"
                        onClick={() => setShowImportMenu(false)}>
                        <MusicIcon size={15} className="text-fg/50 shrink-0" /> Import files
                        <input type="file" ref={fileInputRef} multiple accept="audio/*" className="hidden" onChange={handleImport} />
                      </label>
                    </div>
                  </div>,
                  document.body,
                )}
              </div>
            </div>
              </div>
            </div>

            {/* Import / rescan progress.
                FIX (rescan progress not visible): this bar already covered
                the Rescan Folder button (it shares importProgress state with
                regular import), but at 2px tall with no percentage readout
                it was easy to miss entirely, especially on a fast scan or on
                a phone where the inline "Scanning… N found" text next to the
                button is hidden (`hidden sm:inline`, no room for it there).
                Bumped to a proper 6px bar with a percentage, and worded
                specifically as "Scanning" (not "Importing") while it's the
                rescan flow driving it. */}
            {visibleImportProgress && (
              <div className="px-4 py-2.5 shrink-0" style={{ borderBottom: '1px solid rgb(var(--fg-rgb) / 0.05)' }}>
                <div className="flex items-center justify-between gap-2 text-fg/60 text-xs mb-1.5">
                  <span className="flex items-center gap-2 min-w-0">
                    <Loader2 size={12} className="animate-spin shrink-0" style={{ color: accentColor }} />
                    <span className="truncate">
                      {visibleImportProgress.finalizing
                        ? `Saving ${visibleImportProgress.current} / ${visibleImportProgress.total}…`
                        : rescanning
                          ? `Scanning folder… ${visibleImportProgress.current} / ${visibleImportProgress.total}`
                          : visibleImportProgress.fileName ? `Importing ${visibleImportProgress.current} / ${visibleImportProgress.total} — ${visibleImportProgress.fileName}` : `Importing ${visibleImportProgress.current} / ${visibleImportProgress.total}…`}
                    </span>
                  </span>
                  <span className="tabular-nums shrink-0">{Math.round((visibleImportProgress.current / Math.max(visibleImportProgress.total, 1)) * 100)}%</span>
                </div>
                <div className="h-1 bg-fg/10 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(visibleImportProgress.current / Math.max(visibleImportProgress.total, 1)) * 100}%`, background: accentColor }} />
                </div>
              </div>
            )}

            {/* Feature (Auto Rescan): browsers don't guarantee a File System
                Access API permission grant survives forever (a full browser
                restart can reset it to 'prompt'), and re-granting needs an
                actual tap -- this banner is that one tap, shown only when
                it's actually needed instead of on every app open. */}
            {autoRescanNeedsPermission && (
              <div className="px-4 py-2 flex items-center justify-between gap-3 shrink-0"
                style={{ background: `${accentColor}12`, borderBottom: '1px solid rgb(var(--fg-rgb) / 0.05)' }}>
                <span className="flex items-center gap-2 text-fg/70 text-xs min-w-0">
                  <FolderOpen size={13} className="shrink-0" style={{ color: accentColor }} />
                  <span className="truncate">Auto rescan needs permission to keep watching your folder.</span>
                </span>
                <button onClick={handleResumeAutoRescanPermission}
                  className="text-xs font-semibold px-3 py-1 rounded-full shrink-0 transition-opacity hover:opacity-90"
                  style={{ background: accentColor, color: getContrastText(accentColor) }}>
                  Resume
                </button>
              </div>
            )}

            {/* ── STATS VIEW ── */}
            {view === 'stats' ? (
              <StatsScreen songs={songs} history={history} accentColor={accentColor} onClearHistory={handleClearHistory} onPlaySong={handlePlay} listeningStats={listeningStats.stats} sessions={listeningStats.sessions} likedIds={likedIds} />
            ) : view === 'queue' ? (
              /* ── QUEUE VIEW ── */
              <QueuePanel
                queue={upcomingSongs}
                userQueueLen={userQueueLen}
                currentSong={playerState.currentSong}
                isPlaying={playerState.isPlaying}
                onTogglePlay={player.togglePlay}
                accentColor={accentColor}
                onClose={() => setView('library')}
                onPlayFromQueue={handlePlayFromQueue}
                onRemoveFromQueue={(index) => player.removeFromQueue(index)}
                onReorderQueue={(from, to) => player.reorderQueue(from, to)}
                onClearQueue={() => { player.clearQueue(); showToast('Queue cleared'); }}
                onQueueSong={handleQueue}
              />
            ) : view === 'artists' ? (
              /* ── ARTISTS GRID (Feature: Browse by Artist/Album) ── */
              <ArtistsGrid songs={songs} accentColor={accentColor} onSelect={(name) => setView({ type: 'artist', name })} />
            ) : view === 'albums' ? (
              /* ── ALBUMS GRID (Feature: Browse by Artist/Album) ── */
              <AlbumsGrid songs={songs} accentColor={accentColor} onSelect={(album, artist) => setView({ type: 'album', album, artist })} />
            ) : (
              /* ── SONG LIST VIEWS ── */
              <>
                {/* Toolbar row, pinned like the Header above -- only one
                    of the three variants below is ever rendered at a
                    time. */}
                <div className="shrink-0">
                  <div>
                {/* Playlist toolbar */}
                {currentPlaylist && !selectionMode && (
                  <div className="flex items-center gap-2 px-4 py-2 shrink-0" style={{ borderBottom: '1px solid rgb(var(--fg-rgb) / 0.06)' }}>
                    {currentPlaylist.smart ? (
                      // Feature (Smart/rule-based playlists): manual "Add
                      // Songs" doesn't apply -- membership is rule-derived
                      // and gets recomputed every time this view opens, so
                      // instead this reopens the rule editor pre-filled.
                      <button onClick={() => setEditingSmartPlaylist(currentPlaylist)}
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-fg/5 hover:bg-fg/10 transition-colors" style={{ color: accentColor }}>
                        <Pencil size={13} style={{ color: accentColor }} /> Edit rules
                      </button>
                    ) : (
                      /* Task 1: opens the AddSongsModal picker, scoped to
                          whichever playlist is currently open. Replaces the
                          old "Like all" bulk button in this same toolbar slot
                          (Task 2 removed it). */
                      <button onClick={() => setShowAddSongs(true)}
                        className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-fg/5 hover:bg-fg/10 transition-colors" style={{ color: accentColor }}>
                        <Plus size={13} style={{ color: accentColor }} /> Add Songs
                      </button>
                    )}
                    <button onClick={() => requestDeletePlaylist(currentPlaylist.id)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-fg/5 hover:bg-red-500/15 hover:text-red-400 text-fg/50 transition-colors">
                      <Trash2 size={13} /> Delete playlist
                    </button>
                    <button onClick={() => handleExportPlaylistM3U(currentPlaylist, filtered)}
                      className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full bg-fg/5 hover:bg-fg/10 text-fg/50 hover:text-fg transition-colors" title="Export as M3U playlist">
                      <Download size={13} /> Export
                    </button>
                    <span className="text-fg/30 text-xs ml-auto">{filtered.length} songs</span>
                    <button onClick={toggleSelectionMode} className="btn-icon w-7 h-7 hover:bg-fg/10 rounded-lg shrink-0" title="Select songs">
                      <CheckSquare size={14} className="text-fg/40" />
                    </button>
                    <SortMenu sortBy={sortBy} sortDir={sortDir} accentColor={accentColor} onChange={handleSortChange} />
                  </div>
                )}

                {/* Most played header */}
                {view === 'most-played' && !selectionMode && (
                  <div className="px-4 py-2 shrink-0 flex items-center gap-2" style={{ borderBottom: '1px solid rgb(var(--fg-rgb) / 0.06)' }}>
                    <TrendingUp size={14} style={{ color: accentColor }} />
                    <span className="text-fg/40 text-xs">Top 20 songs by play count</span>
                    <span className="text-fg/30 text-xs ml-auto">{filtered.length} songs</span>
                    <button onClick={toggleSelectionMode} className="btn-icon w-7 h-7 hover:bg-fg/10 rounded-lg shrink-0" title="Select songs">
                      <CheckSquare size={14} className="text-fg/40" />
                    </button>
                  </div>
                )}

                {/* Song count (+ bulk action, Library view only) */}
                {!currentPlaylist && view !== 'most-played' && !selectionMode && (
                  <div className="px-4 py-1.5 shrink-0 flex items-center gap-2">
                    <span className="text-fg/25 text-xs">{filtered.length}{filtered.length !== viewSongs.length ? ` of ${viewSongs.length}` : ''} songs</span>
                    <button onClick={toggleSelectionMode} className="btn-icon w-7 h-7 hover:bg-fg/10 rounded-lg shrink-0 ml-auto" title="Select songs">
                      <CheckSquare size={14} className="text-fg/40" />
                    </button>
                    <SortMenu sortBy={sortBy} sortDir={sortDir} accentColor={accentColor} onChange={handleSortChange} />
                  </div>
                )}
                  </div>
                </div>

                {/* Feature (Bulk multi-select actions): replaces whichever
                    toolbar row above would normally be showing. */}
                {selectionMode && (
                  <BulkActionBar
                    count={selectedIds.size}
                    accentColor={accentColor}
                    onSelectAll={selectAllVisible}
                    onClear={clearSelection}
                    onQueue={handleBulkAddToQueue}
                    onLike={handleBulkLike}
                    onAddToPlaylist={() => setShowBulkPlaylistMenu(true)}
                    onDelete={() => setConfirmBulkDelete(true)}
                    onCancel={exitSelectionMode}
                  />
                )}

                {/* Song list + A-Z bar */}
                <div ref={listAreaRef} className="flex-1 min-h-0 flex overflow-hidden">
                  {loading ? (
                    <div className="flex-1 flex items-center justify-center"><Loader2 size={28} className="animate-spin text-fg/20" /></div>
                  ) : filtered.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-fg/25 gap-2">
                      {view === 'liked' ? (
                        <><Heart size={40} className="mb-2 text-fg/15" /><p className="font-medium">No liked songs yet</p><p className="text-xs">Press the heart icon on any song</p></>
                      ) : view === 'most-played' ? (
                        <><TrendingUp size={40} className="mb-2 text-fg/15" /><p className="font-medium">No plays yet</p><p className="text-xs">Play some music to build your stats</p></>
                      ) : (
                        <><FolderOpen size={40} className="mb-2 text-fg/15" /><p className="font-medium">No songs found</p></>
                      )}
                    </div>
                  ) : (
                    <>
                      <VirtualList ref={listRef} items={rows} className="flex-1"
                        getItemHeight={(row) => row.kind === 'header' ? PINNED_HEADER_HEIGHT : ROW_HEIGHTS[rowSize]}
                        renderItem={(row) => row.kind === 'header' ? (
                          <div key={row.id} className="h-full flex items-end px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg/35"
                            style={{ borderBottom: '1px solid rgb(var(--fg-rgb) / 0.06)' }}>
                            {row.label}
                          </div>
                        ) : (
                          <SongRow key={row.song.id} song={row.song} index={row.displayIndex}
                            size={rowSize}
                            isCurrent={playerState.currentSong?.id === row.song.id}
                            isPlaying={playerState.isPlaying}
                            isLiked={likedIds.has(row.song.id)}
                            isPinned={pinnedIds.has(row.song.id)}
                            isQueued={queuedIds.has(row.song.id)}
                            accentColor={accentColor}
                            playlists={manualPlaylists}
                            isInPlaylist={!!currentPlaylist}
                            showPlayCount={view === 'most-played'}
                            isDuplicateTitleArtist={dupTitleArtistIds.has(row.song.id)}
                            onPlay={handlePlay}
                            onLike={handleLike}
                            onPin={handlePin}
                            onQueue={handleQueue}
                            onAddToPlaylist={handleAddToPlaylist}
                            onCreatePlaylist={(s) => { setNewPlaylistSong(s); setShowNewPlaylist(true); }}
                            onEditArt={setEditSong}
                            onEditTags={setEditTagsSong}
                            onEditSongEQ={setEditSongEQSong}
                            onDelete={handleDeleteSong}
                            onRemoveFromPlaylist={currentPlaylist && !currentPlaylist.smart ? handleRemoveFromPlaylist : undefined}
                            onViewQueue={() => setShowQueueModal(true)}
                            selectionMode={selectionMode}
                            isSelected={selectedIds.has(row.song.id)}
                            onToggleSelect={toggleSongSelected}
                          />
                        )} />
                      {/* Feature (Liked Songs A-Z index): previously excluded
                          `view === 'liked'` -- Liked Songs is already sorted
                          alphabetically (it's filtered straight out of the
                          globally alphabetical `songs` array), so the same
                          jump-to-letter bar now applies there too. */}
                      {!query && view !== 'most-played' && <AlphaScrollBar songs={alphaSongs} accentColor={accentColor} listRef={listRef} indexOffset={alphaOffset} />}
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Player Bar */}
        {/* Mobile now uses a taller 3-row expanded layout (art+title / transport
            controls / seek row), so it needs more vertical room than desktop's
            compact single-row 68px bar. */}
        {/* FIX (library rows peeking through the Player Bar's rounded corners
            while the Queue was open): `relative z-[60]` lifts this above the
            Queue overlay's `z-50` backdrop (see the comment on that overlay
            below for the full story), so the bar keeps rendering on top --
            visible and tappable -- while the overlay's dark/blurred backdrop
            fills in uniformly behind the bar's rounded corners instead of the
            library view showing through them. */}
        {/* Feature (Minimized Now Playing bar): minimized only changes the
            mobile height (68px vs the normal 176px) -- the md: desktop
            height (84px) is unaffected either way, since minimized mode is
            mobile-only. Both full class strings are kept literal here (not
            built with string interpolation of the number) so Tailwind's
            JIT scanner picks up both. */}
        <div data-player-bar-root className={`relative z-[60] shrink-0 px-2 pb-2 ${playerBarStyle === 'minimized' ? 'h-[68px] md:h-[84px]' : 'h-[176px] md:h-[84px]'}`}>
          <PlayerBar
            currentSong={playerState.currentSong}
            artUrl={artUrl}
            isPlaying={playerState.isPlaying}
            isLoading={playerState.isLoading}
            currentTime={playerState.currentTime}
            duration={playerState.duration}
            volume={playerState.volume}
            muted={playerState.muted}
            shuffleMode={playerState.shuffleMode}
            accentColor={accentColor}
            queueCount={playerState.userQueue.length}
            theme={theme}
            onPrev={() => player.previous()}
            onNext={() => player.next(false)}
            onTogglePlay={() => player.togglePlay()}
            onSeek={(t) => player.seek(t)}
            onVolume={(v) => player.setVolume(v)}
            onMute={() => player.setMuted(!playerState.muted)}
            onShuffleToggle={handleShuffleToggle}
            onShuffleModeChange={(mode) => player.setShuffle(mode)}
            onOpenQueue={() => setShowQueueModal(true)}
            hasLyrics={!!playerState.currentSong?.lyrics}
            onOpenLyrics={() => setShowLyrics(true)}
            sleepTimerEndsAt={playerState.sleepTimerEndsAt}
            sleepTimerEndOfTrack={playerState.sleepTimerEndOfTrack}
            onSetSleepTimer={(m) => player.setSleepTimer(m)}
            repeatMode={playerState.repeat}
            onSetRepeat={(mode) => player.setRepeat(mode)}
            playbackRate={playerState.playbackRate}
            preservePitch={playerState.preservePitch}
            onSetPlaybackRate={(r) => { player.setPlaybackRate(r); savePreferences({ playbackRate: r }); }}
            onSetPreservePitch={(p) => { player.setPreservePitch(p); savePreferences({ preservePitch: p }); }}
            playerBarStyle={playerBarStyle}
            liquidGlass={liquidGlass}
          />
        </div>
      </div>

      {/* Modals */}
      {showSettings && (
        <SettingsPanel
          accentColor={accentColor}
          manualAccentColor={manualAccentColor}
          onAccentChange={handleAccentChange}
          theme={theme}
          onSetTheme={handleSetTheme}
          liquidGlass={liquidGlass}
          onToggleLiquidGlass={handleToggleLiquidGlass}
          autoTheme={autoTheme}
          onToggleAutoTheme={handleToggleAutoTheme}
          rowSize={rowSize}
          onRowSizeChange={handleRowSizeChange}
          playerBarStyle={playerBarStyle}
          onPlayerBarStyleChange={handlePlayerBarStyleChange}
          osNotifications={osNotifications}
          onToggleOSNotifications={handleToggleOSNotifications}
          onSendTestNotification={handleSendTestNotification}
          notificationsSupported={notificationsSupported()}
          notifPermission={notifPermission}
          onClose={() => setShowSettings(false)}
          songCount={songs.length}
          onDeleteAllSongs={handleDeleteAllSongs}
          onRescanArt={handleRescanArt}
          artRescan={artRescan}
          crossfadeSeconds={playerState.crossfadeSeconds}
          onCrossfadeChange={handleCrossfadeChange}
          eq={playerState.eq}
          onEQChange={handleEQChange}
          onEQPreset={handleEQPreset}
          onExportBackup={handleExportBackup}
          onImportBackupFile={handleImportBackupFile}
          autoRescanSupported={supportsFileSystemAccess}
          autoRescanEnabled={!!autoRescanHandle}
          autoRescanFolderName={autoRescanHandle?.name}
          onEnableAutoRescan={handleEnableAutoRescan}
          onDisableAutoRescan={handleDisableAutoRescan}
          onManageFolders={() => { setShowSettings(false); setShowManageFolders(true); }}
          normalizeVolume={playerState.normalizeVolume}
          onToggleNormalizeVolume={handleToggleNormalizeVolume}
          onAnalyzeLoudness={handleAnalyzeLoudness}
          loudnessScan={loudnessScan}
        />
      )}

      {showManageFolders && (
        <ManageFoldersScreen
          songs={songs}
          accentColor={accentColor}
          onDeleteFolder={handleDeleteFolder}
          onClose={() => setShowManageFolders(false)}
        />
      )}
      {editSong && <AlbumArtEditModal song={editSong} accentColor={accentColor} onClose={() => setEditSong(null)} onUpdated={(u) => { handleSongUpdated(u); setEditSong(null); }} />}
      {editTagsSong && <EditTagsModal song={editTagsSong} accentColor={accentColor} onClose={() => setEditTagsSong(null)} onUpdated={(u) => { handleSongUpdated(u); setEditTagsSong(null); }} />}
      {editSongEQSong && <SongEQModal song={editSongEQSong} globalEQ={playerState.eq} accentColor={accentColor} onClose={() => setEditSongEQSong(null)} onUpdated={(u) => { handleSongUpdated(u); setEditSongEQSong(null); }} />}
      {showNewPlaylist && <NewPlaylistModal accentColor={accentColor} onCreated={(name) => handleCreatePlaylist(name, newPlaylistSong ?? undefined)} onClose={() => { setShowNewPlaylist(false); setNewPlaylistSong(null); }} />}
      {/* Task 1: song picker for the playlist toolbar's "Add Songs" button.
          Only rendered while a playlist is actually open, so `currentPlaylist`
          is guaranteed non-null here. */}
      {showAddSongs && currentPlaylist && (
        <AddSongsModal
          playlist={currentPlaylist}
          songs={songs}
          accentColor={accentColor}
          onClose={() => setShowAddSongs(false)}
          onConfirm={handleAddSongsToPlaylist}
        />
      )}
      {deletingPlaylist && (
        <DeletePlaylistDialog
          playlist={deletingPlaylist}
          onCancel={() => setDeletingPlaylist(null)}
          onConfirm={() => { handleDeletePlaylist(deletingPlaylist.id); setDeletingPlaylist(null); }}
        />
      )}

      {/* Feature (Bulk multi-select): delete confirmation */}
      {confirmBulkDelete && (
        <ConfirmDialog
          title={`Delete ${selectedSongs.length} song${selectedSongs.length !== 1 ? 's' : ''}?`}
          message="They'll be removed from your library and any playlists they're in. This can't be undone."
          confirmLabel="Delete"
          onCancel={() => setConfirmBulkDelete(false)}
          onConfirm={handleBulkDelete}
        />
      )}

      {/* Feature (Folder re-scan/auto-sync): removed-file confirmation */}
      {removedCandidates && removedCandidates.length > 0 && (
        <ConfirmDialog
          title={`${removedCandidates.length} song${removedCandidates.length !== 1 ? 's' : ''} no longer found`}
          message={`These files aren't in the folder you just selected anymore. Remove them from your library too? Your other songs won't be affected.`}
          confirmLabel="Remove"
          onCancel={() => setRemovedCandidates(null)}
          onConfirm={handleConfirmRemoveMissing}
        />
      )}

      {/* Feature (Import failure report) */}
      {importFailures && importFailures.length > 0 && (
        <ImportFailuresDialog failures={importFailures} onClose={() => setImportFailures(null)} />
      )}

      {/* Feature (Bulk multi-select): "add to playlist" picker */}
      {showBulkPlaylistMenu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(var(--glass-blur-xs))' }}
          onMouseDown={(e) => { if (e.currentTarget === e.target) setShowBulkPlaylistMenu(false); }}>
          <div className="w-full max-w-xs rounded-2xl p-4 shadow-2xl animate-slide-up"
            style={{ background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))', border: '1px solid rgb(var(--fg-rgb) / var(--glass-border-alpha))' }}>
            <h3 className="text-fg font-semibold text-sm mb-3">
              Add {selectedIds.size} song{selectedIds.size !== 1 ? 's' : ''} to playlist
            </h3>
            <div className="max-h-60 overflow-y-auto space-y-1 mb-2">
              {manualPlaylists.length === 0 && <p className="text-fg/30 text-xs py-2">No playlists yet</p>}
              {manualPlaylists.map((pl) => (
                <button key={pl.id} onClick={() => handleBulkAddToPlaylist(pl.id)}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm text-fg/80 hover:bg-fg/10 transition-colors truncate flex items-center justify-between gap-2">
                  <span className="truncate">{pl.name}</span>
                  <span className="text-fg/30 text-xs shrink-0">{playlistCounts[pl.id] ?? pl.songIds.length}</span>
                </button>
              ))}
            </div>
            <button onClick={() => { setShowBulkPlaylistMenu(false); setShowBulkNewPlaylist(true); }}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-90"
              style={{ background: `${accentColor}20`, color: accentColor }}>
              <Plus size={14} /> New playlist
            </button>
            <button onClick={() => setShowBulkPlaylistMenu(false)} className="w-full mt-2 py-2 rounded-lg text-sm text-fg/40 hover:text-fg/60 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}
      {showBulkNewPlaylist && (
        <NewPlaylistModal
          accentColor={accentColor}
          onClose={() => setShowBulkNewPlaylist(false)}
          onCreated={async (name) => {
            const pl = await handleCreatePlaylist(name);
            const updated = { ...pl, songIds: selectedSongs.map((s) => s.id) };
            await savePlaylist(updated);
            setPlaylists((prev) => prev.map((p) => (p.id === pl.id ? updated : p)));
            showToast(`Created "${name}" with ${selectedSongs.length} song${selectedSongs.length !== 1 ? 's' : ''}`);
            setShowBulkNewPlaylist(false);
            exitSelectionMode();
          }}
        />
      )}

      {/* Feature (Smart/rule-based playlists): create + edit share the same
          modal, distinguished by whether initialConfig is passed. */}
      {showNewSmartPlaylist && (
        <SmartPlaylistModal
          songs={songs}
          likedIds={likedIds}
          accentColor={accentColor}
          onClose={() => setShowNewSmartPlaylist(false)}
          onSave={(name, config) => handleCreateSmartPlaylist(name, config)}
        />
      )}
      {editingSmartPlaylist && editingSmartPlaylist.smart && (
        <SmartPlaylistModal
          songs={songs}
          likedIds={likedIds}
          accentColor={accentColor}
          initialName={editingSmartPlaylist.name}
          initialConfig={editingSmartPlaylist.smart}
          onClose={() => setEditingSmartPlaylist(null)}
          onSave={(name, config) => handleUpdateSmartPlaylist(editingSmartPlaylist.id, name, config)}
        />
      )}

      {/* Feature (Lyrics) */}
      {showLyrics && playerState.currentSong && (
        <LyricsModal
          song={playerState.currentSong}
          currentTime={playerState.currentTime}
          accentColor={accentColor}
          artUrl={artUrl}
          onClose={() => setShowLyrics(false)}
          onSeek={(t) => player.seek(t)}
          onUpdated={handleSongUpdated}
        />
      )}
      {showQueueModal && (
        // FIX (library rows peeking through the Player Bar's rounded
        // corners while the Queue was open): the previous version of this
        // fix stopped the overlay short of the Player Bar's strip
        // (`bottom-[184px]`) so the bar wouldn't be hidden entirely. But
        // that left that strip uncovered by anything -- the app's library
        // view is always mounted underneath (the Queue is just an overlay
        // on top of it, not a replacement for it), so wherever the Player
        // Bar's rounded card doesn't reach a full rectangle (its own
        // rounded-2xl corners), tiny slivers of the raw library rows
        // (their heart/3-dot icons) showed through those corner gaps.
        // Covering the full screen uniformly here (back to `inset-0`)
        // means there's a consistent dark/blurred backdrop behind the
        // Player Bar's corners instead of the library peeking through.
        // The Player Bar still needs to render *above* this overlay to
        // stay visible/tappable -- that's handled by giving its wrapper a
        // higher z-index below, rather than by carving a hole in the
        // overlay.
        <div className="fixed inset-0 z-50 flex justify-end md:items-center md:justify-center"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(var(--glass-blur-xs))' }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setShowQueueModal(false); }}>
          {/* FIX (mismatched "different black" band around the Player Bar):
              this panel previously stopped 184px short of the bottom so the
              Player Bar (which sits above this overlay via z-[60]) wouldn't
              be covered by it. But that left the *outer* overlay's lighter,
              more transparent backdrop (rgba(0,0,0,0.5)) exposed behind/
              around the bar instead of this panel's own much darker, more
              opaque background (rgb(var(--surface-rgb) / var(--glass-surface-alpha))) -- the two don't
              match, so it looked like a distinct lighter strip or "seam"
              right where the panel's shorter height cut off. Letting this
              panel go back to full height means its own solid dark
              background extends behind the Player Bar too (no visible
              seam); the list's own bottom padding (see the `pb-[184px]`
              added inside QueuePanel) keeps its rows from being visually
              hidden under the bar instead. */}
          <div className="w-full max-w-sm h-full animate-slide-in-right md:animate-slide-up md:h-auto md:max-h-[80vh]"
            style={{ background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))', borderLeft: '1px solid rgb(var(--fg-rgb) / var(--glass-border-alpha))', maxWidth: '480px' }}>
            <QueuePanel
              queue={upcomingSongs}
              userQueueLen={userQueueLen}
              currentSong={playerState.currentSong}
              isPlaying={playerState.isPlaying}
              onTogglePlay={() => player.togglePlay()}
              accentColor={accentColor}
              onClose={() => setShowQueueModal(false)}
              onPlayFromQueue={handlePlayFromQueue}
              onRemoveFromQueue={(index) => player.removeFromQueue(index)}
              onReorderQueue={(from, to) => player.reorderQueue(from, to)}
              onClearQueue={() => { player.clearQueue(); showToast('Queue cleared'); }}
              onQueueSong={handleQueue}
            />
          </div>
        </div>
      )}
      {showHealthCheck && (
        <MetadataHealthScreen
          songs={songs}
          accentColor={accentColor}
          onClose={() => setShowHealthCheck(false)}
          onBatchPatch={handleBatchPatch}
          onEditArt={(song) => setEditSong(song)}
          onDeleteSong={handleDeleteSong}
        />
      )}
      {toast && <Toast message={toast} accentColor={accentColor} />}
    </>
  );
}
