import { useState, useRef, useEffect, useLayoutEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, Shuffle, Music, Library, ListMusic,
  Mic2, Moon, Check, MoreVertical, Gauge, Repeat, Repeat1, ChevronDown,
} from 'lucide-react';
import type { RepeatMode, ShuffleMode, Song, PlayerBarStyle } from '../types';
import { initialFor, placeholderBackground } from '../lib/artPlaceholder';
import { getContrastText } from '../lib/color';
import { SeekBar } from './SeekBar';

function formatTime(s: number): string {
  if (!s || !isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60); const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// BUG FIX (light mode "now playing" bar staying dark): this used to return a
// fixed dark gradient (22%/12% lightness) with no theme awareness at all --
// combined with the always-black `bg-black/55` scrim that used to sit on top
// of it, the bar rendered as a near-black panel in *both* themes. Since the
// bar's text/icons correctly use the theme-aware `text-fg` token (dark text
// in light mode), that dark-on-dark combo is exactly what produced the
// washed-out, barely-legible text in the screenshot. Now takes the current
// theme and picks a lightness/saturation band that stays legible against
// dark (light mode) text: pastel, high-lightness tones instead of near-black
// ones. Hue selection (from the title) is unchanged in both themes.
function gradientFor(title: string, theme: 'dark' | 'light'): string {
  const h = (title.charCodeAt(0) * 37 + (title.charCodeAt(1) || 0) * 17) % 360;
  if (theme === 'light') {
    return `linear-gradient(135deg, hsl(${h},55%,90%), hsl(${(h+50)%360},45%,82%))`;
  }
  return `linear-gradient(135deg, hsl(${h},45%,22%), hsl(${(h+50)%360},35%,12%))`;
}

// FIX 3 (LONG SONG NAMES): replaces the plain `truncate` <p> for the song
// title. Measures whether the text actually overflows its container; if it
// doesn't, it renders perfectly static (no ellipsis, no animation). If it
// does, it scrolls right-to-left just far enough to reveal the clipped end,
// holds there for ~2s, then snaps back to the start and repeats — instead
// of the old behavior of silently cutting the title off with `truncate`.
function MarqueeText({ text, className }: { text: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [overflowPx, setOverflowPx] = useState(0);
  const animId = useId().replace(/[:]/g, '');

  useEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      const span = textRef.current;
      if (!container || !span) return;
      const diff = span.scrollWidth - container.clientWidth;
      setOverflowPx(diff > 1 ? diff : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);

    // BUG FIX: index.css loads Inter with `display=swap`, so on first paint
    // the title renders in the fallback font, gets measured, and THEN Inter
    // swaps in (wider, 600-weight). That swap changes the span's scrollWidth
    // but never resizes the container, so the ResizeObserver above never
    // fires and `overflowPx` stays stuck at the stale fallback-font value —
    // this is what produced the permanently clipped, never-scrolling title.
    // Re-measure once real fonts are ready to catch that swap.
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(measure).catch(() => {});
    }

    return () => ro.disconnect();
  }, [text]);

  const overflowing = overflowPx > 0;

  // Constant scroll speed (~35px/s) so long titles don't rush by, plus a
  // fixed ~2s pause at the start before the loop restarts. Percent
  // breakpoints below are derived from these durations for THIS instance.
  const scrollSec = overflowing ? Math.max(overflowPx / 35, 1.5) : 0;
  const pauseSec = 2;
  const snapSec = 0.05; // near-instant reset back to the start
  const totalSec = scrollSec + pauseSec + snapSec;
  const scrollEndPct = (scrollSec / totalSec) * 100;
  const pauseEndPct = ((scrollSec + pauseSec) / totalSec) * 100;

  return (
    // FIX (long-press showing the OS text-selection popup): this text sits
    // in the player bar's touch-heavy area (tap to expand, swipe/long-press
    // for other gestures elsewhere in this file), so a long-press on the
    // title was landing on plain selectable text and triggering the
    // browser/WebView's native "Translate / Copy / Share" toolbar instead
    // of whatever gesture was intended -- select-none stops that without
    // affecting the marquee animation or truncation above.
    <div ref={containerRef} className={`overflow-hidden whitespace-nowrap select-none ${className ?? ''}`}>
      {overflowing && (
        <style>{`
          @keyframes ${animId} {
            0% { transform: translateX(0); }
            ${scrollEndPct}% { transform: translateX(-${overflowPx}px); }
            ${pauseEndPct}% { transform: translateX(-${overflowPx}px); }
            100% { transform: translateX(0); }
          }
        `}</style>
      )}
      <span
        ref={textRef}
        className="inline-block"
        style={overflowing ? { animation: `${animId} ${totalSec}s linear infinite` } : undefined}
      >
        {text}
      </span>
    </div>
  );
}

interface Props {
  currentSong: Song | null;
  artUrl: string | null;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  shuffleMode: ShuffleMode;
  accentColor: string;
  queueCount: number;
  onPrev: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  onVolume: (v: number) => void;
  onMute: () => void;
  onShuffleToggle: () => void;
  onShuffleModeChange: (mode: ShuffleMode) => void;
  onOpenQueue: () => void;
  /** Feature (Lyrics): whether the current song has any lyrics to show. */
  hasLyrics: boolean;
  onOpenLyrics: () => void;
  /** Feature (Sleep timer) */
  sleepTimerEndsAt: number | null;
  sleepTimerEndOfTrack: boolean;
  onSetSleepTimer: (minutes: number | 'end-of-track' | null) => void;
  /** Feature (Repeat) */
  repeatMode: RepeatMode;
  onSetRepeat: (mode: RepeatMode) => void;
  /** Feature (Speed/pitch control) */
  playbackRate: number;
  preservePitch: boolean;
  onSetPlaybackRate: (r: number) => void;
  onSetPreservePitch: (p: boolean) => void;
  /** BUG FIX (light mode contrast): needed so the bar's background/overlay
      can follow the app theme instead of always rendering dark (see
      gradientFor above). */
  theme: 'dark' | 'light';
  /** Feature (Minimized Now Playing bar): 'normal' (default) renders the
   *  existing layouts unchanged. 'minimized' swaps the *mobile* layout only
   *  for a compact bar (art + title + play/pause + a plain progress line);
   *  the desktop (md:) layout always renders normally regardless of this
   *  prop. */
  playerBarStyle: PlayerBarStyle;
  /** Feature (Liquid Glass theme toggle): when true (the default), the
   *  scrim over the blurred/saturated album art backdrop is lighter, so
   *  more of that backdrop actually shows through -- a real sense of a
   *  glass pane over the art, not just a soft-edged color block. When
   *  false, the scrim goes back to its original, fully-opaque strength. */
  liquidGlass: boolean;
}

