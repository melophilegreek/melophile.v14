import { useEffect, useRef, useState } from 'react';
import { X, Check, Heart, Trash2, AlertTriangle, Sparkles, ImagePlus, Download, Upload, SlidersHorizontal, FolderOpen, ChevronDown, Palette, Moon, Sun, Gauge, Droplets } from 'lucide-react';
import type { ArtRescanProgress } from '../lib/scanner';
import type { LoudnessProgress } from '../lib/loudness';
import { getContrastText, resolveAccentColor, NEUTRAL_ACCENT } from '../lib/color';
import { Slider } from './Slider';
import { CustomColorPicker } from './CustomColorPicker';
import { EQ_BANDS, EQ_PRESETS, EQ_MIN_DB, EQ_MAX_DB, matchPreset, type EQBandKey, type EQState } from '../lib/eqPresets';
import type { RowSize, PlayerBarStyle } from '../types';

const PRESETS = [
  { name: 'Green', color: '#1DB954' }, { name: 'Purple', color: '#9B59B6' },
  { name: 'Blue', color: '#3498DB' }, { name: 'Red', color: '#E74C3C' },
  { name: 'Orange', color: '#E67E22' }, { name: 'Pink', color: '#FF6B9D' },
  { name: 'Teal', color: '#1ABC9C' }, { name: 'Gold', color: '#F1C40F' },
  // Feature (Transparent/neutral accent): not a real color -- stores the
  // NEUTRAL_ACCENT sentinel, which resolves to the current theme's plain
  // foreground color wherever accentColor is actually used (see
  // lib/color.ts). Rendered as a checkerboard swatch below since
  // `background: 'neutral'` isn't valid CSS.
  { name: 'Transparent', color: NEUTRAL_ACCENT },
];

// Extra jewel-tone / metallic palette, kept separate from PRESETS above so
// the original 8 colors are untouched — just an additional row of options.
const PREMIUM_PRESETS = [
  { name: 'Rose Gold', color: '#E0A899' }, { name: 'Platinum', color: '#D4D8DD' },
  { name: 'Champagne', color: '#E6C79C' }, { name: 'Sapphire', color: '#2C5FCC' },
  { name: 'Emerald', color: '#0E9F6E' }, { name: 'Amethyst', color: '#A855F7' },
  { name: 'Ruby', color: '#E11D48' }, { name: 'Bronze', color: '#C08552' },
];

interface Props {
  accentColor: string;
  /** Feature (Transparent/neutral accent): the raw, un-resolved accent
   *  setting (a real hex, or the NEUTRAL_ACCENT sentinel) -- distinct from
   *  `accentColor` above, which is always the *resolved*, real-hex color
   *  every other part of the app uses. This panel needs the raw value too,
   *  so the "Transparent" preset can correctly show as selected (comparing
   *  a resolved hex like #ffffff back against the sentinel would never
   *  match) and so Done persists the user's actual choice, not today's
   *  resolved stand-in for it. */
  manualAccentColor: string;
  onAccentChange: (color: string) => void;
  onClose: () => void;
  /** Feature (Light/Dark theme toggle): current theme + setter. Defaults to
   *  'dark' -- the app's original, only look before this feature existed. */
  theme: 'dark' | 'light';
  onSetTheme: (t: 'dark' | 'light') => void;
  /** Feature (Liquid Glass theme toggle): when on (the default), modal,
   *  popover, and player-bar surfaces get the frosted/saturated "glass"
   *  treatment; when off, those same surfaces fall back to solid, opaque,
   *  unblurred panels. */
  liquidGlass: boolean;
  onToggleLiquidGlass: (v: boolean) => void;
  /** Feature (Dynamic theming): when on, the accent color automatically
   *  follows the dominant color of whatever's currently playing album art
   *  instead of the manually-picked color below. */
  autoTheme: boolean;
  onToggleAutoTheme: (v: boolean) => void;
  /** Feature (Row size): current row density and setter, applied across
   *  Library/playlist/artist/album/search song lists. */
  rowSize: RowSize;
  onRowSizeChange: (size: RowSize) => void;
  /** Feature (Minimized Now Playing bar): 'normal' (current full layout) or
   *  'minimized' (art + title + play/pause + a plain progress line).
   *  Minimized only affects the mobile bar -- desktop is unchanged. */
  playerBarStyle: PlayerBarStyle;
  onPlayerBarStyleChange: (style: PlayerBarStyle) => void;
  /** Current library size — used to disable the delete-all action and
   *  word the confirmation dialog (e.g. "Delete 850 songs?"). */
  songCount: number;
  onDeleteAllSongs: () => void | Promise<void>;
  /** Re-scans every song's album art against its already-stored audio blob
   *  (see scanner.ts's rescanMissingArt for why this is needed). */
  onRescanArt: () => void | Promise<void>;
  /** Live progress while a rescan is running; null when idle. */
  artRescan: (ArtRescanProgress & { running: boolean }) | null;
  /** Feature (Gapless/Crossfade) */
  crossfadeSeconds: number;
  onCrossfadeChange: (seconds: number) => void;
  /** Feature (5-band EQ + presets) */
  eq: EQState;
  onEQChange: (band: EQBandKey, db: number) => void;
  onEQPreset: (bands: EQState) => void;
  /** Feature (Library backup/restore) */
  onExportBackup: () => void;
  onImportBackupFile: (file: File) => Promise<{ matchedSongs: number; unmatchedSongs: number; playlistsCreated: number }>;
  /** Feature (Auto Rescan): whether the browser supports the File System
   *  Access API this relies on (Chromium only — Chrome/Edge desktop and
   *  Android; not Safari, not Firefox). */
  autoRescanSupported: boolean;
  autoRescanEnabled: boolean;
  /** Name of the currently-watched folder, shown once enabled. */
  autoRescanFolderName?: string;
  onEnableAutoRescan: () => void | Promise<void>;
  onDisableAutoRescan: () => void | Promise<void>;
  /** Feature (OS notifications) */
  osNotifications: boolean;
  onToggleOSNotifications: () => void | Promise<void>;
  onSendTestNotification: () => void;
  notificationsSupported: boolean;
  notifPermission: NotificationPermission;
  /** Feature (Manage Folders): opens the full-screen folder list/removal
   *  screen. Always available (doesn't depend on File System Access API
   *  support) since `importFolder` is captured for any folder-based import,
   *  including the plain <input webkitdirectory> path every browser has. */
  onManageFolders: () => void;
  /** Feature (Loudness normalization) */
  normalizeVolume: boolean;
  onToggleNormalizeVolume: (on: boolean) => void;
  onAnalyzeLoudness: () => void | Promise<void>;
  loudnessScan: (LoudnessProgress & { running: boolean }) | null;
}

