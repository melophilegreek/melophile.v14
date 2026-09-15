import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Heart, Play, Pencil, ListMusic, FolderPlus, X, ListPlus, Repeat, Trash2, MoreVertical, Copy, Pin, PinOff, Check, Tag, SlidersHorizontal } from 'lucide-react';
import type { Playlist, Song, RowSize } from '../types';
import { initialFor, placeholderBackground } from '../lib/artPlaceholder';

const artCache = new Map<string, string>();

export function getArtUrl(song: Song): string | null {
  if (!song.albumArtData) return null;
  if (artCache.has(song.id)) return artCache.get(song.id)!;
  const url = URL.createObjectURL(new Blob([song.albumArtData], { type: song.albumArtMime || 'image/jpeg' }));
  artCache.set(song.id, url);
  return url;
}

export function invalidateArt(songId: string) {
  const url = artCache.get(songId);
  if (url) { URL.revokeObjectURL(url); artCache.delete(songId); }
}

/**
 * BUG FIX (broken album art): a non-null artUrl only means an object URL was
 * created for the song's stored art bytes — it doesn't mean the browser can
 * actually decode those bytes (corrupt/truncated art, an unsupported image
 * format, etc). None of the <img> tags rendering album art had an onError
 * handler, so a bad artUrl silently rendered the browser's default
 * broken-image icon instead of the app's placeholder, with nothing logged to
 * explain why. This hook tracks failures per song/url and every place that
 * renders art (SongRow, QueuePanel, StatsScreen, PlayerBar) falls back to its
 * existing placeholder note icon and logs a descriptive warning once.
 */
export function useAlbumArtError(song: Song, url: string | null) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [url]);
  const onError = () => {
    if (failed) return;
    console.warn(
      `Album art failed to load for "${song.title}"${song.artist ? ` by ${song.artist}` : ''} ` +
      `(mime: ${song.albumArtMime ?? 'unknown'}). Falling back to placeholder icon.`,
      { songId: song.id, fileName: song.fileName, artUrl: url },
    );
    setFailed(true);
  };
  return { showArt: !!url && !failed, onError };
}

