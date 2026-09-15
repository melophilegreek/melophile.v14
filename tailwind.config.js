/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Feature (Premium UI pass): cooler, deeper matte tones than the
        // original Spotify-clone base (#121212/#181818/#282828) -- reads
        // less like a generic streaming-app template, more like a piece of
        // hardware. accent/ink stay as-is since accent is user-controlled
        // via CSS var and ink is already neutral.
        base: { bg: '#0A0A0C', surface: '#141417', elevated: '#1C1C21', hover: '#28282f' },
        spotify: { green: '#1DB954', greenHover: '#1ed760' },
        ink: { primary: '#FFFFFF', secondary: '#B3B3B3', muted: '#6A6A6A' },
        // Feature (Light/Dark theme toggle): these read from CSS variables
        // set in index.css under `[data-theme="dark"]` / `[data-theme="light"]`,
        // so `text-fg/70`, `bg-surface`, etc. resolve to the right color for
        // whichever theme is active on <html>. The `<alpha-value>` placeholder
        // is what lets Tailwind's normal `/NN` opacity syntax (e.g. `text-fg/70`)
        // work with a CSS-variable-backed color -- Tailwind substitutes the
        // opacity into that slot before writing out `rgb(var(--fg-rgb) / 0.7)`.
        // `fg` replaces the old hardcoded `white` usage throughout the app
        // (dark theme: near-white; light theme: near-black) so every bit of
        // text/border/hover-tint automatically flips with the theme instead
        // of needing a `dark:`/`light:` variant on every single class.
        fg: 'rgb(var(--fg-rgb) / <alpha-value>)',
        bg: 'rgb(var(--bg-rgb) / <alpha-value>)',
        surface: 'rgb(var(--surface-rgb) / <alpha-value>)',
        elevated: 'rgb(var(--elevated-rgb) / <alpha-value>)',
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
      boxShadow: {
        // Signature element (Premium UI pass): a soft, accent-tinted glow
        // used behind album art / the play button -- the one recurring
        // "glass-and-light" motif that ties the panels together, standing
        // in for the ambient glow of a hi-fi component's front panel.
        // FEATURE (Premium light mode pass): these now read from the
        // `--shadow-panel`/`--shadow-lift` CSS vars (index.css), which
        // carry a different recipe per theme instead of one dark-only
        // hardcoded shadow -- see the comment there for why.
        'panel': 'var(--shadow-panel)',
        'lift': 'var(--shadow-lift)',
      },
      animation: {
        'fade-in': 'fadeIn 0.25s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16,1,0.3,1)',
        'slide-in-right': 'slideInRight 0.3s cubic-bezier(0.16,1,0.3,1)',
        'pulse-bar': 'pulseBar 0.75s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { opacity: '0', transform: 'translateY(12px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        slideInRight: { from: { opacity: '0', transform: 'translateX(100%)' }, to: { opacity: '1', transform: 'translateX(0)' } },
        pulseBar: { '0%,100%': { transform: 'scaleY(0.35)' }, '50%': { transform: 'scaleY(1)' } },
      },
    },
  },
  plugins: [
    // FIX (song row / 3-dot menu stuck "highlighted" after tap+scroll):
    // Tailwind's default `hover:` and `group-hover:` compile to plain
    // `:hover`, which touchscreens set on tap and never clear (there's no
    // mouse to move away and fire the un-hover). That left the row darkened,
    // the index swapped for the play icon, and the 3-dot button's circular
    // background all stuck on whatever row was last tapped, even after
    // scrolling elsewhere. Redefining both variants to only match on
    // devices that report an actual hover-capable, fine pointer (a mouse)
    // means touch taps never trigger `:hover` in the first place, while
    // desktop mouse users keep the normal hover feedback. This is a single
    // global fix rather than patching every `hover:`/`group-hover:` class
    // site individually.
    function ({ addVariant }) {
      addVariant('hover', '@media (hover: hover) and (pointer: fine) { &:hover }');
      addVariant('group-hover', '@media (hover: hover) and (pointer: fine) { :merge(.group):hover & }');
    },
  ],
};
