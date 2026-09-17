import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, Check, Music as MusicIcon } from 'lucide-react';
import type { Playlist, Song } from '../types';
import { getContrastText } from '../lib/color';
import { useVisualViewportRect } from '../hooks/useVisualViewportRect';

interface Props {
  playlist: Playlist;
  songs: Song[];
  accentColor: string;
  onClose: () => void;
  // Confirms the whole selection at once (a single playlist save in the
  // caller) rather than one save per toggled checkbox.
  onConfirm: (songIds: string[]) => void;
}

// Song picker for the playlist detail screen's "Add Songs" button. Pulls
// from the same in-memory `songs` list App.tsx already loads from the
// local library (IndexedDB via lib/db.ts) -- no extra fetch/store needed,
// and nothing here ever touches the network, matching the app's existing
// fully-offline design.
export function AddSongsModal({ playlist, songs, accentColor, onClose, onConfirm }: Props) {
  const [query, setQuery] = useState('');
  // Edge case (duplicate songs): a song already in the playlist is simply
  // left out of the pickable list below, so it's structurally impossible to
  // re-add it and end up with a duplicate id in `songIds`.
  const alreadyInPlaylist = useMemo(() => new Set(playlist.songIds), [playlist.songIds]);
  const pickable = useMemo(() => songs.filter((s) => !alreadyInPlaylist.has(s.id)), [songs, alreadyInPlaylist]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return pickable;
    return pickable.filter((s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q));
  }, [pickable, query]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleConfirm = () => {
    if (selected.size === 0) { onClose(); return; }
    onConfirm(Array.from(selected));
    onClose();
  };

  const viewportRect = useVisualViewportRect();

  return (
    <div className="fixed left-0 right-0 z-50 flex items-center justify-center"
      style={{ top: viewportRect.top, height: viewportRect.height, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(var(--glass-blur-sm))' }}
      onMouseDown={(e) => { if (e.currentTarget === e.target) onClose(); }}>
      <div className="w-full max-w-md h-[32rem] max-h-[85%] rounded-2xl p-5 shadow-2xl animate-slide-up flex flex-col"
        style={{ background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))', border: '1px solid rgb(var(--fg-rgb) / var(--glass-border-alpha))', boxShadow: 'var(--shadow-panel)' }}>
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h3 className="text-fg font-bold text-lg">Add Songs</h3>
          <button onClick={onClose} className="btn-icon w-7 h-7 hover:bg-fg/10 rounded-full">
            <X size={16} className="text-fg/50" />
          </button>
        </div>
        <p className="text-fg/40 text-xs mb-3 truncate shrink-0">to "{playlist.name}"</p>

        <div className="relative shrink-0 mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg/30" />
          <input ref={inputRef} type="text" placeholder="Search your library" value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full bg-fg/5 border border-fg/10 rounded-xl pl-9 pr-3 py-2.5 text-fg text-sm placeholder-fg/30 focus:outline-none focus:border-fg/25" />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
          {pickable.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-fg/25 gap-2">
              <MusicIcon size={32} className="text-fg/15" />
              <p className="text-sm font-medium">Every song is already in this playlist</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-full flex items-center justify-center text-fg/25 text-sm">No matches</div>
          ) : (
            <div className="space-y-1">
              {filtered.map((s) => {
                const isSelected = selected.has(s.id);
                return (
                  <button key={s.id} onClick={() => toggle(s.id)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-fg/5 transition-colors text-left">
                    <span className="w-5 h-5 rounded-md border flex items-center justify-center shrink-0 transition-colors"
                      style={{
                        borderColor: isSelected ? accentColor : 'rgb(var(--fg-rgb) / 0.25)',
                        background: isSelected ? accentColor : 'transparent',
                      }}>
                      {isSelected && <Check size={13} style={{ color: getContrastText(accentColor) }} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-fg text-sm truncate">{s.title}</span>
                      <span className="block text-fg/40 text-xs truncate">{s.artist}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex gap-2 mt-3 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-fg/5 hover:bg-fg/10 text-fg/70 text-sm transition-colors">Cancel</button>
          <button onClick={handleConfirm} disabled={selected.size === 0}
            className="flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-40"
            style={{ background: accentColor, color: getContrastText(accentColor), boxShadow: `0 6px 20px -6px ${accentColor}80` }}>
            {selected.size > 0 ? `Add ${selected.size} Song${selected.size !== 1 ? 's' : ''}` : 'Add Songs'}
          </button>
        </div>
      </div>
    </div>
  );
}
