import { useEffect, useState } from 'react';

// FIX (centered modals cut off by the on-screen keyboard): a `fixed
// inset-0` overlay is sized to the full *layout* viewport, which on
// Android Chrome/WebView does not shrink when the on-screen keyboard
// opens -- so a modal centered with `items-center` inside it stays
// centered in the full-height viewport, i.e. partly *behind* the
// keyboard, cutting off whatever sits near the bottom of the dialog
// (e.g. NewPlaylistModal's Cancel/Create row, AddSongsModal's song list
// and Add button). `window.visualViewport` reports the actual visible
// area once the keyboard has resized it, so every keyboard-opening modal
// should size its overlay to *this* instead of the window -- extracted
// here after the same fix was written inline twice (NewPlaylistModal,
// then AddSongsModal) so any future modal with a text input can just
// call this instead of re-deriving it.
export function useVisualViewportRect() {
  const [rect, setRect] = useState(() => ({
    height: window.visualViewport?.height ?? window.innerHeight,
    top: window.visualViewport?.offsetTop ?? 0,
  }));

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setRect({ height: vv.height, top: vv.offsetTop });
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return rect;
}
