/**
 * The one-hour reply.
 *
 * An inquiry gets an answer within an hour. It is the only service promise in the gap
 * analysis with a number on it, and it is the one that wins bookings: the bureau that
 * replies first is usually the bureau that gets the date.
 *
 * ── The clock does not run at night ────────────────────────────────────────
 *
 * An enquiry that lands at 11pm cannot be answered by midnight, and a system that says it
 * was breached is lying about a failure nobody could have prevented. The clock therefore
 * runs on working time only, using the same quiet hours that already decide when a
 * notification is allowed to wake somebody up. One setting, two behaviours that would
 * otherwise disagree.
 *
 * ── The clock starts when the client sent, not when we noticed ─────────────
 *
 * A deal's `createdAt` is when the intake sweep got round to it, and the sweep runs on a
 * schedule. Measuring from it means the promise is kept by sweeping less often: an hourly
 * sweep would let an enquiry sit for fifty-nine minutes and then start a sixty-minute
 * clock, and the report would say nothing was late.
 *
 * So the clock starts at the moment the email says it arrived, and falls back to the deal
 * only when there is no email — a deal typed in by hand starts when it was typed.
 *
 * ── What counts as a reply ─────────────────────────────────────────────────
 *
 * A draft actually sent on the deal. Not a draft written, not the stage moving — those
 * are the office working, and the client cannot see either of them.
 */

import type { Deal, Draft } from './types'
import { DEFAULT_QUIET_HOURS, isQuiet, type QuietHours } from './quiet-hours'

/** The promise, in minutes. */
export const REPLY_SLA_MINUTES = 60

/**
 * Only fresh inquiries are asked this question.
 *
 * A deal that has sat at Inquiry for three days has a follow-up problem, not a reply-time
 * problem, and the digest already owns it. Bounding the window also keeps the sweep to a
 * single Airtable request on almost every run.
 */
export const SLA_WINDOW_HOURS = 24

export interface SlaState {
  /** When the clock started: the moment the inquiry arrived. */
  startedAt: string
  /** Working minutes elapsed. Night does not count. */
  elapsed: number
  /** Working minutes left, floored at zero. */
  remaining: number
  breached: boolean
  /** When the reply went, if it has. A replied deal is never breached. */
  repliedAt: string | null
  /** A sentence for a screen. Always populated. */
  label: string
}

/**
 * Working minutes between two moments.
 *
 * Walks hour boundaries rather than minutes: quiet hours have whole-hour granularity, so
 * an hour is the smallest interval in which the answer can change, and a deal left open
 * over a long weekend does not cost thousands of iterations. `limit` stops the walk as
 * soon as the answer cannot matter any more.
 */
export function workingMinutes(
  from: Date,
  to: Date,
  hours: QuietHours = DEFAULT_QUIET_HOURS,
  limit = Number.POSITIVE_INFINITY,
): number {
  if (to <= from) return 0
  let total = 0
  let cursor = from
  while (cursor < to && total < limit) {
    const nextHour = new Date(cursor)
    nextHour.setUTCMinutes(0, 0, 0)
    nextHour.setUTCHours(nextHour.getUTCHours() + 1)
    const end = nextHour < to ? nextHour : to
    if (!isQuiet(hours, cursor)) total += (end.getTime() - cursor.getTime()) / 60_000
    cursor = end
  }
  return total
}

/** The earliest reply actually sent on a deal. */
export function repliedAt(drafts: Draft[], dealId: string): string | null {
  const sent = drafts
    .filter((d) => d.dealId === dealId && d.status === 'sent' && d.sentAt)
    .map((d) => d.sentAt!)
    .sort()
  return sent[0] ?? null
}

/**
 * Whether this deal is still inside the window the SLA applies to.
 *
 * Separate from `slaState` so the sweep can narrow its candidate list before it pays for
 * anything else.
 */
export function inWindow(
  deal: Pick<Deal, 'stage' | 'createdAt'>,
  now: Date,
  arrivedAt?: string | null,
): boolean {
  if (deal.stage !== 'inquiry') return false
  const age = now.getTime() - new Date(arrivedAt ?? deal.createdAt).getTime()
  return age >= 0 && age <= SLA_WINDOW_HOURS * 3_600_000
}

export function slaState(
  deal: Pick<Deal, 'id' | 'createdAt'>,
  drafts: Draft[],
  now: Date = new Date(),
  hours: QuietHours = DEFAULT_QUIET_HOURS,
  /** When the enquiry actually arrived, if an email on this deal says so. */
  arrivedAt?: string | null,
): SlaState {
  const startedAt = arrivedAt ?? deal.createdAt
  const started = new Date(startedAt)
  const reply = repliedAt(drafts, deal.id)

  if (reply) {
    const took = workingMinutes(started, new Date(reply), hours)
    return {
      startedAt,
      elapsed: took,
      remaining: Math.max(0, REPLY_SLA_MINUTES - took),
      breached: false,
      repliedAt: reply,
      label:
        took <= REPLY_SLA_MINUTES
          ? `Replied in ${Math.round(took)} min.`
          : // Recorded, not alarmed about. It is done, and the number is the useful part.
            `Replied after ${Math.round(took)} min.`,
    }
  }

  const elapsed = workingMinutes(started, now, hours, REPLY_SLA_MINUTES + 1)
  const remaining = Math.max(0, REPLY_SLA_MINUTES - elapsed)
  return {
    startedAt,
    elapsed,
    remaining,
    breached: elapsed > REPLY_SLA_MINUTES,
    repliedAt: null,
    label:
      elapsed > REPLY_SLA_MINUTES
        ? 'No reply sent, and the hour is up.'
        : isQuiet(hours, now)
          ? `Reply due — ${Math.round(remaining)} min left once the day starts.`
          : `Reply due in ${Math.round(remaining)} min.`,
  }
}
