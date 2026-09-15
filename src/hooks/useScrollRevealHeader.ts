import { useCallback, useEffect, useState } from 'react';

/**
 * Feature (Apple-style scroll-reveal header): powers the "header stays
 * transparent, then fades in a frosted glass background once real content
 * scrolls underneath it" pattern used on the full-screen detail screens
 * (TimeListenedDetail, TopArtistsDetail, YearInMusicDetail).
 *
 * PERF NOTE -- this is deliberately NOT built by listening to `scroll` and
 * updating state on every event, the way the earlier collapsing-header
 * feature was (see PlayerBar/App.tsx history: that one was removed after
 * repeated animation jank reports, because it recomputed height/position
 * on every single scroll frame). Instead, a 1px sentinel sits at the very
 * top of the real (post-header) content, and an IntersectionObserver only
 * fires when that sentinel actually crosses in or out of view -- once per
 * scroll session boundary, not continuously. The header element itself
 * never changes size or position (no layout/reflow cost); only its
 * background/backdrop-filter cross-fades via a plain CSS transition in
 * response to this rare boolean flip, which the browser can composite
 * cheaply.
 *
 * `sentinelRef` is a callback ref (not a plain useRef) on purpose: some
 * screens conditionally render one of two alternate scrollable views
 * (e.g. TimeListenedDetail's month view vs. its History list), each with
 * its own sentinel node. A callback ref re-fires whenever the underlying
 * DOM node is swapped, which re-attaches the observer to the new node;
 * a static useRef + empty-deps effect would silently keep watching the
 * old, now-unmounted node.
 */
export function useScrollRevealHeader() {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [scrolled, setScrolled] = useState(false);

  const sentinelRef = useCallback((el: HTMLElement | null) => {
    setNode(el);
  }, []);

  useEffect(() => {
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return { sentinelRef, scrolled };
}