export function SettingsPanel({
  accentColor, manualAccentColor, onAccentChange, onClose, theme, onSetTheme, liquidGlass, onToggleLiquidGlass, autoTheme, onToggleAutoTheme, rowSize, onRowSizeChange, playerBarStyle, onPlayerBarStyleChange, songCount, onDeleteAllSongs, onRescanArt, artRescan,
  crossfadeSeconds, onCrossfadeChange, eq, onEQChange, onEQPreset, onExportBackup, onImportBackupFile,
  autoRescanSupported, autoRescanEnabled, autoRescanFolderName, onEnableAutoRescan, onDisableAutoRescan,
  osNotifications, onToggleOSNotifications, onSendTestNotification, notificationsSupported, notifPermission,
  onManageFolders,
  normalizeVolume, onToggleNormalizeVolume, onAnalyzeLoudness, loudnessScan,
}: Props) {
  // Feature (Transparent/neutral accent): draftColor now tracks the RAW
  // setting (manualAccentColor -- a hex, or the NEUTRAL_ACCENT sentinel),
  // not the resolved `accentColor`, so the "Transparent" preset's active
  // check and the value Done ultimately saves both reflect what the user
  // actually picked. `draftEffectiveColor` below is the real hex derived
  // from it, for anywhere this component needs an actual color to render.
  const [hexInput, setHexInput] = useState(resolveAccentColor(manualAccentColor, theme));
  // Feature (Confirm accent color on Done): color picks used to apply to
  // the whole app immediately on every tap/drag, with no way to back out
  // short of manually picking the old color again. Now every pick just
  // updates this local draft -- the picker and preview reflect it, but the
  // app-wide accent (and the saved preference) only actually changes when
  // Done is pressed. Closing any other way (X, tapping outside, Escape)
  // leaves the real accent color untouched.
  const [draftColor, setDraftColor] = useState(manualAccentColor);
  const draftEffectiveColor = resolveAccentColor(draftColor, theme);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Fix (EQ user-friendliness): sliders default collapsed behind presets so
  // the common case (tap a preset) doesn't force scrolling past 5 sliders;
  // auto-expands once someone actually has a hand-tuned ("Custom") curve so
  // it doesn't hide their own settings from them on return visits.
  const [eqExpanded, setEqExpanded] = useState(() => matchPreset(eq) === null);
  // Feature (Accent color tucked behind a button): the color presets, hex
  // input, and preview used to always take up the top of Settings. They're
  // now collapsed behind a single "Accent Color" button so Settings opens
  // shorter; tapping it reveals the same picker as before.
  const [colorExpanded, setColorExpanded] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setHexInput(resolveAccentColor(manualAccentColor, theme)); setDraftColor(manualAccentColor); }, [manualAccentColor, theme]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirmingDeleteAll) { setConfirmingDeleteAll(false); return; }
      onClose();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, confirmingDeleteAll]);

  const handleConfirmDeleteAll = async () => {
    setDeleting(true);
    try {
      await onDeleteAllSongs();
      setConfirmingDeleteAll(false);
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  // Feature (Library backup/restore)
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file next time
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await onImportBackupFile(file);
      const parts = [`${result.matchedSongs} song${result.matchedSongs === 1 ? '' : 's'} restored`];
      if (result.playlistsCreated > 0) parts.push(`${result.playlistsCreated} playlist${result.playlistsCreated === 1 ? '' : 's'} created`);
      if (result.unmatchedSongs > 0) parts.push(`${result.unmatchedSongs} not found in your library yet`);
      setImportResult(parts.join(' · '));
    } catch (err) {
      console.error('Backup import failed', err);
      setImportResult('That file could not be read as a Melophile backup.');
    } finally {
      setImporting(false);
    }
  };

  const applyHex = (val: string) => {
    const n = val.startsWith('#') ? val : `#${val}`;
    if (/^#[0-9a-fA-F]{6}$/.test(n)) setDraftColor(n);
  };

  // FIX (bottom of Settings hidden behind the Player Bar): the Player Bar
  // wrapper in App.tsx is deliberately `z-[60]` so it renders above the
  // Queue overlay's z-50 backdrop. That same rule was covering the bottom
  // of this modal too, since it also sat at z-50 -- the modal still
  // scrolled underneath, but the opaque bar blocked the last section from
  // view/reach. Bumping this above z-[60] fixes it without touching the
  // Queue's intentional layering.
  return (
    <div ref={overlayRef} className="fixed inset-0 z-[70] flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(var(--glass-blur-sm))' }}
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-2xl p-6 shadow-2xl animate-slide-up"
        style={{
          background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))',
          backdropFilter: 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))', border: '1px solid rgb(var(--fg-rgb) / var(--glass-border-alpha))', boxShadow: 'var(--shadow-panel)',
        }}>
        {/* FIX (close button disappears on scroll): this header used to be a
            plain child inside the same overflow-y-auto container as the rest
            of the settings content, so scrolling down carried the X button
            (and title) up and out of view along with everything else.
            Pinning it with `sticky top-0` keeps it fixed to the top of the
            modal's scroll area; the negative margins/matching padding bleed
            its background to the card's edges (canceling out the card's own
            p-6 padding just for this row) so scrolled content doesn't peek
            out from behind it. */}
        <div className="sticky -top-6 -mx-6 -mt-6 px-6 pt-6 pb-4 mb-1 z-10 flex items-center justify-between"
          style={{ background: 'rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))' }}>
          <h2 className="text-fg font-bold text-xl">Settings</h2>
          <button onClick={onClose} className="btn-icon w-8 h-8 hover:bg-fg/10 rounded-full">
            <X size={18} className="text-fg/60" />
          </button>
        </div>

        {/* Feature (Light/Dark theme toggle): a plain segmented control
            rather than a single on/off switch, since "on" wouldn't
            unambiguously mean either theme. Sits above auto-theme/accent
            color since it's the more fundamental "what does the app look
            like" choice; accent color still layers on top of whichever
            theme is active. Defaults to dark, matching the app's original
            (and only, pre-this-feature) appearance. */}
        <div className="flex items-center gap-2 py-2.5 px-3 rounded-xl border border-fg/10 mb-2.5">
          <span className="flex items-center gap-2 text-fg/70 text-sm font-medium mr-auto">
            {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
            Theme
          </span>
          <div className="flex items-center gap-1 rounded-lg p-0.5 bg-fg/5">
            <button
              onClick={() => onSetTheme('dark')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={theme === 'dark' ? { background: accentColor, color: getContrastText(accentColor) } : undefined}
            >
              <Moon size={13} className={theme === 'dark' ? '' : 'text-fg/50'} />
              <span className={theme === 'dark' ? '' : 'text-fg/50'}>Dark</span>
            </button>
            <button
              onClick={() => onSetTheme('light')}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={theme === 'light' ? { background: accentColor, color: getContrastText(accentColor) } : undefined}
            >
              <Sun size={13} className={theme === 'light' ? '' : 'text-fg/50'} />
              <span className={theme === 'light' ? '' : 'text-fg/50'}>Light</span>
            </button>
          </div>
        </div>

        {/* Feature (Liquid Glass theme toggle): frosted, blurred, top-lit
            surfaces (Settings itself, popovers, the player bar, dialogs)
            versus flat, solid, opaque ones -- a single on/off switch that
            drives the --glass-* CSS variables (see index.css). Sits right
            under the dark/light control since it's the other "what does
            the whole app look like" choice; defaults to on. */}
        <button
          onClick={() => onToggleLiquidGlass(!liquidGlass)}
          className="w-full flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl border border-fg/10 text-sm font-medium transition-colors hover:bg-fg/5 mb-2.5"
        >
          <span className="flex items-center gap-2 text-fg/70 text-left">
            <Droplets size={15} />
            <span>
              Liquid Glass
              <span className="block text-[11px] font-normal text-fg/35 mt-0.5">Frosted, translucent panels throughout the app</span>
            </span>
          </span>
          <span className="w-9 h-5 rounded-full relative transition-colors shrink-0" style={{ background: liquidGlass ? accentColor : 'rgb(var(--fg-rgb) / 0.15)' }}>
            <span className="absolute top-0.5 w-4 h-4 rounded-full bg-fg transition-all" style={{ left: liquidGlass ? 18 : 2 }} />
          </span>
        </button>

        {/* Feature (Dynamic theming): dominant-color-from-album-art
            auto-theming, sitting just above the manual color picker since
            turning this on makes the manual pick below a "fallback" (used
            whenever the current song has no usable art) rather than the
            active color. */}
        <button
          onClick={() => onToggleAutoTheme(!autoTheme)}
          className="w-full flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl border border-fg/10 text-sm font-medium transition-colors hover:bg-fg/5 mb-2.5"
        >
          <span className="flex items-center gap-2 text-fg/70 text-left">
            <ImagePlus size={15} />
            <span>
              Auto theme from album art
              <span className="block text-[11px] font-normal text-fg/35 mt-0.5">Accent color follows what's playing</span>
            </span>
          </span>
          <span className="w-9 h-5 rounded-full relative transition-colors shrink-0" style={{ background: autoTheme ? accentColor : 'rgb(var(--fg-rgb) / 0.15)' }}>
            <span className="absolute top-0.5 w-4 h-4 rounded-full bg-fg transition-all" style={{ left: autoTheme ? 18 : 2 }} />
          </span>
        </button>

        {/* Feature (Accent color tucked behind a button): all color-related
            controls (presets, premium presets, hex input, live preview)
            now live behind this single toggle instead of always taking up
            space at the top of Settings. */}
        <button
          onClick={() => setColorExpanded((v) => !v)}
          className="w-full flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl border border-fg/10 text-sm font-medium transition-colors hover:bg-fg/5 mb-4"
        >
          <span className="flex items-center gap-2 text-fg/70">
            <Palette size={15} />
            Accent Color
            <span className="w-4 h-4 rounded-full border border-fg/20 shrink-0" style={{ background: accentColor }} />
          </span>
          <ChevronDown size={15} className="text-fg/40" style={{ transform: colorExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>

        {colorExpanded && (
          <div className="mb-1">
            <h3 className="text-fg/60 text-xs font-semibold uppercase tracking-wider mb-3">Accent Color</h3>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {PRESETS.map((p) => {
                const active = draftColor.toLowerCase() === p.color.toLowerCase();
                const isNeutral = p.color === NEUTRAL_ACCENT;
                return (
                  <button key={p.color} onClick={() => { setDraftColor(p.color); setHexInput(resolveAccentColor(p.color, theme)); }}
                    className="relative h-10 rounded-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
                    style={isNeutral ? {
                      // Feature (Transparent/neutral accent): `background:
                      // 'neutral'` isn't a real CSS value, so this swatch
                      // gets an explicit checkerboard instead -- the
                      // standard "no fill" visual convention -- rather than
                      // silently falling back to whatever's behind it.
                      background: 'repeating-conic-gradient(rgb(var(--fg-rgb) / 0.16) 0% 25%, transparent 0% 50%) 0 0 / 10px 10px',
                      border: '1px solid rgb(var(--fg-rgb) / 0.15)',
                      boxShadow: active ? '0 0 0 2px white, 0 0 0 4px rgb(var(--fg-rgb) / 0.4)' : 'none',
                    } : { background: p.color, boxShadow: active ? `0 0 0 2px white, 0 0 0 4px ${p.color}` : 'none' }}
                    title={p.name}>
                    {active && <Check size={16} strokeWidth={3} style={{ color: isNeutral ? 'rgb(var(--fg-rgb) / 0.85)' : getContrastText(p.color) }} />}
                  </button>
                );
              })}
            </div>

            <h3 className="flex items-center gap-1.5 text-amber-300/70 text-xs font-semibold uppercase tracking-wider mb-3">
              <Sparkles size={12} /> Premium
            </h3>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {PREMIUM_PRESETS.map((p) => {
                const active = draftColor.toLowerCase() === p.color.toLowerCase();
                return (
                  <button key={p.color} onClick={() => { setDraftColor(p.color); setHexInput(p.color); }}
                    className="relative h-10 rounded-xl flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
                    style={{
                      background: `linear-gradient(135deg, ${p.color}, ${p.color}cc)`,
                      boxShadow: active
                        ? `0 0 0 2px white, 0 0 0 4px ${p.color}, 0 0 12px ${p.color}80`
                        : `0 0 8px ${p.color}40`,
                    }}
                    title={p.name}>
                    {active && <Check size={16} strokeWidth={3} style={{ color: getContrastText(p.color) }} />}
                  </button>
                );
              })}
            </div>

            <CustomColorPicker color={draftEffectiveColor} onChange={(hex) => { setDraftColor(hex); setHexInput(hex); }} />

            <div className="flex items-center gap-2 mt-3">
              <input type="text" value={hexInput} onChange={(e) => setHexInput(e.target.value)}
                onBlur={(e) => applyHex(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyHex(hexInput); }}
                placeholder="#2C5FCC"
                className="flex-1 bg-fg/5 border border-fg/10 rounded-xl px-3 py-2.5 text-fg text-sm font-mono focus:outline-none focus:border-fg/25 transition-colors" />
              <div className="w-10 h-10 rounded-xl border border-fg/20 shrink-0" style={{ background: draftEffectiveColor }} />
            </div>

            <div className="mt-4 p-3 rounded-xl bg-fg/5 border border-fg/5">
              <p className="text-fg/40 text-xs mb-2">Preview</p>
              <div className="flex items-center gap-3">
                <div className="w-2 h-6 rounded-full" style={{ background: draftEffectiveColor }} />
                <div className="flex-1 h-1.5 rounded-full bg-fg/10">
                  <div className="w-2/3 h-full rounded-full" style={{ background: draftEffectiveColor }} />
                </div>
                <Heart size={16} fill={draftEffectiveColor} style={{ color: draftEffectiveColor }} />
              </div>
            </div>
          </div>
        )}

        <button onClick={() => { if (draftColor !== manualAccentColor) onAccentChange(draftColor); onClose(); }}
          className="w-full mt-5 py-3 rounded-xl font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
          style={{ background: draftEffectiveColor, color: getContrastText(draftEffectiveColor), boxShadow: `0 6px 20px -6px ${draftEffectiveColor}80` }}>Done</button>

        {/* Feature (Row size): lets a person choose how tall/dense song
            rows are across Library, playlists, artist/album views, and
            search — Compact fits more on screen, Large is easier to read
            and tap. */}
        <div className="mt-5 pt-4 border-t border-fg/10">
          <h3 className="text-fg/60 text-xs font-semibold uppercase tracking-wider mb-3">Row Size</h3>
          <div className="grid grid-cols-5 gap-1.5">
            {(['tiny', 'compact', 'comfortable', 'large', 'extraLarge'] as const).map((opt) => {
              const active = rowSize === opt;
              const label = opt === 'tiny' ? 'Tiny' : opt === 'compact' ? 'Compact' : opt === 'comfortable' ? 'Default' : opt === 'large' ? 'Large' : 'X-Large';
              return (
                <button key={opt} onClick={() => onRowSizeChange(opt)}
                  className="py-2.5 px-1 rounded-xl border text-[11px] font-medium transition-colors"
                  style={{
                    borderColor: active ? accentColor : 'rgb(var(--fg-rgb) / 0.1)',
                    background: active ? `${accentColor}18` : 'transparent',
                    color: active ? accentColor : 'rgb(var(--fg-rgb) / 0.6)',
                  }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Feature (Minimized Now Playing bar): 'Normal' keeps the current
            expanded mobile bar; 'Minimized' shows a compact bar with just
            album art, song name, a play/pause button, and a plain progress
            line -- shuffle/skip/queue/lyrics/etc. are hidden. Only affects
            the mobile layout; the desktop bar is unchanged either way. */}
        <div className="mt-5 pt-4 border-t border-fg/10">
          <h3 className="text-fg/60 text-xs font-semibold uppercase tracking-wider mb-3">Now Playing Bar</h3>
          <div className="grid grid-cols-2 gap-2">
            {(['normal', 'minimized'] as const).map((opt) => {
              const active = playerBarStyle === opt;
              const label = opt === 'normal' ? 'Normal' : 'Minimized';
              return (
                <button key={opt} onClick={() => onPlayerBarStyleChange(opt)}
                  className="py-2.5 rounded-xl border text-sm font-medium transition-colors"
                  style={{
                    borderColor: active ? accentColor : 'rgb(var(--fg-rgb) / 0.1)',
                    background: active ? `${accentColor}18` : 'transparent',
                    color: active ? accentColor : 'rgb(var(--fg-rgb) / 0.6)',
                  }}>
                  {label}
                </button>
              );
            })}
          </div>
          <p className="text-fg/35 text-xs mt-2">Minimized shows just the album art, song name, and a play/pause button on mobile. Desktop is unaffected.</p>
        </div>

        {/* Feature (Gapless/Crossfade + Basic EQ) */}
        <div className="mt-5 pt-4 border-t border-fg/10">
          <h3 className="text-fg/60 text-xs font-semibold uppercase tracking-wider mb-3">Playback</h3>

          <div className="flex items-center justify-between mb-1.5">
            <label className="text-fg/70 text-sm">Crossfade</label>
            <span className="text-fg/40 text-xs tabular-nums">{crossfadeSeconds === 0 ? 'Off (gapless)' : `${crossfadeSeconds}s`}</span>
          </div>
          <Slider value={crossfadeSeconds} min={0} max={12} step={1}
            onChange={onCrossfadeChange}
            accentColor={accentColor} ariaLabel="Crossfade" className="w-full" />
          <p className="text-fg/30 text-xs mt-1.5 mb-4 leading-snug">
            Overlaps the end of one track with the start of the next. At 0, tracks still transition without the usual gap — the next song is simply preloaded ahead of time instead of overlapping.
          </p>

          <div className="flex items-center gap-1.5 mb-2 text-fg/70 text-sm">
            <SlidersHorizontal size={13} /> Equalizer
          </div>

          {/* Fix (EQ presets hidden behind invisible scrollbar): this used
              to be a single-row horizontal scroller with no scrollbar and no
              edge fade, so only ~4 of 10 presets were ever visible and
              nothing hinted more existed. Wrapping into a grid makes every
              preset visible up front with no hidden state. */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            {EQ_PRESETS.map((preset) => {
              const active = matchPreset(eq) === preset.name;
              return (
                <button
                  key={preset.name}
                  onClick={() => onEQPreset(preset.bands)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium border transition-colors whitespace-nowrap"
                  style={active
                    ? { background: accentColor, borderColor: accentColor, color: getContrastText(accentColor) }
                    : { background: 'transparent', borderColor: 'rgb(var(--fg-rgb) / 0.15)', color: 'rgb(var(--fg-rgb) / 0.6)' }}
                >
                  {preset.name}
                </button>
              );
            })}
          </div>

          {/* Fix (Reset duplicated Flat preset): a separate "Reset" button
              did exactly what the "Flat" preset pill already does, in two
              different places. Fine-tune toggle now doubles as the entry
              point to the sliders; Flat is the one and only way to zero
              them out. */}
          <button
            onClick={() => setEqExpanded((v) => !v)}
            className="flex items-center gap-1 text-fg/40 hover:text-fg/70 text-xs transition-colors mb-2"
          >
            <SlidersHorizontal size={11} className={eqExpanded ? '' : 'rotate-90'} style={{ transition: 'transform 0.15s' }} />
            {eqExpanded ? 'Hide fine-tune' : 'Fine-tune each band'}
          </button>

          {eqExpanded && (
            <div className="mb-1">
              <p className="text-fg/30 text-xs mb-2 leading-snug">
                Gain per band in decibels (dB) — higher boosts that range, lower cuts it.
              </p>
              {EQ_BANDS.map(({ key, label, freq }) => (
                <div key={key} className="flex items-center gap-3 mb-2">
                  <span className="text-fg/50 text-xs w-16 shrink-0 leading-tight">
                    {label}
                    <span className="block text-fg/35 text-[11px]">{freq >= 1000 ? `${freq / 1000}kHz` : `${freq}Hz`}</span>
                  </span>
                  <Slider value={eq[key]} min={EQ_MIN_DB} max={EQ_MAX_DB} step={1}
                    onChange={(v) => onEQChange(key, v)}
                    accentColor={accentColor} ariaLabel={label} className="flex-1" />
                  <span className="text-fg/40 text-xs w-9 text-right tabular-nums shrink-0">{eq[key] > 0 ? '+' : ''}{eq[key]}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Feature (Loudness normalization) */}
        <div className="mt-5 pt-4 border-t border-fg/10">
          <div className="flex items-center justify-between mb-1">
            <span className="text-fg/85 text-sm font-medium">Normalize volume</span>
            <button onClick={() => onToggleNormalizeVolume(!normalizeVolume)}
              className="relative w-9 h-5 rounded-full transition-colors shrink-0"
              style={{ background: normalizeVolume ? accentColor : 'rgb(var(--fg-rgb) / 0.15)' }}>
              <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform" style={{ transform: normalizeVolume ? 'translateX(16px)' : 'translateX(0px)' }} />
            </button>
          </div>
          <p className="text-fg/30 text-xs mb-3 leading-snug">
            Evens out volume differences between quietly and loudly mastered tracks. Needs each song analyzed once first.
          </p>
          <button
            onClick={onAnalyzeLoudness}
            disabled={!!loudnessScan?.running || songCount === 0}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-fg/10 text-fg/70 text-sm font-medium transition-colors hover:bg-fg/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <Gauge size={15} />
            {loudnessScan?.running
              ? `Analyzing… ${loudnessScan.current} / ${loudnessScan.total}`
              : 'Analyze library loudness'}
          </button>
        </div>

        <div className="mt-5 pt-4 border-t border-fg/10">
          <h3 className="text-fg/60 text-xs font-semibold uppercase tracking-wider mb-3">Library</h3>
          <button
            onClick={onRescanArt}
            disabled={!!artRescan?.running || songCount === 0}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-fg/10 text-fg/70 text-sm font-medium transition-colors hover:bg-fg/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <ImagePlus size={15} />
            {artRescan?.running
              ? `Scanning… ${artRescan.current} / ${artRescan.total}${artRescan.found > 0 ? ` (found ${artRescan.found})` : ''}`
              : 'Fix missing album art'}
          </button>
          <p className="text-fg/30 text-xs mt-2 leading-snug">
            Rescans your library for cover art that failed to load correctly.
            Songs without embedded art won't be affected.
          </p>

          {/* Feature (Manage Folders): every song remembers which folder it
              was imported from (importFolder, set at scan time) but that
              was never surfaced anywhere -- no way to see what folders make
              up the library, or remove one folder's worth of songs at once
              without hand-selecting them. */}
          <button
            onClick={onManageFolders}
            disabled={songCount === 0}
            className="w-full flex items-center justify-center gap-2 py-2.5 mt-3 rounded-xl border border-fg/10 text-fg/70 text-sm font-medium transition-colors hover:bg-fg/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <FolderOpen size={15} />
            Manage Folders
          </button>

          {/* Feature (Auto Rescan): lets a person pick their music folder
              once (via the File System Access API) instead of tapping the
              toolbar Rescan button every time — the app silently re-checks
              that folder for new files on every app open and whenever it
              regains focus. Only offered where the browser actually
              supports it; everyone else keeps using the toolbar button,
              which still works exactly as before. */}
          <div className="mt-4 pt-4 border-t border-fg/10">
            <div className="flex items-center justify-between mb-1">
              <span className="text-fg/70 text-sm font-medium">Auto rescan</span>
              {autoRescanEnabled && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${accentColor}25`, color: accentColor }}>ON</span>
              )}
            </div>
            <p className="text-fg/30 text-xs mb-3 leading-snug">
              {autoRescanSupported
                ? 'Automatically checks your music folder for new songs whenever you open the app — no need to tap Rescan yourself.'
                : "Not available in this browser — it needs a folder-access feature only Chrome and Edge currently support. Use the Rescan button in the toolbar instead."}
            </p>
            {autoRescanSupported && (
              autoRescanEnabled ? (
                <button
                  onClick={onDisableAutoRescan}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-fg/10 text-fg/70 text-sm font-medium transition-colors hover:bg-fg/5"
                >
                  <FolderOpen size={15} />
                  <span className="truncate">Watching "{autoRescanFolderName}" — tap to disable</span>
                </button>
              ) : (
                <button
                  onClick={onEnableAutoRescan}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{ background: accentColor, color: getContrastText(accentColor), boxShadow: `0 6px 20px -6px ${accentColor}80` }}
                >
                  <FolderOpen size={15} />
                  Enable Auto Rescan
                </button>
              )
            )}
          </div>
        </div>

        {/* Feature (OS notifications): lets background events (an
            auto-rescan finding new songs while the tab isn't focused) raise
            a real OS notification instead of only the in-app toast, which
            no one sees if they've switched away. Explicit opt-in -- this is
            what actually triggers the browser's permission prompt, never
            fired automatically on load. */}
        <div className="mt-5 pt-4 border-t border-fg/10">
          <button
            onClick={onToggleOSNotifications}
            className="w-full flex items-center justify-between gap-2"
          >
            <span className="text-left">
              <span className="text-fg/70 text-sm font-medium block">Background notifications</span>
              <span className="text-fg/30 text-xs block mt-0.5">
                {!notificationsSupported
                  ? "Not available in this browser."
                  : notifPermission === 'denied'
                  ? 'Blocked — enable notifications for Melophile in your device or browser settings.'
                  : 'Get an OS notification for new songs found, import problems, or lost folder access — only while the app is in the background.'}
              </span>
            </span>
            <span className="w-9 h-5 rounded-full relative transition-colors shrink-0" style={{ background: osNotifications ? accentColor : 'rgb(var(--fg-rgb) / 0.15)' }}>
              <span className="absolute top-0.5 w-4 h-4 rounded-full bg-fg transition-all" style={{ left: osNotifications ? 18 : 2 }} />
            </span>
          </button>
          {osNotifications && notifPermission === 'granted' && (
            <button onClick={onSendTestNotification}
              className="w-full py-2 mt-3 rounded-lg text-xs font-medium text-fg/40 hover:text-fg/70 hover:bg-fg/5 transition-colors">
              Send test notification
            </button>
          )}
        </div>

        {/* Feature (Library backup/restore) */}
        <div className="mt-5 pt-4 border-t border-fg/10">
          <h3 className="text-fg/60 text-xs font-semibold uppercase tracking-wider mb-3">Backup</h3>
          <div className="flex gap-2">
            <button onClick={onExportBackup} disabled={songCount === 0}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-fg/10 text-fg/70 text-sm font-medium transition-colors hover:bg-fg/5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent">
              <Download size={15} /> Export
            </button>
            <button onClick={() => importInputRef.current?.click()} disabled={importing}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border border-fg/10 text-fg/70 text-sm font-medium transition-colors hover:bg-fg/5 disabled:opacity-40">
              <Upload size={15} /> {importing ? 'Importing…' : 'Import'}
            </button>
            <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportFile} />
          </div>
          {importResult && <p className="text-fg/40 text-xs mt-2 leading-snug">{importResult}</p>}
          <p className="text-fg/30 text-xs mt-2 leading-snug">
            Saves your liked songs, pinned songs, playlists, and play counts to a file — not the audio itself. Import that file after re-adding your music (on this device or a new one) to restore all of it.
          </p>
        </div>

        {/* Danger Zone: bulk-delete the entire library. Kept visually
            separated (border + red accents) from the accent-color settings
            above so it doesn't get clicked by accident. */}
        <div className="mt-5 pt-4 border-t border-fg/10">
          <h3 className="text-red-400/80 text-xs font-semibold uppercase tracking-wider mb-3">Danger Zone</h3>
          <button
            onClick={() => setConfirmingDeleteAll(true)}
            disabled={songCount === 0}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-500/30 text-red-400 text-sm font-medium transition-colors hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
          >
            <Trash2 size={15} />
            Delete all songs{songCount > 0 ? ` (${songCount})` : ''}
          </button>
        </div>
      </div>

      {confirmingDeleteAll && (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center px-4"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(var(--glass-blur-sm))' }}
          onMouseDown={(e) => { if (e.currentTarget === e.target && !deleting) setConfirmingDeleteAll(false); }}>
          <div className="w-full max-w-sm rounded-2xl p-6 shadow-2xl animate-slide-up"
            style={{ background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))', border: '1px solid rgba(239,68,68,0.25)', boxShadow: 'var(--shadow-panel)' }}>
            <div className="flex items-center gap-2.5 mb-2">
              <AlertTriangle size={18} className="text-red-400 shrink-0" />
              <h3 className="text-fg font-bold text-lg">Delete all songs?</h3>
            </div>
            <p className="text-fg/50 text-sm mb-5 leading-snug">
              <span className="text-fg/80 font-medium">All {songCount} song{songCount === 1 ? '' : 's'}</span> in
              your library will be permanently removed, along with liked status and playlist entries. This can't be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingDeleteAll(false)} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-fg/5 hover:bg-fg/10 text-fg/70 text-sm transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleConfirmDeleteAll} disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-red-500/90 hover:bg-red-500 text-fg font-semibold text-sm transition-colors disabled:opacity-70">
                {deleting ? 'Deleting…' : 'Delete all'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
