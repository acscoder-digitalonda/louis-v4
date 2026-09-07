/**
 * Theme tokens (Handoff §2).
 *
 * Every colour in the app is a CSS custom property. This module is the registry:
 * what is editable, what it defaults to, and what it means. Settings → Appearance
 * renders itself from `EDITABLE_TOKENS` — add a token here and the editor grows a row.
 *
 * Backgrounds are theme-owned and deliberately NOT user-editable: that is what stops
 * an arbitrary accent from breaking the design.
 */

import type { ThemeSettings } from './types'

export type ThemeName = 'light' | 'dark'

export interface TokenDef {
  /** Token name without the leading `--`. */
  name: string
  label: string
  group: TokenGroup
  light: string
  dark: string
  /** The background token this colour is normally drawn on — used by the contrast guard. */
  on?: 'bg' | 'bg-raised' | 'bg-sunken' | 'accent'
}

export type TokenGroup =
  | 'Text'
  | 'Accent'
  | 'Links'
  | 'Semantic'
  | 'Focus'
  | 'Borders'
  | 'Stage chips'
  | 'Status chips'
  | 'Data viz'
  | 'Notification'

/** Theme-owned. Present as tokens, absent from the editor. */
export const BACKGROUND_TOKENS: TokenDef[] = [
  { name: 'bg', label: 'Page', group: 'Text', light: '#F6F3E9', dark: '#131210' },
  { name: 'bg-raised', label: 'Raised card', group: 'Text', light: '#FDFBF3', dark: '#1C1A17' },
  { name: 'bg-sunken', label: 'Recessed well', group: 'Text', light: '#ECE7D6', dark: '#0C0B0A' },
  {
    name: 'bg-overlay',
    label: 'Overlay',
    group: 'Text',
    light: 'rgba(28,26,21,.45)',
    dark: 'rgba(0,0,0,.62)',
  },
]

export const EDITABLE_TOKENS: TokenDef[] = [
  // TEXT
  { name: 'text-primary', label: 'Primary text', group: 'Text', light: '#1C1A15', dark: '#F2EEE2', on: 'bg' },
  { name: 'text-secondary', label: 'Secondary text', group: 'Text', light: '#6E695B', dark: '#A8A294', on: 'bg' },
  { name: 'text-muted', label: 'Muted text', group: 'Text', light: '#8F8A7A', dark: '#7A7568', on: 'bg' },
  { name: 'text-inverse', label: 'Inverse text', group: 'Text', light: '#FFF6ED', dark: '#131210', on: 'accent' },

  // ACCENT — paper-ink's one accent: live / attention.
  { name: 'accent', label: 'Accent', group: 'Accent', light: '#E24B0F', dark: '#FF6A2B', on: 'bg' },
  { name: 'accent-hover', label: 'Accent hover', group: 'Accent', light: '#C13E0A', dark: '#FF8149', on: 'bg' },
  { name: 'accent-subtle', label: 'Accent tint', group: 'Accent', light: '#F7DFCE', dark: '#3A1F13' },

  // LINKS
  { name: 'link', label: 'Link', group: 'Links', light: '#B03A0B', dark: '#FF8149', on: 'bg' },
  { name: 'link-hover', label: 'Link hover', group: 'Links', light: '#7E2A08', dark: '#FFA277', on: 'bg' },

  // SEMANTIC
  { name: 'success', label: 'Success', group: 'Semantic', light: '#2F6F4A', dark: '#5FBF8A', on: 'bg' },
  { name: 'warning', label: 'Warning', group: 'Semantic', light: '#8A6410', dark: '#E0A63A', on: 'bg' },
  { name: 'danger', label: 'Danger', group: 'Semantic', light: '#A32A1C', dark: '#FF7A66', on: 'bg' },
  { name: 'info', label: 'Info', group: 'Semantic', light: '#2A5F80', dark: '#79B8DC', on: 'bg' },

  // FOCUS
  { name: 'focus-ring', label: 'Focus ring', group: 'Focus', light: '#E24B0F', dark: '#FF6A2B' },

  // BORDERS
  { name: 'border', label: 'Hairline', group: 'Borders', light: 'rgba(28,26,21,.12)', dark: 'rgba(242,238,226,.14)' },
  { name: 'border-strong', label: 'Strong border', group: 'Borders', light: 'rgba(28,26,21,.32)', dark: 'rgba(242,238,226,.34)' },
  { name: 'divider', label: 'Divider', group: 'Borders', light: 'rgba(28,26,21,.08)', dark: 'rgba(242,238,226,.09)' },

  // STAGE CHIPS
  { name: 'stage-inquiry', label: 'Inquiry', group: 'Stage chips', light: '#8F8A7A', dark: '#8F8A7A' },
  { name: 'stage-qualified', label: 'Qualified', group: 'Stage chips', light: '#B4791A', dark: '#E0A63A' },
  { name: 'stage-firmoffer', label: 'Firm Offer', group: 'Stage chips', light: '#9A5B12', dark: '#F0BC55' },
  { name: 'stage-closedwon', label: 'Closed-Won', group: 'Stage chips', light: '#E24B0F', dark: '#FF6A2B' },
  { name: 'stage-preevent', label: 'Pre-Event', group: 'Stage chips', light: '#2A5F80', dark: '#79B8DC' },
  { name: 'stage-delivered', label: 'Delivered', group: 'Stage chips', light: '#2F6F4A', dark: '#5FBF8A' },
  { name: 'stage-debriefed', label: 'Debriefed', group: 'Stage chips', light: '#4A4636', dark: '#B9B3A2' },
  { name: 'stage-closedlost', label: 'Closed Lost', group: 'Stage chips', light: '#A9A395', dark: '#5E5A50' },

  // STATUS CHIPS
  { name: 'chip-paid', label: 'Paid', group: 'Status chips', light: '#2F6F4A', dark: '#5FBF8A' },
  { name: 'chip-pending', label: 'Pending', group: 'Status chips', light: '#8A6410', dark: '#E0A63A' },
  { name: 'chip-overdue', label: 'Overdue', group: 'Status chips', light: '#A32A1C', dark: '#FF7A66' },
  { name: 'chip-contract-signed', label: 'Contract signed', group: 'Status chips', light: '#2F6F4A', dark: '#5FBF8A' },
  { name: 'chip-contract-out', label: 'Contract out', group: 'Status chips', light: '#8A6410', dark: '#E0A63A' },

  // DATA VIZ
  { name: 'chart-1', label: 'Chart 1', group: 'Data viz', light: '#E24B0F', dark: '#FF6A2B' },
  { name: 'chart-2', label: 'Chart 2', group: 'Data viz', light: '#2A5F80', dark: '#79B8DC' },
  { name: 'chart-3', label: 'Chart 3', group: 'Data viz', light: '#2F6F4A', dark: '#5FBF8A' },
  { name: 'chart-4', label: 'Chart 4', group: 'Data viz', light: '#8A6410', dark: '#E0A63A' },
  { name: 'chart-5', label: 'Chart 5', group: 'Data viz', light: '#6E695B', dark: '#A8A294' },
  { name: 'chart-6', label: 'Chart 6', group: 'Data viz', light: '#7E2A08', dark: '#FFA277' },

  // NOTIFICATION
  { name: 'badge', label: 'Bell dot', group: 'Notification', light: '#E24B0F', dark: '#FF6A2B' },
]

