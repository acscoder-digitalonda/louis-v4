/**
 * Formatting helpers. Locale and currency come from speaker.config, never a literal.
 * Dates render in UTC: an event date is a calendar day, not a moment, and shifting it
 * by the viewer's timezone is how "Jul 17" becomes "Jul 16" for someone in Sydney.
 */

import { speaker } from '~/speaker.config'

const DAY = 86_400_000

export function money(value: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat(speaker.locale, {
    style: 'currency',
    currency: speaker.currency,
    maximumFractionDigits: 0,
    notation: opts.compact ? 'compact' : 'standard',
  }).format(value)
}

export function shortDate(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(speaker.locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function dayMonth(value: string | null | undefined): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(speaker.locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Whole days from today to a date. Negative = in the past. */
export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null
  const target = new Date(value)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  const a = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate())
  const b = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Math.round((a - b) / DAY)
}

/** "T-12", "T-0", "T+9" — the countdown language used across the deal screens. */
export function tMinus(value: string | null | undefined): string {
  const days = daysUntil(value)
  if (days === null) return '—'
  if (days === 0) return 'T-0'
  return days > 0 ? `T-${days}` : `T+${Math.abs(days)}`
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return '—'
  const then = new Date(value).getTime()
  if (Number.isNaN(then)) return '—'
  const diff = Date.now() - then
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return shortDate(value)
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
}

export function titleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(' ')
}
