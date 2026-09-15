import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ArrowDown, ArrowUp } from 'lucide-react';
import type { Song, HistoryEntry } from '../types';
import { splitArtists } from '../lib/artistParser';
import { placeholderBackground } from '../lib/artPlaceholder';
import { useScrollRevealHeader } from '../hooks/useScrollRevealHeader';

interface Props {
  songs: Song[];
  history: HistoryEntry[];
  accentColor: string;
  onClose: () => void;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// How many rows to show in the ranked list, and how many of those count as
// "top 5" for the streak/rank-change badges below (mirrors the Spotify
// Wrapped-style "Top artists" screen this was modeled on).
const LIST_SIZE = 20;
const TOP_N = 5;

/** First letter of an artist's name, for the placeholder avatar -- the
 *  library only has embedded album art, never artist photos, so every
 *  avatar here is the same accent-tinted initial used elsewhere in the app
 *  (StatArt / SongRow), just keyed off the artist name instead of a song. */
function artistInitial(name: string): string {
  const ch = name.trim().charAt(0);
  return ch ? ch.toUpperCase() : '?';
}

interface RankedArtist { name: string; count: number; rank: number }

/** Ranks every artist played during the given calendar month by how many
 *  history entries (i.e. individual plays) they were credited on. A song
 *  with a split credit ("A/B") counts toward each artist individually --
 *  same convention as the all-time Top Artist stat on the main Stats
 *  screen. Note this reads from the same `history` list the "Recently
 *  Played" panel shows and "Clear" empties, so clearing history also
 *  clears the data this screen depends on for past months. */
function rankMonth(history: HistoryEntry[], songMap: Map<string, Song>, year: number, month: number): RankedArtist[] {
  const counts = new Map<string, number>();
  for (const entry of history) {
    const d = new Date(entry.playedAt);
    if (d.getFullYear() !== year || d.getMonth() !== month) continue;
    const song = songMap.get(entry.songId);
    if (!song) continue;
    for (const name of splitArtists(song.artist)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count], i) => ({ name, count, rank: i + 1 }));
}