export const ALL_TOKENS: TokenDef[] = [...BACKGROUND_TOKENS, ...EDITABLE_TOKENS]

export const TOKEN_GROUPS: TokenGroup[] = [
  'Text',
  'Accent',
  'Links',
  'Semantic',
  'Focus',
  'Borders',
  'Stage chips',
  'Status chips',
  'Data viz',
  'Notification',
]

export const defaultThemeSettings: ThemeSettings = { light: {}, dark: {} }

/**
 * The shipped token defaults, emitted as CSS. `globals.css` contains no colour
 * literals at all — it only references these vars — so this module is the single
 * source of truth and the no-hardcoded-hex lint has exactly one allow-listed file.
 *
 * `[data-theme="dark"]` wins over the media query so an explicit choice always beats
 * the system preference, in both directions.
 */
export function baseThemeCss(): string {
  const decls = (theme: ThemeName) =>
    ALL_TOKENS.map((t) => `--${t.name}:${t[theme]};`).join('')
  return [
    `:root{${decls('light')}}`,
    `@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${decls('dark')}}}`,
    `[data-theme="dark"]{${decls('dark')}}`,
    `[data-theme="light"]{${decls('light')}}`,
  ].join('\n')
}

/**
 * Turns stored overrides into a CSS string injected at app load.
 * Only known token names are emitted — an unknown key in Airtable can never
 * inject arbitrary CSS.
 */
export function overridesToCss(settings: ThemeSettings): string {
  const known = new Set(EDITABLE_TOKENS.map((t) => t.name))
  const block = (theme: ThemeName, selector: string) => {
    const overrides = settings[theme] ?? {}
    const decls = Object.entries(overrides)
      .filter(([name, value]) => known.has(name) && isSafeColor(value))
      .map(([name, value]) => `--${name}:${value};`)
      .join('')
    return decls ? `${selector}{${decls}}` : ''
  }
  return [
    block('light', ':root,[data-theme="light"]'),
    block('dark', '[data-theme="dark"]'),
  ]
    .filter(Boolean)
    .join('\n')
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGBA = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\)$/i

/** Defence in depth: values come from Airtable, so they are never trusted. */
export function isSafeColor(value: string): boolean {
  const v = value.trim()
  return HEX.test(v) || RGBA.test(v)
}

// ---------------------------------------------------------------------------
// Contrast guard (Handoff §2.1) — warn below 4.5:1, never block.
// ---------------------------------------------------------------------------

export function parseColor(value: string): [number, number, number] | null {
  const v = value.trim()
  if (HEX.test(v)) {
    let hex = v.slice(1)
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('')
    const int = parseInt(hex.slice(0, 6), 16)
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
  }
  const m = v.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return null
}

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(rgb: [number, number, number]): number {
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
}

export function contrastRatio(a: string, b: string): number | null {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return null
  const la = relativeLuminance(ca)
  const lb = relativeLuminance(cb)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** Resolves the effective value of a token for a theme, honouring overrides. */
export function resolveToken(name: string, theme: ThemeName, settings: ThemeSettings): string {
  const override = settings[theme]?.[name]
  if (override && isSafeColor(override)) return override
  const def = ALL_TOKENS.find((t) => t.name === name)
  return def ? def[theme] : ''
}
