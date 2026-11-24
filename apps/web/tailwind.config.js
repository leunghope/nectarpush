/** @type {import('tailwindcss').Config} */
// Tailwind theme is mapped 1:1 to the CSS custom properties generated from
// docs/design/tokens.json (see src/styles/globals.css). No raw hex values
// live here — every token resolves to a var(--token) reference so the whole
// palette switches with data-theme and stays 100% token-driven.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // The design system (src/styles/app.css + pages.css) ships its own reset and
  // token-driven base typography, so Tailwind's preflight is disabled to avoid
  // a double reset that would shift the hairline layout.
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        surface: 'var(--surface)',
        raised: 'var(--raised)',
        muted: 'var(--muted)',
        hover: 'var(--hover)',
        ink: {
          DEFAULT: 'var(--ink)',
          2: 'var(--ink-2)',
          3: 'var(--ink-3)',
          4: 'var(--ink-4)',
        },
        line: { DEFAULT: 'var(--line)', strong: 'var(--line-strong)' },
        accent: {
          DEFAULT: 'var(--accent)',
          strong: 'var(--accent-strong)',
          ink: 'var(--accent-ink)',
          soft: 'var(--accent-soft)',
          wash: 'var(--accent-wash)',
        },
        action: { bg: 'var(--action-bg)', fg: 'var(--action-fg)', hover: 'var(--action-hover)' },
        danger: { DEFAULT: 'var(--danger)', soft: 'var(--danger-soft)' },
        success: 'var(--success)',
        warning: 'var(--warning)',
        info: 'var(--info)',
        sse: 'var(--sse)',
      },
      fontFamily: {
        sans: 'var(--font-sans)',
        serif: 'var(--font-serif)',
        mono: 'var(--font-mono)',
      },
      fontSize: {
        '2xs': 'var(--fs-2xs)',
        xs: 'var(--fs-xs)',
        sm: 'var(--fs-sm)',
        base: 'var(--fs-base)',
        md: 'var(--fs-md)',
        lg: 'var(--fs-lg)',
        xl: 'var(--fs-xl)',
        '2xl': 'var(--fs-2xl)',
        display: 'var(--fs-display)',
      },
      spacing: {
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        5: 'var(--space-5)',
        6: 'var(--space-6)',
        7: 'var(--space-7)',
        8: 'var(--space-8)',
        10: 'var(--space-10)',
        12: 'var(--space-12)',
        16: 'var(--space-16)',
      },
      borderRadius: {
        xs: 'var(--radius-xs)',
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        full: 'var(--radius-full)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
      },
      borderColor: { DEFAULT: 'var(--line)' },
      screens: {
        sm: '480px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
      },
      maxWidth: { content: 'var(--content-max)' },
    },
  },
  plugins: [],
};