// Feature (Sleep timer): small popover menu shared by desktop/mobile layouts,
// mirroring the existing shuffle-mode popover's look and outside-click/Escape
// handling.
//
// BUGFIX: this used to be `position: absolute` inside the button's own
// wrapper, opening upward with `bottom-10`. On the mobile layout that button
// sits in the *top* row of the player card, and the card itself has
// `overflow-hidden` (see the outer `rounded-xl overflow-hidden` wrapper in
// PlayerBar) — so the menu had nowhere to open into and got clipped almost
// entirely, leaving just a sliver of its rounded border visible. Fixed by
// portaling the menu to `document.body` and positioning it with `fixed`
// coordinates computed from the trigger button's bounding rect, flipping
// between opening below/above depending on which has room.
function SleepTimerMenu({ accentColor, endsAt, endOfTrack, onSet, align }: {
  accentColor: string; endsAt: number | null; endOfTrack: boolean;
  onSet: (minutes: number | 'end-of-track' | null) => void;
  align: 'center' | 'left';
}) {
  const [open, setOpen] = useState(false);
  const [remaining, setRemaining] = useState('');
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = endsAt !== null || endOfTrack;
  const MENU_WIDTH = 192; // w-48
  const MENU_HEIGHT_ESTIMATE = 230; // enough for all 6 rows + padding

  useEffect(() => {
    if (!endsAt) { setRemaining(''); return; }
    const tick = () => {
      const ms = endsAt - Date.now();
      if (ms <= 0) { setRemaining(''); return; }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setRemaining(`${m}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (menuRef.current && !menuRef.current.contains(target)) setOpen(false);
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Recompute position whenever the menu opens, and keep it correct across
  // resizes/scrolls while it's open (fixed coordinates don't auto-follow the
  // button otherwise).
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const left = align === 'center'
        ? rect.left + rect.width / 2 - MENU_WIDTH / 2
        : rect.right - MENU_WIDTH;
      const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8));
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openBelow = spaceBelow >= MENU_HEIGHT_ESTIMATE || spaceBelow >= spaceAbove;
      const top = openBelow ? rect.bottom + 8 : Math.max(8, rect.top - MENU_HEIGHT_ESTIMATE - 8);
      setMenuPos({ top, left: clampedLeft });
    };
    reposition();
    window.addEventListener('resize', reposition);
    // FIX (menu stuck open while the song list scrolls behind it): see the
    // matching fix in PlayerOptionsMenu below — this button doesn't move
    // when the list scrolls, so close the menu instead of repositioning it.
    const scrollClose = () => setOpen(false);
    window.addEventListener('scroll', scrollClose, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', scrollClose, true);
    };
  }, [open, align]);

  const options: { label: string; value: number | 'end-of-track' }[] = [
    { label: '5 minutes', value: 5 }, { label: '15 minutes', value: 15 },
    { label: '30 minutes', value: 30 }, { label: '60 minutes', value: 60 },
    { label: 'End of track', value: 'end-of-track' },
  ];

  return (
    <div className="relative">
      <button ref={btnRef} onClick={() => setOpen((v) => !v)} className="btn-icon w-8 h-8 hover:bg-fg/10 rounded-lg relative" title="Sleep timer">
        <Moon size={16} style={{ color: active ? accentColor : 'rgb(var(--fg-rgb) / 0.45)' }} />
        {active && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: accentColor }} />}
      </button>
      {open && menuPos && createPortal(
        <div ref={menuRef}
          className="fixed w-48 rounded-xl overflow-hidden shadow-2xl border border-fg/10 z-50 animate-fade-in"
          style={{ top: menuPos.top, left: menuPos.left, background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-md)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))' }}>
          <div className="p-1">
            {remaining && (
              <div className="px-3 py-1.5 text-xs text-fg/40">Stops in {remaining}</div>
            )}
            {options.map((opt) => (
              <button key={String(opt.value)} onClick={() => { onSet(opt.value); setOpen(false); }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-fg/10"
                style={{ color: (opt.value === 'end-of-track' ? endOfTrack : false) ? accentColor : 'rgb(var(--fg-rgb) / 0.75)' }}>
                {opt.label}
                {opt.value === 'end-of-track' && endOfTrack && <Check size={13} />}
              </button>
            ))}
            {active && (
              <button onClick={() => { onSet(null); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors mt-1">
                Turn off
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Feature (Speed/pitch control): mirrors SleepTimerMenu's popover pattern
// (same positioning logic, outside-click/Escape handling) so it fits
// visually with the other player-bar popovers. Presets cover the common
// range (0.5x-2x); "Preserve pitch" toggles whether the pitch shifts along
// with speed (off) or stays natural regardless of speed (on, the default).
function PlaybackSpeedMenu({ accentColor, rate, preservePitch, onSetRate, onSetPreservePitch, align }: {
  accentColor: string; rate: number; preservePitch: boolean;
  onSetRate: (r: number) => void; onSetPreservePitch: (p: boolean) => void;
  align: 'center' | 'left';
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const active = rate !== 1;
  const MENU_WIDTH = 176; // w-44
  const MENU_HEIGHT_ESTIMATE = 300;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (menuRef.current && !menuRef.current.contains(target)) setOpen(false);
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const left = align === 'center'
        ? rect.left + rect.width / 2 - MENU_WIDTH / 2
        : rect.right - MENU_WIDTH;
      const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8));
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const openBelow = spaceBelow >= MENU_HEIGHT_ESTIMATE || spaceBelow >= spaceAbove;
      const top = openBelow ? rect.bottom + 8 : Math.max(8, rect.top - MENU_HEIGHT_ESTIMATE - 8);
      setMenuPos({ top, left: clampedLeft });
    };
    reposition();
    window.addEventListener('resize', reposition);
    // FIX (menu stuck open while the song list scrolls behind it): see the
    // matching fix in PlayerOptionsMenu below — this button doesn't move
    // when the list scrolls, so close the menu instead of repositioning it.
    const scrollClose = () => setOpen(false);
    window.addEventListener('scroll', scrollClose, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', scrollClose, true);
    };
  }, [open, align]);

  const presets = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  return (
    <div className="relative">
      <button ref={btnRef} onClick={() => setOpen((v) => !v)} className="btn-icon h-8 min-w-8 px-1.5 hover:bg-fg/10 rounded-lg relative flex items-center justify-center" title="Playback speed">
        <span className="text-[11px] font-semibold tabular-nums" style={{ color: active ? accentColor : 'rgb(var(--fg-rgb) / 0.45)' }}>{rate}&times;</span>
        {active && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: accentColor }} />}
      </button>
      {open && menuPos && createPortal(
        <div ref={menuRef}
          className="fixed w-44 rounded-xl overflow-hidden shadow-2xl border border-fg/10 z-50 animate-fade-in"
          style={{ top: menuPos.top, left: menuPos.left, background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-md)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))' }}>
          <div className="p-1">
            <div className="px-3 py-1.5 text-xs text-fg/40">Playback speed</div>
            {presets.map((p) => (
              <button key={p} onClick={() => onSetRate(p)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-fg/10"
                style={{ color: p === rate ? accentColor : 'rgb(var(--fg-rgb) / 0.75)' }}>
                {p}&times;{p === 1 && <span className="text-fg/30 text-xs">Normal</span>}
                {p === rate && <Check size={13} />}
              </button>
            ))}
            <div className="h-px bg-fg/10 my-1" />
            <button onClick={() => onSetPreservePitch(!preservePitch)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-fg/75 hover:bg-fg/10 transition-colors">
              Preserve pitch
              <span className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold tabular-nums" style={{ color: preservePitch ? accentColor : 'rgb(var(--fg-rgb) / 0.35)' }}>
                  {preservePitch ? 'On' : 'Off'}
                </span>
                <span className="w-8 h-4.5 rounded-full relative transition-colors shrink-0 border" style={{ background: preservePitch ? accentColor : 'rgb(var(--fg-rgb) / 0.08)', borderColor: preservePitch ? accentColor : 'rgb(var(--fg-rgb) / 0.25)' }}>
                  <span className="absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all" style={{ left: preservePitch ? 16 : 2, background: preservePitch ? 'rgb(var(--fg-rgb))' : 'rgb(var(--fg-rgb) / 0.85)' }} />
                </span>
              </span>
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Feature (Combined options button): merges the lyrics, playback-speed, and
// sleep-timer controls into a single trigger button + one popover, instead
// of three separate icons crowding the top-right corner of the mobile
// expanded player. Reuses the same portal/positioning pattern as the other
// popovers here.
function PlayerOptionsMenu({
  accentColor,
  rate, preservePitch, onSetRate, onSetPreservePitch,
  sleepEndsAt, sleepEndOfTrack, onSetSleepTimer,
  repeatMode, onSetRepeat,
  align,
}: {
  accentColor: string;
  rate: number; preservePitch: boolean;
  onSetRate: (r: number) => void; onSetPreservePitch: (p: boolean) => void;
  sleepEndsAt: number | null; sleepEndOfTrack: boolean;
  onSetSleepTimer: (minutes: number | 'end-of-track' | null) => void;
  /** Feature (Repeat): repeat mode lives on the player engine already
      (RepeatMode: 'off' | 'all' | 'one') — this just surfaces it in the
      3-dot menu alongside the other playback options. */
  repeatMode: RepeatMode;
  onSetRepeat: (mode: RepeatMode) => void;
  align: 'center' | 'left';
}) {
  const [open, setOpen] = useState(false);
  const [remaining, setRemaining] = useState('');
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [menuMaxHeight, setMenuMaxHeight] = useState<number | null>(null);
  // Feature (accordion sections): each section (Playback speed / Sleep
  // timer / Repeat) starts collapsed and only shows its options once its
  // header is tapped, rather than dumping all three fully expanded into
  // one long scrolling list.
  const [expandedSection, setExpandedSection] = useState<'speed' | 'sleep' | 'repeat' | null>(null);
  // FIX (large gap between menu and Now Playing bar): when the menu opens
  // "above" its trigger (the usual case here, since the trigger sits high
  // up in the tall mobile player bar), the top was placed using a flat
  // MENU_HEIGHT_ESTIMATE (200px) — but the accordion starts fully
  // collapsed, so the real rendered height is often much shorter, leaving
  // dead space between the menu's bottom edge and the button/bar below it.
  // Track which direction we opened in, then remeasure the actual DOM
  // height once rendered (below) and re-anchor the bottom edge exactly.
  const [openDirection, setOpenDirection] = useState<'below' | 'above'>('below');
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const speedActive = rate !== 1;
  const sleepActive = sleepEndsAt !== null || sleepEndOfTrack;
  const repeatActive = repeatMode !== 'off';
  const anyActive = speedActive || sleepActive || repeatActive;
  const MENU_WIDTH = 224; // w-56
  // Sections are collapsed by default now (see expandedSection state above),
  // so the menu's typical open height is closer to ~180px than the ~420px
  // it needed when everything rendered expanded at once.
  const MENU_HEIGHT_ESTIMATE = 200;

  useEffect(() => {
    if (!open) setExpandedSection(null);
  }, [open]);

  useEffect(() => {
    if (!sleepEndsAt) { setRemaining(''); return; }
    const tick = () => {
      const ms = sleepEndsAt - Date.now();
      if (ms <= 0) { setRemaining(''); return; }
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setRemaining(`${m}:${s.toString().padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [sleepEndsAt]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target)) return;
      if (menuRef.current && !menuRef.current.contains(target)) setOpen(false);
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const btn = btnRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const left = align === 'center'
        ? rect.left + rect.width / 2 - MENU_WIDTH / 2
        : rect.right - MENU_WIDTH;
      const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8));
      // FIX (menu rendering behind/under the Now Playing bar): this menu's
      // trigger doesn't always live inside the bar -- on mobile it can also
      // open from the "currently playing" row pinned near the top of the
      // list, far above it. The bar reserves a fixed 176px (84px on
      // desktop) at the bottom of the layout, which window.innerHeight
      // knows nothing about, so a menu opening "below" the button would
      // size itself against the full viewport and spill its lower half
      // behind the bar. Use the bar's own top edge as the floor instead,
      // so the menu always stops short of it.
      const barEl = document.querySelector('[data-player-bar-root]');
      const barTop = barEl ? barEl.getBoundingClientRect().top : window.innerHeight;
      const floor = barTop - 8;
      // FIX (menu overlapping the top of its own Now Playing bar): on
      // mobile this button lives inside the tall bar (near the album art),
      // not above it -- so "space above" can't just be rect.top (the
      // button's own position). That only clears the button, not the rest
      // of the bar sitting above it. Use whichever is higher up (smaller),
      // the button's top or the bar's own top, as the ceiling so an
      // "above" menu clears the entire bar, not just the button within it.
      const aboveCeiling = Math.min(rect.top, barTop);
      const spaceBelow = floor - rect.bottom;
      const spaceAbove = aboveCeiling;
      const openBelow = spaceBelow >= MENU_HEIGHT_ESTIMATE || spaceBelow >= spaceAbove;
      const top = openBelow ? rect.bottom + 8 : Math.max(8, aboveCeiling - MENU_HEIGHT_ESTIMATE - 8);
      const maxHeight = openBelow ? Math.max(120, floor - top) : Math.max(120, aboveCeiling - 16);
      setOpenDirection(openBelow ? 'below' : 'above');
      setMenuPos({ top, left: clampedLeft });
      setMenuMaxHeight(maxHeight);
    };
    reposition();
    window.addEventListener('resize', reposition);
    // FIX (menu stuck open while the song list scrolls behind it): this
    // button lives in the Player Bar, which doesn't move when the
    // (virtualized) song list underneath is scrolled, so re-measuring the
    // button's position on scroll was a no-op — the menu just sat there
    // indefinitely, floating over whatever had scrolled into view. Scroll
    // events don't bubble to a plain document listener, so listen in the
    // capture phase (which does see scroll events from any descendant
    // scrollable container) and close the menu as soon as scrolling starts,
    // matching the fix already used for the track row's 3-dot menu.
    const scrollClose = () => setOpen(false);
    window.addEventListener('scroll', scrollClose, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', scrollClose, true);
    };
  }, [open, align]);

  // FIX (large gap between menu and Now Playing bar), continued: once the
  // menu has actually painted, snap its bottom edge to sit 8px above the
  // trigger button instead of trusting the flat height estimate. Reruns
  // whenever an accordion section is expanded/collapsed, since that changes
  // the real height. The `Math.abs(...) > 1` guard stops this from looping
  // — after the first correction, remeasuring gives the same answer.
  useLayoutEffect(() => {
    if (!open || openDirection !== 'above') return;
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;
    const rect = btn.getBoundingClientRect();
    const barEl = document.querySelector('[data-player-bar-root]');
    const barTop = barEl ? barEl.getBoundingClientRect().top : rect.top;
    const aboveCeiling = Math.min(rect.top, barTop);
    const actualHeight = menu.offsetHeight;
    const top = Math.max(8, aboveCeiling - actualHeight - 8);
    setMenuPos((prev) => (prev && Math.abs(prev.top - top) > 1 ? { ...prev, top } : prev));
  }, [open, openDirection, expandedSection, menuPos]);

  const speedPresets = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const sleepOptions: { label: string; value: number | 'end-of-track' }[] = [
    { label: '5 minutes', value: 5 }, { label: '15 minutes', value: 15 },
    { label: '30 minutes', value: 30 }, { label: '60 minutes', value: 60 },
    { label: 'End of track', value: 'end-of-track' },
  ];

  return (
    <div className="relative">
      <button ref={btnRef} onClick={() => setOpen((v) => !v)}
        className="btn-icon w-8 h-8 hover:bg-fg/10 rounded-lg relative" title="More options">
        <MoreVertical size={16} style={{ color: anyActive ? accentColor : 'rgb(var(--fg-rgb) / 0.6)' }} />
        {anyActive && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: accentColor }} />}
      </button>
      {open && menuPos && createPortal(
        <div ref={menuRef}
          // z-[70]: this menu is rendered via a portal to document.body,
          // outside the Player Bar's own stacking context, so it needs to
          // outrank the bar's `z-[60]` (see App.tsx) directly -- z-50 sat
          // behind it and got visually clipped by the bar on mobile.
          // max-h uses menuMaxHeight (clamped to the Now Playing bar's top
          // edge in reposition() above) instead of a flat 80vh, so the menu
          // scrolls internally rather than rendering behind the bar.
          className="fixed w-56 rounded-xl overflow-hidden shadow-2xl border border-fg/10 z-[70] animate-fade-in overflow-y-auto"
          style={{ top: menuPos.top, left: menuPos.left, maxHeight: menuMaxHeight ?? '80vh', background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-md)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))' }}>
          <div className="p-1">
            {/* Playback speed */}
            <button onClick={() => setExpandedSection((s) => (s === 'speed' ? null : 'speed'))}
              className="w-full flex items-center justify-between gap-2 px-3 pt-1.5 pb-1 text-xs text-fg/40 hover:text-fg/60 transition-colors">
              <span className="flex items-center gap-1.5"><Gauge size={12} /> Playback speed</span>
              <span className="flex items-center gap-1.5">
                <span className="tabular-nums" style={{ color: speedActive ? accentColor : undefined }}>{rate}&times;</span>
                <ChevronDown size={12} className="transition-transform" style={{ transform: expandedSection === 'speed' ? 'rotate(180deg)' : undefined }} />
              </span>
            </button>
            {expandedSection === 'speed' && (
              <>
                <div className="grid grid-cols-4 gap-1 px-2 pb-1.5">
                  {speedPresets.map((p) => (
                    <button key={p} onClick={() => onSetRate(p)}
                      className="py-1.5 rounded-lg text-xs font-semibold tabular-nums transition-colors"
                      style={{
                        background: p === rate ? accentColor : 'rgb(var(--fg-rgb) / 0.06)',
                        color: p === rate ? getContrastText(accentColor) : 'rgb(var(--fg-rgb) / 0.7)',
                      }}>
                      {p}&times;
                    </button>
                  ))}
                </div>
                <button onClick={() => onSetPreservePitch(!preservePitch)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm text-fg/75 hover:bg-fg/10 transition-colors">
                  Preserve pitch
                  <span className="flex items-center gap-1.5">
                    <span className="text-[10px] font-semibold tabular-nums" style={{ color: preservePitch ? accentColor : 'rgb(var(--fg-rgb) / 0.35)' }}>
                      {preservePitch ? 'On' : 'Off'}
                    </span>
                    <span className="w-8 h-4.5 rounded-full relative transition-colors shrink-0 border" style={{ background: preservePitch ? accentColor : 'rgb(var(--fg-rgb) / 0.08)', borderColor: preservePitch ? accentColor : 'rgb(var(--fg-rgb) / 0.25)' }}>
                      <span className="absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all" style={{ left: preservePitch ? 16 : 2, background: preservePitch ? 'rgb(var(--fg-rgb))' : 'rgb(var(--fg-rgb) / 0.85)' }} />
                    </span>
                  </span>
                </button>
              </>
            )}

            <div className="h-px bg-fg/10 my-1" />

            {/* Sleep timer */}
            <button onClick={() => setExpandedSection((s) => (s === 'sleep' ? null : 'sleep'))}
              className="w-full flex items-center justify-between gap-2 px-3 pt-1.5 pb-1 text-xs text-fg/40 hover:text-fg/60 transition-colors">
              <span className="flex items-center gap-1.5"><Moon size={12} /> Sleep timer</span>
              <span className="flex items-center gap-1.5">
                {sleepActive && (
                  <span style={{ color: accentColor }}>
                    {remaining || (sleepEndOfTrack ? 'End of track' : '')}
                  </span>
                )}
                <ChevronDown size={12} className="transition-transform" style={{ transform: expandedSection === 'sleep' ? 'rotate(180deg)' : undefined }} />
              </span>
            </button>
            {expandedSection === 'sleep' && (
              <>
                {sleepOptions.map((opt) => (
                  <button key={String(opt.value)} onClick={() => { onSetSleepTimer(opt.value); setOpen(false); }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-fg/10"
                    style={{ color: (opt.value === 'end-of-track' ? sleepEndOfTrack : false) ? accentColor : 'rgb(var(--fg-rgb) / 0.75)' }}>
                    {opt.label}
                    {opt.value === 'end-of-track' && sleepEndOfTrack && <Check size={13} />}
                  </button>
                ))}
                {sleepActive && (
                  <button onClick={() => { onSetSleepTimer(null); setOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-red-400 hover:bg-red-500/10 transition-colors mt-1">
                    Turn off sleep timer
                  </button>
                )}
              </>
            )}

            <div className="h-px bg-fg/10 my-1" />

            {/* Feature (Repeat) */}
            <button onClick={() => setExpandedSection((s) => (s === 'repeat' ? null : 'repeat'))}
              className="w-full flex items-center justify-between gap-2 px-3 pt-1.5 pb-1 text-xs text-fg/40 hover:text-fg/60 transition-colors">
              <span className="flex items-center gap-1.5"><Repeat size={12} /> Repeat</span>
              <span className="flex items-center gap-1.5">
                <span style={{ color: repeatActive ? accentColor : undefined }}>
                  {repeatMode === 'off' ? 'Off' : repeatMode === 'all' ? 'All' : 'One'}
                </span>
                <ChevronDown size={12} className="transition-transform" style={{ transform: expandedSection === 'repeat' ? 'rotate(180deg)' : undefined }} />
              </span>
            </button>
            {expandedSection === 'repeat' && ([
              { mode: 'off' as RepeatMode, label: 'Off', icon: Repeat },
              { mode: 'all' as RepeatMode, label: 'Repeat all', icon: Repeat },
              { mode: 'one' as RepeatMode, label: 'Repeat one', icon: Repeat1 },
            ]).map(({ mode, label, icon: Icon }) => (
              <button key={mode} onClick={() => { onSetRepeat(mode); setOpen(false); }}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm transition-colors hover:bg-fg/10"
                style={{ color: repeatMode === mode ? accentColor : 'rgb(var(--fg-rgb) / 0.75)' }}>
                <span className="flex items-center gap-2"><Icon size={14} /> {label}</span>
                {repeatMode === mode && <Check size={13} />}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

export function PlayerBar({
  currentSong, artUrl, isPlaying, isLoading,
  currentTime, duration, volume, muted, shuffleMode, accentColor, queueCount,
  onPrev, onNext, onTogglePlay, onSeek, onVolume, onMute,
  onShuffleToggle, onShuffleModeChange, onOpenQueue,
  hasLyrics, onOpenLyrics, sleepTimerEndsAt, sleepTimerEndOfTrack, onSetSleepTimer,
  repeatMode, onSetRepeat,
  playbackRate, preservePitch, onSetPlaybackRate, onSetPreservePitch,
  theme, playerBarStyle, liquidGlass,
}: Props) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bg = currentSong ? gradientFor(currentSong.title, theme) : 'linear-gradient(135deg, rgb(var(--elevated-rgb)), rgb(var(--bg-rgb)))';
  const [showShuffleMenu, setShowShuffleMenu] = useState(false);
  const shuffleRef = useRef<HTMLDivElement>(null);
  // Minimized mobile bar's progress line: tap = seek, horizontal swipe =
  // prev/next track. Tracked with a ref (not state) since we only need the
  // start position to classify the gesture on pointer-up; no re-render
  // needed while dragging.
  const miniBarGesture = useRef<{ startX: number; startY: number } | null>(null);
  const MINI_SWIPE_THRESHOLD = 40; // px of horizontal movement to count as a swipe
  const onMiniBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    miniBarGesture.current = { startX: e.clientX, startY: e.clientY };
  };
  const onMiniBarPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = miniBarGesture.current;
    miniBarGesture.current = null;
    if (!start) return;
    const dx = e.clientX - start.startX;
    const dy = e.clientY - start.startY;
    if (Math.abs(dx) > MINI_SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) onNext(); else onPrev();
      return;
    }
    // Otherwise treat as a tap: seek to the tapped position.
    if (!duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    onSeek(pct * duration);
  };
  // Play/pause icons and the queue-count badge sit on an accentColor
  // background -- pick black or white per the *current* accent instead of
  // assuming black works (it doesn't for darker accents like blue/purple).
  const onAccent = getContrastText(accentColor);

  // BUG FIX (broken album art): `artUrl` being non-null only means we *tried*
  // to build an object URL for the art — it doesn't guarantee the browser can
  // actually decode it (corrupt/truncated art bytes, an unsupported image
  // format, etc). Previously there was no <img onError>, so a bad artUrl just
  // rendered the browser's broken-image icon with nothing in the console to
  // explain why. Track failures per artUrl and fall back to the placeholder
  // note icon everywhere this art is shown (background blur + both
  // thumbnails), and log a descriptive warning so it's diagnosable.
  const [artFailed, setArtFailed] = useState(false);
  useEffect(() => { setArtFailed(false); }, [artUrl]);
  const showArt = !!artUrl && !artFailed;
  const handleArtError = () => {
    if (artFailed) return;
    console.warn(
      `[PlayerBar] Album art failed to load for "${currentSong?.title ?? 'unknown track'}"` +
      (currentSong?.artist ? ` by ${currentSong.artist}` : '') +
      ` (mime: ${currentSong?.albumArtMime ?? 'unknown'}). Falling back to placeholder icon.`,
      { songId: currentSong?.id, fileName: currentSong?.fileName, artUrl },
    );
    setArtFailed(true);
  };

  useEffect(() => {
    if (!showShuffleMenu) return;
    const handler = (e: MouseEvent) => {
      if (shuffleRef.current && !shuffleRef.current.contains(e.target as Node)) setShowShuffleMenu(false);
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 0);
    return () => document.removeEventListener('mousedown', handler);
  }, [showShuffleMenu]);

  const shuffleActive = shuffleMode !== 'off';

  return (
    <div className="relative h-full overflow-hidden rounded-2xl shadow-panel"
      style={{ boxShadow: `var(--shadow-panel-outer), 0 0 0 1px ${accentColor}1f` }}>
      {/* Blurred background */}
      <div className="absolute inset-0 transition-all duration-700" style={{ background: bg }}>
        {showArt && (
          <img src={artUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25 scale-110 transition-all duration-700"
            style={{ filter: 'blur(var(--glass-blur-panel, 24px)) saturate(var(--glass-saturate, 100%)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))' }} onError={handleArtError} />
        )}
      </div>
      {/* BUG FIX (light mode contrast): this scrim used to be a flat
          `bg-black/55` in every theme, which is what kept darkening the bar
          back to near-black even after the gradient above went light-mode
          aware -- `text-fg`'s dark-mode text (near-white) still needs a dark
          backdrop to read against, but light mode's `text-fg` is near-black
          and needs the opposite: a light wash instead of a dark one. Tied to
          the same --surface-rgb token the rest of the theme system uses
          (see index.css) rather than a second hardcoded color.
          Feature (Liquid Glass theme toggle): eased back further (roughly
          -35%) when liquidGlass is on so the saturated, blurred art behind
          it actually reads as glass rather than being nearly covered by a
          flat scrim -- back to the original full strength when it's off. */}
      <div className="absolute inset-0" style={{ background: `rgb(var(--surface-rgb) / ${(theme === 'light' ? 0.72 : 0.55) * (liquidGlass ? 0.64 : 1)})` }} />

      {/* ── MOBILE MINIMIZED LAYOUT (<768px) ── */}
      {/* Feature (Minimized Now Playing bar): compact single-row bar for
          when playerBarStyle === 'minimized'. Only album art, song name, a
          play/pause button, and a progress line -- everything else (artist
          name, shuffle/queue/lyrics/etc.) is intentionally left out. The
          progress line sits flush along the bottom edge of the card rather
          than reusing <SeekBar>, since this mode is meant to be a compact
          summary bar; it's still interactive though -- tap to seek, swipe to
          skip prev/next (see onMiniBarPointerDown/Up below). Pairs with the
          shorter h-[68px] mobile container height set in App.tsx for this
          mode. */}
      {playerBarStyle === 'minimized' && (
        <div className="md:hidden relative h-full flex items-center gap-3 px-4">
          <div className="w-11 h-11 rounded-lg shrink-0 overflow-hidden flex items-center justify-center ring-1 ring-fg/10 shadow-lift"
            style={{ background: currentSong ? placeholderBackground(accentColor) : 'rgb(var(--elevated-rgb))' }}>
            {showArt ? <img src={artUrl} alt="" className="w-full h-full object-cover" onError={handleArtError} />
              : currentSong ? <span className="text-sm font-semibold" style={{ color: accentColor }}>{initialFor(currentSong)}</span>
              : <Music size={18} className="text-fg/20" />}
          </div>
          <div className="min-w-0 flex-1">
            {currentSong ? (
              <MarqueeText text={currentSong.title} className="text-fg text-sm font-semibold leading-tight" />
            ) : <p className="text-fg/25 text-sm select-none">Nothing playing</p>}
          </div>
          <button onClick={onTogglePlay}
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 transition-all active:scale-90 hover:scale-[1.03]"
            style={{ background: accentColor, boxShadow: `0 4px 16px -2px ${accentColor}66, 0 0 0 1px rgb(var(--fg-rgb) / 0.08) inset` }} title="Play/Pause">
            {isLoading ? (
              <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin"
                style={{ borderColor: `${onAccent}33`, borderTopColor: onAccent }} />
            ) : isPlaying ? (
              <Pause size={17} fill={onAccent} style={{ color: onAccent }} />
            ) : (
              <Play size={17} fill={onAccent} className="ml-0.5" style={{ color: onAccent }} />
            )}
          </button>
          {/* Progress line, flush to the bottom edge of the card. Interactive:
              tap seeks to that point in the song; a horizontal swipe skips to
              the prev/next track. The outer div gives a taller (12px) hit
              area for touch than the 4px visual bar, so it's easy to grab. */}
          <div
            className="absolute left-0 right-0 bottom-0 h-3 flex items-end cursor-pointer"
            style={{ touchAction: 'pan-y' }}
            onPointerDown={onMiniBarPointerDown}
            onPointerUp={onMiniBarPointerUp}
            onPointerCancel={() => { miniBarGesture.current = null; }}
            role="slider"
            aria-label="Seek (swipe to change track)"
            aria-valuemin={0}
            aria-valuemax={duration || 0}
            aria-valuenow={currentTime}
          >
            <div className="w-full h-1 bg-fg/10 overflow-hidden rounded-b-2xl">
              <div className="h-full transition-all" style={{ width: `${progress}%`, background: accentColor }} />
            </div>
          </div>
        </div>
      )}

      {/* ── MOBILE LAYOUT (<768px) ── */}
      {/* Taller 3-row "expanded" layout: art+title row, transport-controls
          row, and a full seek row with time labels — matches the target
          design. Requires the taller parent height set in App.tsx
          (h-[180px] md:h-[68px]) instead of the old fixed 68px on both
          breakpoints. */}
      {playerBarStyle === 'normal' && (
      <div className="md:hidden relative h-full flex flex-col justify-center gap-4 px-4 py-4">
        {/* NOTE: the transport row and seek row below share a tighter gap-2
            (see that row's `mt-2`, which overrides the gap-4 spacing from
            this parent) so the play button doesn't float far above the
            progress bar. */}
        {/* ALIGNMENT FIX: art + title/artist are left-aligned (not centered)
            — flex row starting at the container's left edge. */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-xl shrink-0 overflow-hidden flex items-center justify-center ring-1 ring-fg/10 shadow-lift"
            style={{ background: currentSong ? placeholderBackground(accentColor) : 'rgb(var(--elevated-rgb))' }}>
            {showArt ? <img src={artUrl} alt="" className="w-full h-full object-cover" onError={handleArtError} />
              : currentSong ? <span className="text-sm font-semibold" style={{ color: accentColor }}>{initialFor(currentSong)}</span>
              : <Music size={18} className="text-fg/20" />}
          </div>
          <div className="min-w-0 flex-1">
            {currentSong ? (
              <>
                {/* LONG SONG NAMES FIX: MarqueeText only animates when the
                    title actually overflows its box; otherwise it stays
                    static, no ellipsis, no clipping. */}
                <MarqueeText text={currentSong.title} className="text-fg text-base font-semibold leading-tight" />
                <p className="text-fg/50 text-sm truncate mt-0.5 leading-tight select-none">{currentSong.artist}</p>
              </>
            ) : <p className="text-fg/25 text-sm select-none">Nothing playing</p>}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {/* Lyrics gets its own button (previously buried inside the
                combined "more options" menu below, which made it a couple
                extra taps away). Playback speed + sleep timer still share
                that one menu. */}
            <button onClick={onOpenLyrics} disabled={!currentSong}
              className="btn-icon w-8 h-8 hover:bg-fg/10 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent"
              title={hasLyrics ? 'Lyrics' : 'Import lyrics'}>
              <Mic2 size={16} style={{ color: hasLyrics ? accentColor : 'rgb(var(--fg-rgb) / 0.6)' }} />
            </button>
            <PlayerOptionsMenu
              accentColor={accentColor}
              rate={playbackRate} preservePitch={preservePitch} onSetRate={onSetPlaybackRate} onSetPreservePitch={onSetPreservePitch}
              sleepEndsAt={sleepTimerEndsAt} sleepEndOfTrack={sleepTimerEndOfTrack} onSetSleepTimer={onSetSleepTimer}
              repeatMode={repeatMode} onSetRepeat={onSetRepeat}
              align="left"
            />
          </div>
        </div>

        {/* Transport controls — shuffle and queue are pinned to the row's
            outer edges, with prev/play/next centered as their own group
            in the middle, spread across the full width of the bar. */}
        <div className="flex items-center justify-between">
          <div ref={shuffleRef} className="relative">
            <button onClick={onShuffleToggle} onContextMenu={(e) => { e.preventDefault(); setShowShuffleMenu(true); }}
              className="w-9 h-9 flex items-center justify-center" title="Shuffle">
              <Shuffle size={19} style={{ color: shuffleActive ? accentColor : 'rgb(var(--fg-rgb) / 0.45)' }} />
            </button>
            {shuffleActive && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: accentColor }} />}
            {showShuffleMenu && (
              <div className="absolute bottom-10 left-0 w-44 rounded-xl overflow-hidden shadow-2xl border border-fg/10 z-50 animate-fade-in"
                style={{ background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-md)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))' }}>
                <div className="p-1">
                  {(['off', 'view', 'library'] as ShuffleMode[]).map((mode) => (
                    <button key={mode} onClick={() => { onShuffleModeChange(mode); setShowShuffleMenu(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
                      style={{ background: shuffleMode === mode ? 'rgb(var(--fg-rgb) / 0.1)' : 'transparent', color: shuffleMode === mode ? accentColor : 'rgb(var(--fg-rgb) / 0.75)' }}>
                      {mode === 'off' && <><Shuffle size={13} />Off</>}
                      {mode === 'view' && <><Shuffle size={13} />Shuffle view</>}
                      {mode === 'library' && <><Library size={13} />Shuffle library</>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4">
            <button onClick={onPrev} className="w-9 h-9 flex items-center justify-center text-fg/70 active:scale-90 transition-transform" title="Previous">
              <SkipBack size={22} fill="currentColor" />
            </button>
            <button onClick={onTogglePlay}
              className="w-12 h-12 rounded-full flex items-center justify-center transition-all active:scale-90 hover:scale-[1.03]"
              style={{ background: accentColor, boxShadow: `0 4px 16px -2px ${accentColor}66, 0 0 0 1px rgb(var(--fg-rgb) / 0.08) inset` }} title="Play/Pause">
              {isLoading ? (
                <div className="w-4 h-4 border-2 rounded-full animate-spin"
                  style={{ borderColor: `${onAccent}33`, borderTopColor: onAccent }} />
              ) : isPlaying ? (
                <Pause size={20} fill={onAccent} style={{ color: onAccent }} />
              ) : (
                <Play size={20} fill={onAccent} className="ml-0.5" style={{ color: onAccent }} />
              )}
            </button>
            <button onClick={onNext} className="w-9 h-9 flex items-center justify-center text-fg/70 active:scale-90 transition-transform" title="Next">
              <SkipForward size={22} fill="currentColor" />
            </button>
          </div>

          <button onClick={onOpenQueue} className="w-9 h-9 flex items-center justify-center relative" title="Queue">
            <ListMusic size={19} style={{ color: queueCount > 0 ? accentColor : 'rgb(var(--fg-rgb) / 0.45)' }} />
            {queueCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full"
                style={{ background: accentColor, color: onAccent }}>{queueCount > 9 ? '9+' : queueCount}</span>
            )}
          </button>
        </div>

        {/* Full seek row with time labels on both ends. `-mt-3` cuts the
            parent's gap-4 (16px) down to ~4px here specifically, so the
            progress bar sits close under the play button instead of
            floating with the same 16px gap used elsewhere in the card. */}
        <div className="flex items-center gap-2 -mt-3">
          <span className="text-xs text-fg/40 tabular-nums w-9">{formatTime(currentTime)}</span>
          <SeekBar progress={progress} duration={duration} accentColor={accentColor} onSeek={onSeek} />
          <span className="text-xs text-fg/40 tabular-nums w-9 text-right">{formatTime(duration)}</span>
        </div>
      </div>
      )}

      {/* ── DESKTOP LAYOUT (≥768px) ── */}
      {/* FIX (pause/play button off-center): this row had no
          justify-content, so its default packing (flex-start) let the
          three sections — left art/title (28%), center transport controls
          (flex-1, capped at max-w-520px), right utility icons (28%) — bunch
          together on the left whenever the window was wide enough that the
          center block hit its 520px cap. Any space left over past that
          point was stranded after the right icons instead of pushing them
          to the edge, which visually dragged the whole middle+right
          section (and therefore the play/pause button) left of true
          center. Since the left and right blocks are equal width (28%
          each), `justify-between` splits that leftover space evenly into
          the two gaps around the center block — which lands the transport
          controls exactly at the horizontal midpoint of the bar and pins
          the right-side icons flush to the right edge, matching how
          desktop music players are normally laid out. */}
      <div className="hidden md:flex relative h-full items-center justify-between px-4 gap-3">
        {/* FIX 1 (SIZE) + FIX 2 (ALIGNMENT): fixed 48x48 art, row stays
            items-center (vertically centered), title/artist bumped up to
            14px/12px (from 13px/11px) now that the row has the height to
            support it without feeling cramped. */}
        <div className="flex items-center gap-3 w-[28%] min-w-0 shrink-0">
          <div className="w-12 h-12 rounded-lg shrink-0 overflow-hidden flex items-center justify-center ring-1 ring-fg/10 shadow-lift"
            style={{ background: currentSong ? placeholderBackground(accentColor) : 'rgb(var(--elevated-rgb))' }}>
            {showArt ? <img src={artUrl} alt="" className="w-full h-full object-cover" onError={handleArtError} />
              : currentSong ? <span className="text-sm font-semibold" style={{ color: accentColor }}>{initialFor(currentSong)}</span>
              : <Music size={18} className="text-fg/20" />}
          </div>
          <div className="min-w-0">
            {currentSong ? (
              <>
                {/* FIX 3 (LONG SONG NAMES): MarqueeText replaces the plain
                    truncating <p> — only animates when the title overflows. */}
                <MarqueeText text={currentSong.title} className="text-fg text-sm font-semibold leading-tight" />
                <p className="text-fg/45 text-xs truncate mt-0.5 leading-tight select-none">{currentSong.artist}</p>
              </>
            ) : <p className="text-fg/25 text-sm select-none">Nothing playing</p>}
          </div>
        </div>

        {/* Center controls */}
        <div className="flex flex-col items-center justify-center gap-1 flex-1 max-w-[520px]">
          <div className="flex items-center justify-center gap-2">
            <div ref={shuffleRef} className="relative">
              <button onClick={onShuffleToggle} onContextMenu={(e) => { e.preventDefault(); setShowShuffleMenu(true); }}
                className="btn-icon w-7 h-7 hover:bg-fg/10 rounded-lg" title="Shuffle">
                <Shuffle size={15} style={{ color: shuffleActive ? accentColor : 'rgb(var(--fg-rgb) / 0.45)' }} />
              </button>
              {shuffleActive && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: accentColor }} />}
              {showShuffleMenu && (
                <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-44 rounded-xl overflow-hidden shadow-2xl border border-fg/10 z-50 animate-fade-in"
                  style={{ background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-md)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))' }}>
                  <div className="p-1">
                    {(['off', 'view', 'library'] as ShuffleMode[]).map((mode) => (
                      <button key={mode} onClick={() => { onShuffleModeChange(mode); setShowShuffleMenu(false); }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
                        style={{ background: shuffleMode === mode ? 'rgb(var(--fg-rgb) / 0.1)' : 'transparent', color: shuffleMode === mode ? accentColor : 'rgb(var(--fg-rgb) / 0.75)' }}>
                        {mode === 'off' && <><Shuffle size={13} />Off</>}
                        {mode === 'view' && <><Shuffle size={13} />Shuffle view</>}
                        {mode === 'library' && <><Library size={13} />Shuffle library</>}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button onClick={onPrev} className="btn-icon w-8 h-8 text-fg/65 hover:text-fg" title="Previous">
              <SkipBack size={18} fill="currentColor" />
            </button>
            <button onClick={onTogglePlay}
              className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95"
              style={{ background: accentColor, boxShadow: `0 3px 12px -2px ${accentColor}66, 0 0 0 1px rgb(var(--fg-rgb) / 0.08) inset` }} title="Play/Pause">
              {isLoading ? (
                <div className="w-3.5 h-3.5 border-2 rounded-full animate-spin"
                  style={{ borderColor: `${onAccent}33`, borderTopColor: onAccent }} />
              ) : isPlaying ? (
                <Pause size={18} fill={onAccent} style={{ color: onAccent }} />
              ) : (
                <Play size={18} fill={onAccent} style={{ color: onAccent }} />
              )}
            </button>
            <button onClick={onNext} className="btn-icon w-8 h-8 text-fg/65 hover:text-fg" title="Next">
              <SkipForward size={18} fill="currentColor" />
            </button>
          </div>

          <div className="flex items-center gap-2 w-full max-w-md">
            <span className="text-[10px] text-fg/35 tabular-nums w-8 text-right">{formatTime(currentTime)}</span>
            <SeekBar progress={progress} duration={duration} accentColor={accentColor} onSeek={onSeek} />
            <span className="text-[10px] text-fg/35 tabular-nums w-8">{formatTime(duration)}</span>
          </div>
        </div>

        {/* Right: lyrics + sleep timer + queue + volume */}
        <div className="flex items-center gap-2 w-[28%] justify-end shrink-0">
          {/* Feature (Lyrics import): same rationale as the mobile button
              above — enabled whenever a song is loaded so missing lyrics can
              be imported, not just viewed once present. */}
          <button onClick={onOpenLyrics} disabled={!currentSong}
            className="btn-icon w-8 h-8 hover:bg-fg/10 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent" title={hasLyrics ? 'Lyrics' : 'Import lyrics'}>
            <Mic2 size={16} className="text-fg/60" />
          </button>
          <PlaybackSpeedMenu accentColor={accentColor} rate={playbackRate} preservePitch={preservePitch} onSetRate={onSetPlaybackRate} onSetPreservePitch={onSetPreservePitch} align="center" />
          <SleepTimerMenu accentColor={accentColor} endsAt={sleepTimerEndsAt} endOfTrack={sleepTimerEndOfTrack} onSet={onSetSleepTimer} align="center" />
          <button onClick={onOpenQueue} className="btn-icon w-8 h-8 hover:bg-fg/10 rounded-lg relative" title="Queue">
            <ListMusic size={17} style={{ color: queueCount > 0 ? accentColor : 'rgb(var(--fg-rgb) / 0.45)' }} />
            {queueCount > 0 && (
              <span className="absolute -top-1 -right-1 text-[9px] font-bold w-4 h-4 flex items-center justify-center rounded-full"
                style={{ background: accentColor, color: onAccent }}>{queueCount > 9 ? '9+' : queueCount}</span>
            )}
          </button>
          <button onClick={onMute} className="btn-icon w-8 h-8 text-fg/45 hover:text-fg">
            {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </button>
          <div className="relative w-24 h-1.5 rounded-full bg-fg/15 cursor-pointer"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onVolume(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); }}>
            <div className="absolute h-full rounded-full transition-all" style={{ width: `${(muted ? 0 : volume) * 100}%`, background: accentColor }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// Replaced by <WaveformSeekBar> (see ./WaveformSeekBar.tsx), which renders
// the song's actual amplitude shape and handles the same click/drag/touch
// interactions this used to.
