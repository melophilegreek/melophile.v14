import type { Song } from '../types';
import { getAllSongs, getFile, updateSongsBatch } from './db';

// Feature (Loudness normalization): a simplified, RMS-based stand-in for
// ReplayGain/EBU R128 -- true loudness normalization (LUFS, K-weighting,
// gating of silent passages) needs a lot more DSP than is worth building
// here. This instead decodes each track, measures its overall RMS level,
// and computes the gain needed to bring it to a fixed reference level. It's
// not spec-accurate, but it solves the actual problem: an old, quietly-
// mastered Ilaiyaraaja recording and a modern, loudly-mastered track no
// longer jump in volume against each other.

/** Reference RMS level (dBFS) every track is normalized toward. -18 dBFS
 *  sits comfortably below 0 dBFS/clipping while still being a "full
 *  volume" reference -- not a broadcast-loudness spec, just a sensible
 *  target for a personal library. */
const TARGET_DB = -18;

/** How far a single track's gain is allowed to move in either direction.
 *  Without a cap, a near-silent intro-heavy track (a lot of film-score
 *  openings run long, quiet string passages) could compute a huge gain
 *  and amplify hiss/noise floor along with the music. */
const MAX_CORRECTION_DB = 12;

/** Every Nth sample is read instead of all of them, capping the analysis
 *  work per track regardless of file length/sample rate -- RMS over a
 *  representative subset converges to essentially the same value as the
 *  full signal for anything longer than a few seconds. */
const SAMPLE_STRIDE = 8;

export interface LoudnessProgress { current: number; total: number; analyzed: number }

function linearToDb(x: number): number {
  return x > 0 ? 20 * Math.log10(x) : -Infinity;
}

/** Decodes one file and returns its measured gain correction in dB, or
 *  `null` if the file couldn't be decoded (corrupt/unsupported -- treated
 *  as "leave it at 0 dB", not as an import failure). */
async function measureGainDb(file: File, ctx: AudioContext): Promise<number | null> {
  let buffer: AudioBuffer;
  try {
    const arrayBuffer = await file.arrayBuffer();
    // decodeAudioData detaches/consumes the buffer, so no reuse needed here.
    buffer = await ctx.decodeAudioData(arrayBuffer);
  } catch {
    return null;
  }
  let sumSquares = 0;
  let count = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i += SAMPLE_STRIDE) {
      const s = data[i];
      sumSquares += s * s;
      count++;
    }
  }
  if (count === 0) return null;
  const rms = Math.sqrt(sumSquares / count);
  const measuredDb = linearToDb(rms);
  if (!isFinite(measuredDb)) return null; // dead silence throughout -- leave uncorrected
  const gain = TARGET_DB - measuredDb;
  return Math.max(-MAX_CORRECTION_DB, Math.min(MAX_CORRECTION_DB, gain));
}

/** Analyzes every song that doesn't already have a `gainDb` -- re-running
 *  this is cheap since already-analyzed songs are skipped, so it's safe to
 *  offer as a "resume" action if it was interrupted partway through a large
 *  library. Writes results in small batches rather than one at a time to
 *  keep IndexedDB traffic reasonable over a large library. */
export async function analyzeLoudness(
  onProgress: (p: LoudnessProgress) => void,
): Promise<{ scanned: number; analyzed: number }> {
  const all = await getAllSongs();
  const songs = all.filter((s) => s.gainDb === undefined);
  const total = songs.length;
  let analyzed = 0;
  onProgress({ current: 0, total, analyzed });
  if (total === 0) return { scanned: 0, analyzed: 0 };

  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  let pending: { id: string; patch: Partial<Song> }[] = [];

  const flush = async () => {
    if (pending.length === 0) return;
    await updateSongsBatch(pending);
    pending = [];
  };

  for (let i = 0; i < total; i++) {
    const song = songs[i];
    try {
      const blob = await getFile(song.fileKey);
      if (blob) {
        const file = blob instanceof File ? blob : new File([blob], song.fileName);
        const gainDb = await measureGainDb(file, ctx);
        pending.push({ id: song.id, patch: { gainDb: gainDb ?? 0 } });
        if (gainDb !== null) analyzed++;
      } else {
        pending.push({ id: song.id, patch: { gainDb: 0 } });
      }
    } catch (e) {
      console.warn('Loudness analysis: failed for', song.fileName, e);
      pending.push({ id: song.id, patch: { gainDb: 0 } });
    }
    if (pending.length >= 25) await flush();
    onProgress({ current: i + 1, total, analyzed });
  }
  await flush();
  await ctx.close();
  return { scanned: total, analyzed };
}