export function formatDuration(s: number): string {
  if (!s || !isFinite(s) || s <= 0) return '';
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function PlayingIndicator({ accent }: { accent: string }) {
  return (
    <div className="flex items-end gap-[2px] h-3">
      {[0, 1, 2].map((i) => (
        <span key={i} className="w-[3px] rounded-full animate-pulse-bar"
          style={{ height: '100%', background: accent, animationDelay: `${i * 0.15}s` }} />
      ))}
    </div>
  );
}

// ── Track actions menu (3-dot overflow + right-click) ──────────────────────────
// TASK 2 (consolidate per-track actions): this used to be a "ContextMenu"
// shown only on right-click, with Like, Add to Playlist, and Edit album art
// as separate always-in-the-DOM inline buttons next to it. Those inline
// buttons are gone now — this single accessible menu is the only way to
// reach Like/Unlike, Add to Playlist, Edit album art, and Delete, and it's
// opened either by right-clicking the row or by the visible 3-dot button.
interface TrackMenuProps {
  x: number; y: number;
  song: Song;
  playlists: Playlist[];
  isLiked: boolean;
  isPinned: boolean;
  accentColor: string;
  onClose: () => void;
  onLike: (song: Song) => void;
  onPin: (song: Song) => void;
  onEditArt: (song: Song) => void;
  onEditTags: (song: Song) => void;
  onEditSongEQ: (song: Song) => void;
  onAddToPlaylist: (song: Song, playlistId: string) => void;
  onCreatePlaylist: (song: Song) => void;
  onRemoveFromPlaylist?: (song: Song) => void;
  onRequestDelete: (song: Song) => void;
  /** FIX (Add to Queue menu item): calls the same underlying queue function
   * the swipe-to-queue gesture uses, so both paths stay consistent. */
  onQueue: (song: Song) => void;
  /** FIX (View Queue menu item): opens the existing queue panel/modal. */
  onViewQueue: () => void;
  /** Focus is returned here when the menu closes via Escape/keyboard activation (i.e. it was opened via the keyboard-reachable 3-dot button, not a mouse right-click). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
}

function TrackMenu({
  x, y, song, playlists, isLiked, isPinned, accentColor, onClose,
  onLike, onPin, onEditArt, onEditTags, onEditSongEQ, onAddToPlaylist, onCreatePlaylist, onRemoveFromPlaylist, onRequestDelete, returnFocusRef,
  onQueue, onViewQueue,
}: TrackMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus: boolean) => {
    onClose();
    if (restoreFocus) returnFocusRef?.current?.focus();
  }, [onClose, returnFocusRef]);

  useEffect(() => {
    const clickOutside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(false); };
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close(true); return; }
      if (!ref.current) return;
      const items = Array.from(ref.current.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      if (!items.length) return;
      const idx = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1 + items.length) % items.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length].focus(); }
      else if (e.key === 'Home') { e.preventDefault(); items[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); items[items.length - 1].focus(); }
    };
    // FIX (menu stuck in place while list scrolls): this menu is positioned
    // once, as `fixed`, from the 3-dot button's coordinates at open time. It
    // never re-measures, and scroll events don't bubble to a plain
    // `document.addEventListener('mousedown', ...)` listener, so scrolling
    // the (virtualized) song list left the menu floating disconnected from
    // its row instead of closing. Listen for 'scroll' in the capture phase
    // (capture sees scroll events fired on any descendant scrollable
    // container, since they don't bubble) and close the menu as soon as any
    // scrolling starts.
    const scrollClose = () => close(false);
    // Deferred so the click that opened the menu doesn't also close it.
    const t = setTimeout(() => document.addEventListener('mousedown', clickOutside), 0);
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('scroll', scrollClose, true);
    // Autofocus the first menu item so keyboard users land straight in the menu.
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', clickOutside);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('scroll', scrollClose, true);
    };
  }, [close]);

  // FIX (menu overlapping the Player Bar): the previous fix reserved space
  // for the Player Bar but still guessed the menu's own height as a fixed
  // 340px constant. That's wrong whenever the menu is taller than that —
  // e.g. this row has no "Remove from playlist" item but does have a
  // "New playlist" row and no playlist entries, so the guessed 340px could
  // be *shorter* than the real menu in other cases (a song that's in several
  // playlists adds one row per playlist, uncapped), and the menu's actual
  // bottom edge would land on top of the Player Bar instead of stopping
  // above it. Now the menu positions itself from the button coordinates on
  // first paint (using the old estimate so there's no flash of an
  // unpositioned menu), then `useLayoutEffect` measures its *real* rendered
  // height — which already reflects however many playlists it's listing —
  // and corrects the position before the browser paints, so it never visibly
  // jumps and never overlaps the bar regardless of content length.
  const playerBarReservedHeight = window.innerWidth >= 768 ? 76 : 184;
  const [pos, setPos] = useState(() => ({
    left: Math.min(x, window.innerWidth - 224),
    top: Math.min(y, window.innerHeight - playerBarReservedHeight - 340),
  }));

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxLeft = window.innerWidth - rect.width - 8;
    const maxTop = window.innerHeight - playerBarReservedHeight - rect.height - 8;
    setPos({
      left: Math.max(8, Math.min(x, maxLeft)),
      top: Math.max(8, Math.min(y, maxTop)),
    });
    // Re-measure if the menu's content changes height (e.g. playlists list).
  }, [x, y, playlists.length, playerBarReservedHeight]);

  const { left, top } = pos;
  const itemClass = 'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-fg/80 hover:bg-fg/10 focus:bg-fg/10 focus:outline-none text-sm transition-colors';

  return (
    <div ref={ref} role="menu" aria-label={`Actions for ${song.title}`}
      className="w-56 rounded-xl overflow-hidden shadow-2xl border border-fg/10 animate-fade-in fixed z-[1000]"
      style={{ left, top, background: 'rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-md)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))' }}>
      <div className="px-3 py-2 border-b border-fg/10">
        <p className="text-fg text-xs font-semibold truncate">{song.title}</p>
        <p className="text-fg/40 text-xs truncate">{song.artist}</p>
      </div>
      <div className="p-1">
        <button role="menuitem" tabIndex={-1} onClick={() => { onLike(song); close(false); }} className={itemClass}>
          <Heart size={14} fill={isLiked ? accentColor : 'none'} style={{ color: isLiked ? accentColor : 'rgb(var(--fg-rgb) / 0.6)' }} />
          {isLiked ? 'Unlike' : 'Like'}
        </button>
        <button role="menuitem" tabIndex={-1} onClick={() => { onPin(song); close(false); }} className={itemClass}>
          {isPinned ? <PinOff size={14} style={{ color: accentColor }} /> : <Pin size={14} className="text-fg/50" />}
          {isPinned ? 'Unpin Song' : 'Pin Song'}
        </button>
        <button role="menuitem" tabIndex={-1} onClick={() => { onEditArt(song); close(false); }} className={itemClass}>
          <Pencil size={14} className="text-fg/50" /> Edit album art
        </button>
        <button role="menuitem" tabIndex={-1} onClick={() => { onEditTags(song); close(false); }} className={itemClass}>
          <Tag size={14} className="text-fg/50" /> Edit tags
        </button>
        <button role="menuitem" tabIndex={-1} onClick={() => { onEditSongEQ(song); close(false); }} className={itemClass}>
          <SlidersHorizontal size={14} style={{ color: song.customEQ ? accentColor : 'rgb(var(--fg-rgb) / 0.5)' }} /> Song EQ{song.customEQ ? ' (on)' : ''}
        </button>
        {/* FIX (Add to Queue menu item): calls the same onQueue callback the
            swipe-to-queue gesture uses (player.addToQueue under the hood),
            so both entry points stay consistent. */}
        <button role="menuitem" tabIndex={-1} onClick={() => { onQueue(song); close(false); }} className={`${itemClass} mt-1`}>
          <ListPlus size={14} className="text-fg/50" /> Add to queue
        </button>
        {/* FIX (View Queue menu item): opens the existing queue panel/modal
            so the queue can be reviewed or managed without leaving the row. */}
        <button role="menuitem" tabIndex={-1} onClick={() => { onViewQueue(); close(false); }} className={itemClass}>
          <ListMusic size={14} className="text-fg/50" /> View queue
        </button>
        <button role="menuitem" tabIndex={-1} onClick={() => { onCreatePlaylist(song); close(false); }} className={`${itemClass} mt-1`}>
          <FolderPlus size={14} className="text-fg/50" /> New playlist
        </button>
        {playlists.length > 0 && (
          <>
            <div className="px-3 py-1 text-[10px] text-fg/30 uppercase tracking-wider font-semibold mt-1">Add to playlist</div>
            {playlists.map((pl) => (
              <button key={pl.id} role="menuitem" tabIndex={-1} onClick={() => { onAddToPlaylist(song, pl.id); close(false); }} className={itemClass}>
                <ListMusic size={14} className="text-fg/50" /> <span className="truncate">{pl.name}</span>
              </button>
            ))}
          </>
        )}
        {onRemoveFromPlaylist && (
          <button role="menuitem" tabIndex={-1} onClick={() => { onRemoveFromPlaylist(song); close(false); }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 focus:bg-red-500/10 focus:outline-none text-sm transition-colors mt-1">
            <X size={14} /> Remove from playlist
          </button>
        )}
        <div className="h-px bg-fg/10 my-1" />
        <button role="menuitem" tabIndex={-1} onClick={() => { onRequestDelete(song); close(false); }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-red-400 hover:bg-red-500/10 focus:bg-red-500/10 focus:outline-none text-sm transition-colors">
          <Trash2 size={14} /> Delete from library
        </button>
      </div>
    </div>
  );
}

// ── Delete confirmation dialog ─────────────────────────────────────────────────
function DeleteConfirmDialog({ song, onCancel, onConfirm }: {
  song: Song; onCancel: () => void; onConfirm: () => void;
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
        <h3 className="text-fg font-bold text-lg mb-2">Delete song?</h3>
        <p className="text-fg/50 text-sm mb-5 leading-snug">
          <span className="text-fg/80 font-medium">{song.title}</span> will be permanently removed from your library. This can't be undone.
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


// ── Main SongRow with swipe-to-queue ──────────────────────────────────────────
interface SongRowProps {
  song: Song;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  isLiked: boolean;
  /** Pin/Unpin feature: true when this song is pinned. Drives the small pin
   *  badge on the row and the Pin/Unpin toggle wording in the overflow menu. */
  isPinned: boolean;
  isQueued: boolean;
  accentColor: string;
  playlists: Playlist[];
  isInPlaylist?: boolean;
  showPlayCount?: boolean;
  /** Change (duplicate imports): true when another imported track shares this
   *  one's title + artist. Duplicates are always imported now (no blocking
   *  prompt), so this badge is the only signal the user gets that it happened. */
  isDuplicateTitleArtist?: boolean;
  onPlay: (song: Song) => void;
  onLike: (song: Song) => void;
  onPin: (song: Song) => void;
  onQueue: (song: Song) => void;
  onAddToPlaylist: (song: Song, playlistId: string) => void;
  onCreatePlaylist: (song: Song) => void;
  onEditArt: (song: Song) => void;
  onEditTags: (song: Song) => void;
  onEditSongEQ: (song: Song) => void;
  onDelete: (song: Song) => void;
  onRemoveFromPlaylist?: (song: Song) => void;
  /** FIX (View Queue menu item): opens the existing queue panel/modal. */
  onViewQueue: () => void;
  /** Feature (Bulk multi-select): when true, the row shows a selection
   *  checkbox instead of its track number / play button, and clicking the
   *  row toggles selection instead of starting playback. */
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (song: Song) => void;
  /** Feature (Row size): 'comfortable' (default) matches the original
   *  fixed sizing; 'compact' and 'large' scale the thumbnail/text/spacing
   *  to match the row height the parent list is currently rendering at. */
  size?: RowSize;
}

export function SongRow({
  song, index, isCurrent, isPlaying, isLiked, isPinned, isQueued, accentColor, playlists, isInPlaylist, showPlayCount, isDuplicateTitleArtist,
  onPlay, onLike, onPin, onQueue, onAddToPlaylist, onCreatePlaylist, onEditArt, onEditTags, onEditSongEQ, onDelete, onRemoveFromPlaylist, onViewQueue,
  selectionMode, isSelected, onToggleSelect, size = 'comfortable',
}: SongRowProps) {
  const [trackMenu, setTrackMenu] = useState<{ x: number; y: number; keyboardTriggered: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const [swiping, setSwiping] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
// Auto-dismiss the delete confirmation after 2.5 seconds
  useEffect(() => {
    if (!confirmDelete) return;

    const timer = setTimeout(() => {
      setConfirmDelete(false);
    }, 2500);

    return () => clearTimeout(timer);
  }, [confirmDelete]);
  
  const startTime = useRef(0);

  const artUrl = getArtUrl(song);
  const { showArt, onError: onArtError } = useAlbumArtError(song, artUrl);
  const duration = formatDuration(song.duration);
  const kbpsLabel = song.kbps != null ? `${song.kbps} kbps` : '? kbps';
  const meta = [duration, kbpsLabel].filter(Boolean).join(' · ');

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); setTrackMenu({ x: e.clientX, y: e.clientY, keyboardTriggered: false });
  }, []);

  const openMenuFromButton = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setTrackMenu({ x: r.right - 224, y: r.bottom + 6, keyboardTriggered: true });
  }, []);

  // ── Swipe left-to-right to queue ──
  const onTouchStart = (e: React.TouchEvent) => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    startTime.current = Date.now();
    setSwiping(true);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!swiping) return;
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (Math.abs(dy) > Math.abs(dx)) { setSwiping(false); setSwipeX(0); return; }
    if (dx > 0) { e.preventDefault(); setSwipeX(Math.min(dx, 100)); }
  };

  const onTouchEnd = () => {
    if (swipeX > 60) { onQueue(song); }
    setSwipeX(0); setSwiping(false);
  };

  const showQueueHint = swipeX > 20;

  // Feature (Row size): thumbnail size, text scale, and gap all step
  // together with the row height the parent list is currently using, so
  // a taller row isn't just empty padding around the same tiny elements.
  const sizeStyles: Record<RowSize, { thumb: string; gap: string; title: string; meta: string }> = {
    tiny: { thumb: 'w-6 h-6', gap: 'gap-2', title: 'text-[12px]', meta: 'text-[10px]' },
    compact: { thumb: 'w-8 h-8', gap: 'gap-2.5', title: 'text-[13px]', meta: 'text-[11px]' },
    comfortable: { thumb: 'w-10 h-10', gap: 'gap-3', title: 'text-sm', meta: 'text-xs' },
    large: { thumb: 'w-14 h-14', gap: 'gap-3.5', title: 'text-base', meta: 'text-sm' },
    extraLarge: { thumb: 'w-16 h-16', gap: 'gap-4', title: 'text-lg', meta: 'text-sm' },
  };
  const s = sizeStyles[size];

  return (
    <>
      <div className="relative h-full overflow-hidden">
        {/* Queue hint background revealed on swipe */}
        <div className="absolute inset-0 flex items-center justify-start px-4"
          style={{ background: `${accentColor}15`, opacity: showQueueHint ? 1 : 0, transition: 'opacity 0.15s' }}>
          <div className="flex items-center gap-2" style={{ color: accentColor }}>
            <ListPlus size={20} />
            <span className="text-sm font-semibold">Queue</span>
          </div>
        </div>

        {/* Main row */}
        {/* FIX (long-press opens the browser's native Copy/Share/Select-all
            menu instead of the app): row text was selectable by default, so
            a mobile long-press (which fires the same `contextmenu` event
            handled below for desktop right-click) got intercepted by the
            browser's own text-selection UI before it ever reached
            handleContextMenu. `select-none` (already used the same way on
            SeekBar/Slider/WaveformSeekBar for their drag handles) stops
            that selection from starting, and the inline WebkitTouchCallout
            override does the same for Safari/iOS, which ignores
            user-select for its long-press callout menu. */}
        <div
          className={`group relative flex items-center ${s.gap} px-3 h-full cursor-pointer transition-colors select-none ${
            isCurrent ? '' : 'hover:bg-fg/[0.05]'
          }`}
          style={{
            transform: `translateX(${swipeX}px)`,
            transition: swiping ? 'none' : 'transform 0.3s cubic-bezier(0.16,1,0.3,1)',
            WebkitTouchCallout: 'none',
            ...(isCurrent ? { background: `linear-gradient(90deg, ${accentColor}14, transparent 60%)` } : {}),
          }}
          onClick={() => { if (swipeX !== 0) return; if (selectionMode) onToggleSelect?.(song); else onPlay(song); }}
          onContextMenu={handleContextMenu}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        >
          {/* Feature (Premium UI pass): same glowing left-edge indicator
              used for the active sidebar item, so "this is playing" reads
              consistently across the whole app instead of just a flat tint. */}
          {isCurrent && <span className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full" style={{ background: accentColor, boxShadow: `0 0 8px ${accentColor}` }} />}
          {/* Index / Selection checkbox.
              FIX (gap on the left edge on mobile): this slot's width was
              always reserved (`w-6`), but its actual contents -- the row
              number and the hover-reveal Play icon -- are both hidden on
              mobile (no hover state on touch, and numbers were
              intentionally dropped there). That left a permanent blank
              24px gap before the thumbnail on every row. The slot now
              only takes up space on mobile when it actually has
              something to show (the selection checkbox); otherwise it
              collapses to zero width there. Desktop is unchanged -- it
              still reserves the width for the index number / hover play
              icon. */}
          <div className={
            selectionMode
              ? 'w-6 flex items-center justify-center shrink-0'
              : 'w-0 md:w-6 hidden md:flex items-center justify-center shrink-0'
          }>
            {selectionMode ? (
              <button onClick={(e) => { e.stopPropagation(); onToggleSelect?.(song); }}
                className="w-5 h-5 rounded-md border flex items-center justify-center transition-colors"
                style={{ borderColor: isSelected ? accentColor : 'rgb(var(--fg-rgb) / 0.3)', background: isSelected ? accentColor : 'transparent' }}>
                {isSelected && <Check size={13} className="text-fg" strokeWidth={3} />}
              </button>
            ) : (
              <>
                {/* Feature (Remove row numbers on mobile): index numbers
                    stay visible on desktop (where hover reveals the play
                    icon in their place), but are hidden entirely on mobile
                    -- touch has no hover state, so the number just sat
                    there permanently and was asked to be removed there.
                    The w-6 slot above still reserves the same width so
                    nothing shifts, it's just blank on mobile now. */}
                <span className="hidden md:inline-block text-xs tabular-nums text-fg/30 md:group-hover:hidden"
                  style={isCurrent ? { color: accentColor } : {}}>{index + 1}</span>
                <Play size={12} fill="currentColor" className="text-fg hidden group-hover:block ml-0.5" />
              </>
            )}
          </div>

          {/* Thumbnail.
              FIX (playing row's thumbnail shifted out of alignment): the
              equalizer indicator used to live in the index slot to the
              left of the thumbnail, which meant that slot's width had to
              be reserved just for the one currently-playing row -- every
              other row's thumbnail sat further left, so the list looked
              misaligned as soon as something started playing. It's now a
              small overlay in the thumbnail's own corner instead, so the
              thumbnail's position never moves regardless of play state. */}
          <div className={`relative ${s.thumb} rounded-md shrink-0 overflow-hidden flex items-center justify-center`} style={{ background: placeholderBackground(accentColor) }}>
            {showArt ? <img src={artUrl!} alt="" className="w-full h-full object-cover" onError={onArtError} /> : <span className="text-xs font-semibold" style={{ color: accentColor }}>{initialFor(song)}</span>}
            {isCurrent && isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }}>
                <PlayingIndicator accent="#fff" />
              </div>
            )}
          </div>

          {/* Title + meta */}
          <div className="flex-1 min-w-0">
            <p className={`${s.title} font-medium truncate leading-tight flex items-center gap-1.5`} style={{ color: isCurrent ? accentColor : 'rgb(var(--fg-rgb) / 0.9)' }}>
              <span className="truncate">{song.title}</span>
              {isDuplicateTitleArtist && (
                <span
                  className="inline-flex shrink-0"
                  aria-label="Another imported track shares this title and artist"
                  title="Another imported track shares this title and artist"
                >
                  <Copy size={11} className="text-fg/35" />
                </span>
              )}
            </p>
            <p className={`${s.meta} text-fg/40 truncate leading-tight mt-0.5`}>
              {song.artist}{meta ? ` · ${meta}` : ''}
            </p>
          </div>

          {/* Queued indicator */}
          {isQueued && (
            <div className="shrink-0 mr-1">
              <ListPlus size={14} style={{ color: accentColor }} />
            </div>
          )}

          {/* Pinned indicator — non-interactive; Pin/Unpin itself lives in the
              overflow menu below. Shown before the Liked heart so a pinned
              song is identifiable at a glance regardless of its liked state. */}
          {isPinned && (
            <div className="shrink-0 mr-1" aria-label="Pinned" title="Pinned">
              <Pin size={14} fill={accentColor} style={{ color: accentColor }} />
            </div>
          )}

          {/* Liked indicator — non-interactive; Like/Unlike itself now lives in the overflow menu below, so this preserves at-a-glance liked status without an always-visible button */}
          {isLiked && (
            <div className="shrink-0 mr-1" aria-label="Liked" title="Liked">
              <Heart size={14} fill={accentColor} style={{ color: accentColor }} />
            </div>
          )}

          {/* Play count badge */}
          {showPlayCount && (song.playCount ?? 0) > 0 && (
            <div className="shrink-0 mr-1 flex items-center gap-1 px-2 py-0.5 rounded-full"
              style={{ background: `${accentColor}18` }}>
              <Repeat size={11} style={{ color: accentColor }} />
              <span className="text-[11px] font-semibold tabular-nums" style={{ color: accentColor }}>{song.playCount}</span>
            </div>
          )}

          {/* Actions — Play is the primary action (the whole row / index-hover play icon above); everything
              secondary (Like, Add to Playlist, Edit album art, Delete) lives in this one overflow menu. */}
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              ref={menuButtonRef}
              onClick={openMenuFromButton}
              aria-haspopup="menu"
              aria-expanded={!!trackMenu}
              aria-label={`More actions for ${song.title}`}
              title="More options"
              // FIX (three-dot menu always visible): this used to be
              // `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
              // focus:opacity-100`, which hid the button until the row was
              // hovered/focused/tapped. Dropping the opacity-0 base state makes
              // it always visible; tap-to-play and swipe-to-queue are untouched
              // since this button already stops click propagation separately.
              className="btn-icon w-7 h-7 hover:bg-fg/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-fg/40 transition-opacity"
            >
              <MoreVertical size={15} className="text-fg/60" />
            </button>
          </div>
        </div>
      </div>

      {trackMenu && (
        <TrackMenu
          x={trackMenu.x} y={trackMenu.y}
          song={song} playlists={playlists} isLiked={isLiked} isPinned={isPinned} accentColor={accentColor}
          onClose={() => setTrackMenu(null)}
          onLike={onLike}
          onPin={onPin}
          onEditArt={onEditArt}
          onEditTags={onEditTags}
          onEditSongEQ={onEditSongEQ}
          onAddToPlaylist={onAddToPlaylist}
          onCreatePlaylist={onCreatePlaylist}
          onRemoveFromPlaylist={isInPlaylist ? onRemoveFromPlaylist : undefined}
          onRequestDelete={() => setConfirmDelete(true)}
          onQueue={onQueue}
          onViewQueue={onViewQueue}
          returnFocusRef={trackMenu.keyboardTriggered ? menuButtonRef : undefined}
        />
      )}

      {confirmDelete && (
        <DeleteConfirmDialog song={song} onCancel={() => setConfirmDelete(false)}
          onConfirm={() => { setConfirmDelete(false); onDelete(song); }} />
      )}
    </>
  );
}
