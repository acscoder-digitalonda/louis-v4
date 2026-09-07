/**
 * WP1.3 — DATE CONFLICTS. Two deals want the same day.
 *
 * Decisions Log §3 sets the principle and it is the whole design: **the system detects
 * and flags; Ben decides; nothing changes state until a human marks it resolved.**
 * Sometimes two gigs in one day is genuinely doable — a morning keynote and an evening
 * dinner in the same city — so the system must never assume a conflict is a conflict.
 *
 * That rules out the obvious implementations. No auto-release. No "first hold wins" that
 * quietly drops the second. No countdown that expires into an action. The 24-hour
 * first-right-of-refusal clock is **display only**: it tells the first client they have a
 * day to decide, and when the day is up a person still has to do something.
 *
 * ── What counts as a conflict ──────────────────────────────────────────────
 *
 * Two live deals holding the same date. `Qualified` and `Firm Offer` hold dates; nothing
 * else does. Historical rows never conflict, and neither does a deal against itself.
 *
 * International events get a wider window, because a Tuesday in Singapore and a Wednesday
 * in London are the same trip. That window is config, not a constant in the code.
 */

import type { Deal, DateConflict, RateRegion } from './types'
import { isHold } from './stages'

/** How many days either side of a held date count as the same trip, by band. */
export const CONFLICT_WINDOW_DAYS: Record<RateRegion | 'default', number> = {
  'us-canada': 0,
  'near-international': 1,
  'europe-samerica-japan': 2,
  'far-international': 2,
  default: 0,
}

export function windowFor(region: RateRegion | null): number {
  return CONFLICT_WINDOW_DAYS[region ?? 'default'] ?? 0
}

function daysBetween(a: string, b: string): number {
  const ms =
    new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime() -
    new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime()
  return Math.abs(Math.round(ms / 86_400_000))
}

/** The date a deal is holding, which is the hold date if there is one and the event date otherwise. */
export function heldDate(deal: Pick<Deal, 'holdDate' | 'eventDate'>): string | null {
  return (deal.holdDate ?? deal.eventDate)?.slice(0, 10) ?? null
}

export function holdsADate(deal: Pick<Deal, 'stage' | 'historical' | 'holdDate' | 'eventDate'>): boolean {
  if (deal.historical) return false
  if (!isHold(deal.stage)) return false
  return heldDate(deal) !== null
}

export interface DetectedConflict {
  date: string
  deals: Deal[]
  /** Ordered by hold order, then by creation — the first hold is the one with the right. */
  firstHold: Deal
  /** Whether any of them has reached Firm Offer, which is what starts the clock. */
  challenged: boolean
  label: string
}

/**
 * Finds every date two or more live deals are holding.
 *
 * Ordering matters and is not arbitrary: the first hold owns the right of first refusal,
 * so `holdOrder` decides, and where that is unset — most seeded deals — the earlier
 * `createdAt` does. Guessing wrong here would give the wrong client the deciding call.
 */
export function detectConflicts(deals: Deal[], today: string): DetectedConflict[] {
  const live = deals.filter(holdsADate).filter((d) => heldDate(d)! >= today)

  const groups: Deal[][] = []
  for (const deal of live) {
    const date = heldDate(deal)!
    const window = windowFor(deal.rateRegion)
    const group = groups.find((g) =>
      g.some((other) => {
        const otherDate = heldDate(other)!
        return daysBetween(date, otherDate) <= Math.max(window, windowFor(other.rateRegion))
      }),
    )
    if (group) group.push(deal)
    else groups.push([deal])
  }

  return groups
    .filter((g) => g.length > 1)
    .map((g) => {
      const ordered = [...g].sort(
        (a, b) =>
          (a.holdOrder ?? Number.MAX_SAFE_INTEGER) - (b.holdOrder ?? Number.MAX_SAFE_INTEGER) ||
          (a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
      )
      const date = heldDate(ordered[0]!)!
      return {
        date,
        deals: ordered,
        firstHold: ordered[0]!,
        challenged: ordered.some((d) => d.stage === 'firm-offer'),
        label: `${date} — ${ordered.map((d) => d.client?.name ?? d.name).join(' vs ')}`,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** A conflict record already covering this exact set of deals. */
export function existingFor(conflict: DetectedConflict, records: DateConflict[]): DateConflict | null {
  const ids = new Set(conflict.deals.map((d) => d.id))
  return (
    records.find(
      (r) =>
        r.status !== 'resolved' &&
        r.dealIds.length === ids.size &&
        r.dealIds.every((id) => ids.has(id)),
    ) ?? null
  )
}

export const CHALLENGE_HOURS = 24

/**
 * How long the first hold has left, for display.
 *
 * Display only, and the word is load-bearing. Nothing happens when this reaches zero:
 * the countdown exists so the first client can be told "you have a day", and so Ben can
 * see at a glance which conflict has been sitting. A timer that acted on expiry would be
 * exactly the auto-release Decisions Log §3 forbids.
 */
export function hoursRemaining(conflict: Pick<DateConflict, 'createdAt'>, now = new Date()): number {
  const started = new Date(conflict.createdAt).getTime()
  if (Number.isNaN(started)) return 0
  const elapsed = (now.getTime() - started) / 3_600_000
  return Math.max(0, Math.round((CHALLENGE_HOURS - elapsed) * 10) / 10)
}

export const RESOLUTIONS = [
  'First hold contracted',
  'First hold released',
  'Second hold released',
  'Both feasible',
] as const

export type Resolution = (typeof RESOLUTIONS)[number]

/**
 * What a resolution means for the record.
 *
 * "Both feasible" is its own status rather than "resolved", because it is a real and
 * common answer — two gigs in one day happen — and because it is what dismisses the
 * drafted challenge email without anyone having to remember to.
 */
export function statusFor(resolution: Resolution): DateConflict['status'] {
  return resolution === 'Both feasible' ? 'both-feasible' : 'resolved'
}