export function TopArtistsDetail({ songs, history, accentColor, onClose }: Props) {
  const { sentinelRef, scrolled } = useScrollRevealHeader();
  const now = new Date();
  const [monthOffset, setMonthOffset] = useState(0);

  const songMap = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);

  // Every calendar month that has at least one history entry, earliest
  // first -- same "walk from the earliest recorded activity to now" logic
  // as TimeListenedDetail's monthHistory, needed both for the back/forward
  // paging bounds and for computing each top-5 artist's streak below.
  const monthKeys = useMemo(() => {
    if (history.length === 0) return [{ year: now.getFullYear(), month: now.getMonth() }];
    let earliest = new Date(history[0].playedAt);
    for (const h of history) { const d = new Date(h.playedAt); if (d < earliest) earliest = d; }
    const list: { year: number; month: number }[] = [];
    let y = earliest.getFullYear(); let m = earliest.getMonth();
    const endY = now.getFullYear(); const endM = now.getMonth();
    while (y < endY || (y === endY && m <= endM)) {
      list.push({ year: y, month: m });
      m += 1; if (m > 11) { m = 0; y += 1; }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  const target = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const year = target.getFullYear();
  const month = target.getMonth();
  const isCurrentMonth = monthOffset === 0;

  const ranked = useMemo(() => rankMonth(history, songMap, year, month), [history, songMap, year, month]);
  const prevTarget = new Date(year, month - 1, 1);
  const prevRanked = useMemo(
    () => rankMonth(history, songMap, prevTarget.getFullYear(), prevTarget.getMonth()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [history, songMap, year, month],
  );
  const prevRankByName = useMemo(() => new Map(prevRanked.map((a) => [a.name, a.rank])), [prevRanked]);

  // Consecutive-month top-5 streak for whoever's in this month's top 5:
  // walk backward through monthKeys starting at the current month, counting
  // how many months in a row (including this one) each name held a top-5
  // spot. Stops at the first month it drops out of the top 5, or the start
  // of recorded history.
  const streaks = useMemo(() => {
    const idx = monthKeys.findIndex((k) => k.year === year && k.month === month);
    if (idx === -1) return new Map<string, number>();
    const result = new Map<string, number>();
    for (const artist of ranked.slice(0, TOP_N)) {
      let streak = 0;
      for (let i = idx; i >= 0; i--) {
        const { year: y, month: m } = monthKeys[i];
        const top5 = rankMonth(history, songMap, y, m).slice(0, TOP_N).map((a) => a.name);
        if (top5.includes(artist.name)) streak += 1;
        else break;
      }
      result.set(artist.name, streak);
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthKeys, ranked, history, songMap, year, month]);

  const canGoBack = monthKeys.some((k) => new Date(k.year, k.month, 1).getTime() < target.getTime());
  const canGoForward = monthOffset < 0;

  const list = ranked.slice(0, LIST_SIZE);
  const distinctArtists = ranked.length;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col animate-fade-in" style={{ background: 'rgb(var(--bg-rgb))' }}>
      {/* Header. Feature (Apple-style scroll-reveal header): see
          useScrollRevealHeader for why this fades in a frosted background
          on scroll without the jank the earlier collapsing header had. */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-3 px-4 pt-4 pb-3 transition-[background-color,backdrop-filter,border-color] duration-300"
        style={{
          background: scrolled ? 'linear-gradient(180deg, rgb(var(--fg-rgb) / calc(0.1 * var(--glass-sheen))), rgb(var(--fg-rgb) / 0) 60%), rgb(var(--bg-rgb) / var(--glass-elevated-alpha))' : 'transparent',
          backdropFilter: scrolled ? 'blur(var(--glass-blur-md)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))' : 'none',
          WebkitBackdropFilter: scrolled ? 'blur(var(--glass-blur-md)) saturate(var(--glass-saturate)) brightness(var(--glass-brightness, 1)) contrast(var(--glass-contrast, 1))' : 'none',
          borderBottom: `1px solid rgb(var(--fg-rgb) / ${scrolled ? 'var(--glass-border-alpha)' : '0'})`,
        }}>
        <button onClick={onClose} className="btn-icon w-9 h-9 hover:bg-fg/10 rounded-full -ml-1.5">
          <ChevronLeft size={22} className="text-fg" />
        </button>
        <h2 className="text-fg font-bold text-lg">Top Artists</h2>
      </div>

      <div className="absolute inset-0 overflow-y-auto px-5 pt-16 pb-[184px] md:pb-8">
        <div ref={sentinelRef} className="h-px" aria-hidden="true" />
        {/* Month selector */}
        <div className="flex items-center gap-2 mb-5">
          <button onClick={() => canGoBack && setMonthOffset((o) => o - 1)} disabled={!canGoBack}
            className="btn-icon w-7 h-7 rounded-full hover:bg-fg/10 text-fg/50 hover:text-fg disabled:opacity-25 disabled:hover:bg-transparent">
            <ChevronLeft size={16} />
          </button>
          <span className="text-fg/90 font-semibold text-sm min-w-[9rem] text-center">{MONTH_NAMES[month]} {year}</span>
          <button onClick={() => canGoForward && setMonthOffset((o) => o + 1)} disabled={!canGoForward}
            className="btn-icon w-7 h-7 rounded-full hover:bg-fg/10 text-fg/50 hover:text-fg disabled:opacity-25 disabled:hover:bg-transparent">
            <ChevronRight size={16} />
          </button>
        </div>

        {distinctArtists === 0 ? (
          <p className="text-fg/30 text-sm py-16 text-center">No listening recorded in {MONTH_NAMES[month]}.</p>
        ) : (
          <>
            {/* Headline */}
            <p className="text-3xl font-extrabold leading-tight text-fg mb-8">
              You listened to <span style={{ color: accentColor }}>{distinctArtists} artist{distinctArtists === 1 ? '' : 's'}</span>{' '}
              {isCurrentMonth ? 'this month.' : `in ${MONTH_NAMES[month]}.`}
            </p>

            {/* Ranked list */}
            <div className="space-y-5">
              {list.map((artist) => {
                const prevRank = prevRankByName.get(artist.name);
                const rankDelta = prevRank !== undefined ? prevRank - artist.rank : null; // positive = moved up
                const streak = streaks.get(artist.name) ?? 0;
                const showStreak = artist.rank <= TOP_N && streak >= 2;
                return (
                  <div key={artist.name} className="flex items-center gap-4">
                    <div className="w-5 text-center shrink-0">
                      <span className="text-lg font-bold" style={{ color: accentColor }}>{artist.rank}</span>
                      {rankDelta !== null && rankDelta < 0 && (
                        <ArrowDown size={11} className="mx-auto -mt-0.5 text-red-400" />
                      )}
                      {rankDelta !== null && rankDelta > 0 && (
                        <ArrowUp size={11} className="mx-auto -mt-0.5" style={{ color: accentColor }} />
                      )}
                    </div>
                    <div className="w-14 h-14 rounded-full shrink-0 flex items-center justify-center ring-1 ring-fg/10 shadow-lift"
                      style={{ background: placeholderBackground(accentColor) }}>
                      <span className="text-lg font-semibold" style={{ color: accentColor }}>{artistInitial(artist.name)}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-fg font-semibold truncate">{artist.name}</p>
                      {showStreak ? (
                        <p className="text-xs text-fg/40 mt-0.5">
                          <span className="text-fg/70 font-medium">{streak} month{streak === 1 ? '' : 's'}</span> in top {TOP_N}
                        </p>
                      ) : (
                        <p className="text-xs text-fg/40 mt-0.5">{artist.count} play{artist.count === 1 ? '' : 's'}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
