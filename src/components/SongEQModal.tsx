import { useState } from 'react';
import { X } from 'lucide-react';
import type { Song } from '../types';
import { EQ_BANDS, EQ_PRESETS, EQ_MIN_DB, EQ_MAX_DB, clampEQ, matchPreset, type EQBandKey, type EQState } from '../lib/eqPresets';
import { Slider } from './Slider';
import { saveSong } from '../lib/db';

interface Props {
  song: Song;
  globalEQ: EQState;
  accentColor: string;
  onClose: () => void;
  onUpdated: (updated: Song) => void;
}

// Feature (Per-song EQ override): lets one specific song carry its own EQ
// curve that overrides the global setting only while that song is playing
// (see player.ts's _applySongEQ). Reached from the track's 3-dot menu.
// Deliberately its own small modal rather than folding into EditTagsModal
// -- editing tags is a form, tuning an EQ curve is a set of sliders, and
// mixing the two would make both worse.
export function SongEQModal({ song, globalEQ, accentColor, onClose, onUpdated }: Props) {
  const [enabled, setEnabled] = useState(!!song.customEQ);
  const [eq, setEQ] = useState<EQState>(song.customEQ ?? globalEQ);
  const [saving, setSaving] = useState(false);

  const activePreset = matchPreset(eq);

  const handleBandChange = (key: EQBandKey, value: number) => {
    setEQ((prev) => ({ ...prev, [key]: clampEQ(value) }));
  };

  const handleSave = async () => {
    setSaving(true);
    const updated: Song = { ...song, customEQ: enabled ? eq : undefined };
    await saveSong(updated);
    onUpdated(updated);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(var(--glass-blur-sm))' }}
      onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="w-full max-w-sm rounded-2xl p-5 shadow-2xl animate-slide-up max-h-[85vh] overflow-y-auto"
        style={{ background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))', border: '1px solid rgb(var(--fg-rgb) / var(--glass-border-alpha))', boxShadow: 'var(--shadow-panel)' }}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-fg font-bold">Song EQ</h3>
          <button onClick={onClose} className="btn-icon w-7 h-7 hover:bg-fg/10 rounded-full flex items-center justify-center">
            <X size={16} className="text-fg/50" />
          </button>
        </div>
        <p className="text-fg/40 text-xs mb-4 truncate">{song.title} — {song.artist}</p>

        {/* Enable toggle */}
        <button onClick={() => setEnabled((v) => !v)}
          className="w-full flex items-center justify-between rounded-xl px-3 py-2.5 mb-4 transition-colors"
          style={{ background: enabled ? `${accentColor}18` : 'rgb(var(--fg-rgb) / 0.05)', border: `1px solid ${enabled ? `${accentColor}40` : 'rgb(var(--fg-rgb) / 0.08)'}` }}>
          <span className="text-sm font-medium" style={{ color: enabled ? accentColor : 'rgb(var(--fg-rgb) / 0.7)' }}>
            Override EQ for this song
          </span>
          <span className="relative w-9 h-5 rounded-full transition-colors shrink-0" style={{ background: enabled ? accentColor : 'rgb(var(--fg-rgb) / 0.15)' }}>
            <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform" style={{ transform: enabled ? 'translateX(16px)' : 'translateX(0px)' }} />
          </span>
        </button>

        {!enabled ? (
          <p className="text-fg/30 text-xs pb-1">This song will use whatever the global EQ is set to.</p>
        ) : (
          <>
            {/* Presets, same set as Settings */}
            <div className="flex flex-wrap gap-1.5 mb-4">
              {EQ_PRESETS.map((p) => (
                <button key={p.name} onClick={() => setEQ({ ...p.bands })}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
                  style={activePreset === p.name
                    ? { background: accentColor, color: 'rgb(var(--surface-rgb))' }
                    : { background: 'rgb(var(--fg-rgb) / 0.06)', color: 'rgb(var(--fg-rgb) / 0.6)' }}>
                  {p.name}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {EQ_BANDS.map((band) => (
                <div key={band.key}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-fg/60 text-xs font-medium">{band.label}</span>
                    <span className="text-fg/40 text-[11px] tabular-nums">{eq[band.key] > 0 ? '+' : ''}{eq[band.key]} dB</span>
                  </div>
                  <Slider value={eq[band.key]} min={EQ_MIN_DB} max={EQ_MAX_DB} step={1} accentColor={accentColor}
                    onChange={(v) => handleBandChange(band.key, v)} ariaLabel={band.label} />
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-fg/5 hover:bg-fg/10 text-fg/70 text-sm transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 py-2.5 rounded-xl text-fg font-semibold text-sm transition-colors disabled:opacity-60"
            style={{ background: accentColor }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
