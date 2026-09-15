import { useCallback, useMemo, useRef, useState } from 'react';
import type { Song } from '../types';
import type { VirtualListHandle } from './VirtualList';

const LETTERS = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z','#'];

function getLetterKey(title: string): string {
  const c = title.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}

// Nearest letter to `fromIdx` (an index into LETTERS) that actually has a
// song, searching outward in both directions at once. This is what lets
// dragging over a letter with zero matches (e.g. no "X" titles) still land
// on the closest real one instead of doing nothing -- same as Poweramp,
// where the strip never "sticks" on an empty letter mid-drag.
function nearestAvailableLetter(letterIndex: Map<string, number>, fromIdx: number): string | null {
  if (letterIndex.size === 0) return null;
  for (let d = 0; d < LETTERS.length; d++) {
    const lo = fromIdx - d;
    if (lo >= 0 && letterIndex.has(LETTERS[lo])) return LETTERS[lo];
    const hi = fromIdx + d;
    if (hi < LETTERS.length && letterIndex.has(LETTERS[hi])) return LETTERS[hi];
  }
  return null;
}

interface Props {
  songs: Song[];
  accentColor: string;
  listRef: React.RefObject<VirtualListHandle>;
  /**
   * Row-index offset to add before calling scrollToIndex. Needed in views
   * where VirtualList's item array has extra rows before the songs -- e.g.
   * the Library/Playlist "Pinned" section header (see App.tsx's `rows`
   * construction). `songs` here should still be in the exact display order
   * (pinned first, then unpinned) so the letter->position mapping matches.
   * Defaults to 0 for views with no such header (Liked Songs, etc).
   */
  indexOffset?: number;
  /**
   * Locked pixel height for the strip, measured by the parent only while
   * the collapsing header is visible (see App.tsx). Keeps the strip a
   * fixed size regardless of the header collapse/expand animation instead
   * of stretching to fill whatever space that animation frees up. Falls
   * back to 100% of the parent until the first measurement lands.
   */
  height?: number | null;
}

