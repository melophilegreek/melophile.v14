import { useEffect, useRef } from 'react';
import { X, Upload, Trash2 } from 'lucide-react';
import type { Song } from '../types';
import { updateSongArt } from '../lib/db';

interface Props {
  song: Song;
  accentColor: string;
  onClose: () => void;
  onUpdated: (updated: Song) => void;
}

export function AlbumArtEditModal({ song, accentColor, onClose, onUpdated }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const mime = file.type || 'image/jpeg';
    await updateSongArt(song.id, buf, mime);
    onUpdated({ ...song, albumArtData: buf, albumArtMime: mime });
    onClose();
  };

  const handleRemove = async () => {
    await updateSongArt(song.id, undefined, undefined);
    onUpdated({ ...song, albumArtData: undefined, albumArtMime: undefined });
    onClose();
  };

  return (
    <div ref={overlayRef} className="fixed inset-0 z-[70] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(var(--glass-blur-sm))' }}
      onMouseDown={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="w-72 rounded-2xl p-5 shadow-2xl animate-slide-up"
        style={{ background: 'radial-gradient(130% 70% at 10% -12%, rgb(var(--fg-rgb) / calc(0.13 * var(--glass-sheen))), transparent 55%), linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.16 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 30%), rgb(var(--surface-rgb) / var(--glass-surface-alpha))', backdropFilter: 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))', border: '1px solid rgb(var(--fg-rgb) / var(--glass-border-alpha))', boxShadow: 'var(--shadow-panel)' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-fg font-bold">Edit Album Art</h3>
          <button onClick={onClose} className="btn-icon w-7 h-7 hover:bg-fg/10 rounded-full">
            <X size={16} className="text-fg/50" />
          </button>
        </div>
        <p className="text-fg/40 text-xs mb-4 truncate">{song.title}</p>
        <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
        <div className="space-y-2">
          <button onClick={() => inputRef.current?.click()}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-fg/5 hover:bg-fg/10 text-fg transition-colors">
            <Upload size={16} style={{ color: accentColor }} /> <span className="text-sm font-medium">Upload new art</span>
          </button>
          {song.albumArtData && (
            <button onClick={handleRemove}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-fg/5 hover:bg-red-500/15 text-fg hover:text-red-400 transition-colors">
              <Trash2 size={16} /> <span className="text-sm font-medium">Remove art</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
