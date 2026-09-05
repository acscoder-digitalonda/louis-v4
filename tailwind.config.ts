import type { Config } from 'tailwindcss'

/**
 * Tailwind is bound to the token layer, never to literal colour.
 * Every colour utility resolves to a CSS custom property defined in `src/lib/theme.ts`,
 * so `bg-raised`, `text-secondary` etc. follow the active theme and any admin accent
 * override for free. There is deliberately no palette here to reach for.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    // Replacing (not extending) colors is the enforcement: raw Tailwind palette
    // utilities like `bg-red-500` simply do not exist in this build.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      bg: 'var(--bg)',
      raised: 'var(--bg-raised)',
      sunken: 'var(--bg-sunken)',
      overlay: 'var(--bg-overlay)',
      ink: 'var(--text-primary)',
      'ink-secondary': 'var(--text-secondary)',
      'ink-muted': 'var(--text-muted)',
      'ink-inverse': 'var(--text-inverse)',
      accent: 'var(--accent)',
      'accent-hover': 'var(--accent-hover)',
      'accent-subtle': 'var(--accent-subtle)',
      link: 'var(--link)',
      'link-hover': 'var(--link-hover)',
      success: 'var(--success)',
      warning: 'var(--warning)',
      danger: 'var(--danger)',
      info: 'var(--info)',
      hairline: 'var(--border)',
      'hairline-strong': 'var(--border-strong)',
      divider: 'var(--divider)',
      badge: 'var(--badge)',
    },
    borderColor: ({ theme }) => ({
      ...theme('colors'),
      DEFAULT: 'var(--border)',
    }),
    extend: {
      fontFamily: {
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        card: 'var(--r)',
        well: 'var(--r-well)',
        pill: '999px',
      },
      maxWidth: {
        shell: '1080px',
        column: '640px',
      },
      transitionDuration: {
        DEFAULT: '160ms',
      },
    },
  },
  plugins: [],
}

export default config
