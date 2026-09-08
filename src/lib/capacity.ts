/**
 * The capacity check.
 *
 * Ben's own rule is a maximum of three keynotes in a week, and Liezel checks the load a
 * day either side of any date she is asked about. This is that check.
 *
 * ── Why it advises and never refuses ───────────────────────────────────────
 *
 * The run plan is explicit: no limits, no capacity caps, no date guards. Every timer is
 * "at T-x, or immediately if T-x has passed", and last-minute deals compress rather than
 * break. A guard that blocked a fourth keynote would be the system overruling the person
 * who has to stand on the stage — and the fourth booking in a week is sometimes three
 * short sessions in one city and sometimes three flights.
 *
 * So this returns a sentence, not a veto. It is shown where a date is chosen, and it is
 * raised once when a hold is placed. Somebody who wants the fourth booking takes it.
 */

import type { Deal } from './types'
import { isTerminal } from './stages'

/** Ben's number, from the gap analysis. One place, so changing it is one edit. */
export const MAX_KEYNOTES_PER_WEEK = 3

/** How far either side of a date Liezel actually looks. */
export const ADJACENT_DAYS = 1

export interface CapacityCheck {
  date: string
  /** Live keynotes in the same Monday-to-Sunday week, excluding the deal being checked. */
  week: Deal[]
  /** Of those, the ones within a day — the back-to-back risk rather than the week's load. */
  adjacent: Deal[]
  /** True once the week is already at Ben's maximum without this one. */
  atCap: boolean
  /** Always populated, and written for a person rather than a log. */
  verdict: string
}

/** Monday of the week a date falls in. ISO weeks, because the rule is "per week". */
export function weekStart(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  // getUTCDay is 0 on Sunday, which belongs to the week that started six days earlier.
  const back = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - back)
  return d.toISOString().slice(0, 10)
}

function daysApart(a: string, b: string): number {
  return Math.abs(
    Math.round(
      (new Date(`${a.slice(0, 10)}T00:00:00Z`).getTime() -
        new Date(`${b.slice(0, 10)}T00:00:00Z`).getTime()) /
        86_400_000,
    ),
  )
}

/**
 * A keynote that counts against the week.
 *
 * Coaching sessions and workshops do not: the rule is about standing on a stage in a
 * different city, which is what makes three a lot. Lost and historical deals do not
 * either — the question is what Ben has actually committed to.
 */
function counts(deal: Deal): boolean {
  if (deal.historical || isTerminal(deal.stage)) return false
  if (deal.dealType && deal.dealType !== 'keynote') return false
  return Boolean(deal.eventDate) && deal.stage !== 'inquiry'
}

/**
 * What else is on, around a date.
 *
 * `candidateId` is excluded so a deal never counts itself — checking a booked deal's own
 * date would otherwise always report one more keynote than there is.
 */
export function checkCapacity(date: string, deals: Deal[], candidateId?: string): CapacityCheck {
  const start = weekStart(date)
  const week = deals.filter(
    (d) => d.id !== candidateId && counts(d) && weekStart(d.eventDate!) === start,
  )
  const adjacent = week.filter((d) => daysApart(d.eventDate!, date) <= ADJACENT_DAYS)
  const atCap = week.length >= MAX_KEYNOTES_PER_WEEK

  return { date, week, adjacent, atCap, verdict: verdictFor(week.length, adjacent, atCap) }
}

function verdictFor(inWeek: number, adjacent: Deal[], atCap: boolean): string {
  const names = adjacent
    .map((d) => `${d.client?.name ?? d.name}${d.eventDate ? ` (${d.eventDate.slice(5)})` : ''}`)
    .join(', ')

  if (atCap) {
    return (
      `That week already has ${inWeek} keynotes, which is Ben's maximum. ` +
      (names ? `${names} ${adjacent.length === 1 ? 'is' : 'are'} within a day. ` : '') +
      'Nothing is blocked — this is his call, not the system’s.'
    )
  }
  if (adjacent.length > 0) {
    return `${names} ${adjacent.length === 1 ? 'is' : 'are'} within a day of this date. ${inWeek} in the week.`
  }
  if (inWeek === 0) return 'Nothing else that week.'
  return `${inWeek} other keynote${inWeek === 1 ? '' : 's'} that week, none adjacent.`
}