// Feature (Poweramp-style A-Z scrubber): press-and-drag anywhere on the
// strip to fly through the alphabet continuously (not just one tap per
// letter), with a large floating letter "bubble" tracking the touch point
// -- matching Poweramp's fast-scroll index. A plain tap still jumps
// straight to that letter, since it's just a drag with zero movement.
export function AlphaScrollBar({ songs, accentColor, listRef, indexOffset = 0, height = null }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const activeLetterRef = useRef<string | null>(null);
  const [activeLetter, setActiveLetter] = useState<string | null>(null);
  const [bubbleY, setBubbleY] = useState(0);

  // PERF FIX (laggy/jumpy dragging): this Map used to be rebuilt from
  // scratch -- looping over every song in the library (800+ in a large
  // library) -- on every single render. Since dragging calls setBubbleY/
  // setActiveLetter on essentially every pointermove event, that meant one
  // full O(songs) rebuild per finger-movement pixel, on top of the actual
  // scroll work below. useMemo keyed on `songs` means it's only rebuilt
  // when the song list itself actually changes, not on every drag frame.
  const letterIndex = useMemo(() => {
    const map = new Map<string, number>();
    songs.forEach((song, i) => {
      const key = getLetterKey(song.title);
      if (!map.has(key)) map.set(key, i);
    });
    return map;
  }, [songs]);

  // PERF FIX (laggy/jumpy dragging): touch/pointermove can fire faster than
  // the screen repaints (many devices report movement at well over 60Hz).
  // Previously every single event ran the full update synchronously --
  // recompute row math, setState x2, a vibration call, and a direct
  // `scrollTop` write -- which piles up more work per frame than the
  // browser can paint, and that backlog is what reads as "jumpy". Now each
  // pointermove just stashes the latest Y and schedules (at most) one
  // requestAnimationFrame; only the most recent position per frame is ever
  // processed, so the actual work is capped at once per repaint.
  const pendingYRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const updateFromClientY = useCallback((clientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) return;
    const rowH = rect.height / LETTERS.length;
    const rawIdx = Math.max(0, Math.min(LETTERS.length - 1, Math.floor((clientY - rect.top) / rowH)));
    // Bubble tracks the row directly under the finger (feels most
    // responsive), independent of whether that exact letter has matches.
    // FIX (bubble spilling into the Player Bar for the bottommost
    // letters): the bubble's *center* was always kept within the strip's
    // own bounds, but the bubble itself is a fixed 72px tall box -- so
    // for a letter near the very top or bottom of the strip, up to half
    // that box stuck out past the strip's edge (below into the Player
    // Bar, or above the top of the screen). Clamping the center to stay
    // at least half the bubble's height away from each edge keeps the
    // whole box within the strip's own bounds instead.
    const BUBBLE_HALF = 36;
    const rawBubbleY = rect.top + (rawIdx + 0.5) * rowH;
    const clampedBubbleY = rect.height >= BUBBLE_HALF * 2
      ? Math.min(Math.max(rawBubbleY, rect.top + BUBBLE_HALF), rect.bottom - BUBBLE_HALF)
      : rect.top + rect.height / 2;
    setBubbleY(clampedBubbleY);

    // FIX (X/Z -- letters at the tail of the alphabet with no matches --
    // never appearing in the bubble or strip highlight): this used to set
    // activeLetter to the *nearest available* letter, so e.g. touching "X"
    // (no matches) silently relabeled itself "W" and the highlight jumped
    // there too -- visually indistinguishable from the touch not
    // registering at all. The bubble/highlight now always reflects the
    // raw letter under the finger, matches or not (Poweramp does the
    // same); only the actual scroll target falls back to the nearest
    // letter that has a match.
    const rawLetter = LETTERS[rawIdx];
    if (rawLetter !== activeLetterRef.current) {
      activeLetterRef.current = rawLetter;
      setActiveLetter(rawLetter);
      // Subtle per-letter tick, mirroring Poweramp's haptic feedback while
      // scrubbing. No-op (and harmless) on devices/browsers without it.
      if (typeof navigator !== 'undefined' && navigator.vibrate) {
        try { navigator.vibrate(8); } catch { /* unsupported, ignore */ }
      }
    }

    const target = nearestAvailableLetter(letterIndex, rawIdx);
    if (!target) return;
    const idx = letterIndex.get(target);
    if (idx !== undefined) listRef.current?.scrollToIndex(idx + indexOffset);
  }, [letterIndex, listRef, indexOffset]);

  const endDrag = useCallback(() => {
    draggingRef.current = false;
    activeLetterRef.current = null;
    setActiveLetter(null);
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    pendingYRef.current = null;
  }, []);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    draggingRef.current = true;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    updateFromClientY(e.clientY);
  }, [updateFromClientY]);

  // PERF FIX (laggy/jumpy dragging): schedules at most one
  // requestAnimationFrame at a time. If several pointermove events arrive
  // before the next repaint, only the latest Y coordinate (pendingYRef) is
  // kept and processed -- older ones are simply overwritten and dropped,
  // rather than each one doing its own full update.
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    pendingYRef.current = e.clientY;
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      if (pendingYRef.current !== null) updateFromClientY(pendingYRef.current);
    });
  }, [updateFromClientY]);

  return (
    <>
      {/* FIX (letters past "U" hidden behind the Player Bar): this used to be
          a fixed-height (w-7 h-7) row per letter inside an overflow-y-auto
          container, relying on the user being able to swipe the strip itself
          to reach whatever didn't fit. Dragging needs `touch-action: none`
          on this element to stop the page from scrolling underneath a
          scrub gesture, but that also blocks that swipe-to-reveal, so
          anything past the visible height became unreachable. Fixed by
          giving every letter `flex-1` instead of a fixed height: all 27
          always divide the *actual* available height evenly, so nothing
          overflows and there's nothing to scroll in the first place. */}
      <div
        ref={containerRef}
        className="shrink-0 flex flex-col items-stretch py-2 select-none z-10 min-h-0 touch-none"
        style={{ height: height ?? '100%', alignSelf: 'flex-end' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {LETTERS.map((letter) => {
          const hasMatch = letterIndex.has(letter);
          const isActive = activeLetter === letter;
          return (
            <div
              key={letter}
              className="flex-1 min-h-0 w-9 flex items-center justify-center text-xs font-bold rounded-sm transition-colors leading-none"
              style={{
                color: hasMatch ? accentColor : 'rgb(var(--fg-rgb) / 0.2)',
                backgroundColor: isActive ? 'rgb(var(--fg-rgb) / 0.12)' : 'transparent',
              }}
            >
              {letter}
            </div>
          );
        })}
      </div>
      {/* The floating letter bubble, Poweramp-style: large, centered on the
          touch point, positioned just clear of the strip so it doesn't sit
          under the finger. Fixed positioning (not relative to the list) so
          it can float over song rows and the strip alike. */}
      {activeLetter && (
        <div
          aria-hidden="true"
          className="fixed pointer-events-none z-50 flex items-center justify-center rounded-2xl font-bold"
          style={{
            right: 'calc(env(safe-area-inset-right, 0px) + 40px)',
            /* PERF FIX (laggy scrollbar drag): this used to reposition via
               the `top` property, updated on every rAF tick while dragging
               (see updateFromClientY -> setBubbleY above). `top` is a
               layout property -- changing it forces the browser to re-run
               layout AND re-sample/blur everything behind this element's
               backdrop-filter, every single frame, which is exactly the
               kind of per-frame cost that shows up as a laggy drag,
               especially once the backdrop-filter below got heavier (see
               the Apple-style glass refinement comment on --glass-blur-xs
               and the added brightness/contrast passes in index.css).
               Pinning `top: 0` and doing all movement through `transform`
               instead keeps this element on its own compositor layer --
               the browser can slide it around on the GPU without
               recomputing layout or re-blurring anything each frame.
               `willChange: transform` hints the browser to promote it to
               that layer proactively rather than on the first move. */
            top: 0,
            transform: `translate3d(0, ${bubbleY}px, 0) translateY(-50%)`,
            willChange: 'transform',
            width: 72,
            height: 72,
            fontSize: 32,
            color: accentColor,
            textShadow: '0 1px 3px rgb(0 0 0 / 0.35)',
            /* Feature (Liquid Glass theme toggle), redesigned again: a
               radial "glare spot" is a skeuomorphic glossy-button cue (2009
               web-2.0 icon, basically), not a glass one -- a real pane of
               glass doesn't have a little sunburst painted on it. Dropped it
               entirely and matched the exact same quiet glass language every
               other surface in the app already uses (see .glass-surface /
               the modal panels in App.tsx): a flat, evenly frosted
               --elevated-rgb base with a soft top-down sheen, a thin bright
               top-edge highlight, nothing radial or "shiny". The accent
               color now lives only in the letter itself (bold, tinted,
               with a small drop shadow for legibility) rather than
               flooding the whole tile -- consistent with how the rest of
               the UI uses accent as a small deliberate accent, not a fill. */
            background: `linear-gradient(180deg, rgb(255 255 255 / calc(0.14 * var(--glass-sheen, 1))), rgb(255 255 255 / 0) 55%), rgb(var(--elevated-rgb) / var(--glass-elevated-alpha))`,
            boxShadow: `0 4px 14px -4px rgb(0 0 0 / 0.5), inset 0 1px 0 rgb(255 255 255 / calc(0.22 * var(--glass-sheen, 1)))`,
            border: `1px solid rgb(255 255 255 / calc(0.14 * var(--glass-sheen, 1) + 0.06))`,
            backdropFilter: 'blur(var(--glass-blur-xs)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))',
            WebkitBackdropFilter: 'blur(var(--glass-blur-xs)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))',
          }}
        >
          {activeLetter}
        </div>
      )}
    </>
  );
}
