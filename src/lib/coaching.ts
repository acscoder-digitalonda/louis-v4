/**
 * The coaching delivery ledger.
 *
 * A coaching deal is three sessions, not an event. Everything the keynote pipeline does
 * hangs off one date; this hangs off a sequence, and the failure mode is different — a
 * keynote that goes wrong is loud, and a coaching engagement that goes wrong just quietly
 * stops after session two and nobody notices for a month.
 *
 * So the ledger's job is to always have an answer to "what happens next", and to say when
 * that answer is "nothing, and it has been three weeks".
 *
 * ── What is settled and what is inferred ───────────────────────────────────
 *
 * From the gap analysis: three sessions, 15,000 for the set, 50/50 billing, a follow-up
 * after each session, and "sell the next track" at the end. Jordan wrote four templates
 * for it (E22, E22b, E22c, E22d), so the motion is real.
 *
 * The **cadence** is not in any document. Two weeks between sessions is this file's
 * inference, marked as such, kept in one constant, and surfaced in the UI as a default
 * rather than a rule — because the alternative was to have no dates at all, and a ledger
 * with no dates cannot tell you it has stalled.
 */

import type { CoachingSession, Deal, DealTypeKey } from './types'

export const SESSIONS_PER_TRACK = 3

/**
 * Inferred, not specified. Two weeks is long enough to act on a session and short enough
 * that the engagement keeps its shape. Ben should change it once and it changes here.
 */
export const DEFAULT_GAP_DAYS = 14

/** How long a session may sit unscheduled before it is a problem worth raising. */
export const STALL_DAYS = 21

export function isCoaching(dealType: DealTypeKey | null | undefined): boolean {
  return dealType === 'speaker-coaching' || dealType === 'executive-coaching'
}

function addDays(from: string, days: number): string {
  const d = new Date(`${from.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * The three sessions a new coaching deal needs.
 *
 * Created unscheduled when there is no kick-off date to count from. An empty date is
 * honest — nobody has agreed a time yet — and the ledger chases it. Inventing three dates
 * from thin air would make the deal look arranged when it is not.
 */
export function plannedSessions(
  deal: Pick<Deal, 'id' | 'kickoffDate' | 'eventDate'>,
  gapDays = DEFAULT_GAP_DAYS,
): Omit<CoachingSession, 'id'>[] {
  const start = deal.kickoffDate?.slice(0, 10) ?? deal.eventDate?.slice(0, 10) ?? null
  return Array.from({ length: SESSIONS_PER_TRACK }, (_, i) => ({
    dealId: deal.id,
    sessionNumber: i + 1,
    scheduledFor: start ? addDays(start, i * gapDays) : null,
    held: false,
    notes: null,
  }))
}

export interface LedgerState {
  total: number
  held: number
  /** The next session to happen, or null when the track is complete. */
  next: CoachingSession | null
  complete: boolean
  /** What should happen now, in a sentence a person can act on. */
  nextAction: string
  /** True when the track has stalled: sessions remain and nothing is scheduled. */
  stalled: boolean
  /** After the last session, the conversation is about the next track. */
  sellNextTrack: boolean
}

/**
 * Where this engagement has got to.
 *
 * Always returns a `nextAction`, including when the answer is "nothing". A ledger that
 * goes quiet is indistinguishable from one that is finished, and the difference is a
 * client who paid for three sessions and had two.
 */
export function ledger(
  sessions: CoachingSession[],
  today: string,
  lastActivity?: string | null,
): LedgerState {
  const ordered = [...sessions].sort((a, b) => a.sessionNumber - b.sessionNumber)
  const held = ordered.filter((s) => s.held).length
  const next = ordered.find((s) => !s.held) ?? null
  const complete = ordered.length > 0 && held >= ordered.length

  if (complete) {
    return {
      total: ordered.length,
      held,
      next: null,
      complete: true,
      nextAction: 'All three sessions delivered. Offer the next track.',
      stalled: false,
      sellNextTrack: true,
    }
  }

  if (!next) {
    // No sessions at all: the deal was accepted and the ledger was never opened.
    return {
      total: 0,
      held: 0,
      next: null,
      complete: false,
      nextAction: 'No sessions on this deal yet. Open the ledger.',
      stalled: true,
      sellNextTrack: false,
    }
  }

  if (!next.scheduledFor) {
    const since = lastActivity?.slice(0, 10) ?? null
    const waited = since ? daysBetween(since, today) : 0
    return {
      total: ordered.length,
      held,
      next,
      complete: false,
      nextAction: `Session ${next.sessionNumber} of ${ordered.length} has no date. Book it.`,
      stalled: waited >= STALL_DAYS,
      sellNextTrack: false,
    }
  }

  const days = daysBetween(today, next.scheduledFor)
  return {
    total: ordered.length,
    held,
    next,
    complete: false,
    nextAction:
      days < 0
        ? `Session ${next.sessionNumber} was ${Math.abs(days)} days ago and is not marked held.`
        : days === 0
          ? `Session ${next.sessionNumber} is today.`
          : `Session ${next.sessionNumber} in ${days} days.`,
    // A session whose date has passed without being marked held is the quiet failure
    // this whole module exists to catch.
    stalled: days < -7,
    sellNextTrack: false,
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to.slice(0, 10)}T00:00:00Z`).getTime() -
      new Date(`${from.slice(0, 10)}T00:00:00Z`).getTime()) /
      86_400_000,
  )
}

/** The template to draft after a session is marked held. */
export function templateAfter(state: LedgerState): string | null {
  if (state.sellNextTrack) return 'E22d'
  if (state.held > 0) return 'E22c'
  return null
}

/**
 * The 50/50 split.
 *
 * Coaching bills half on signing and half on delivery, per the gap analysis. Returned as
 * two legs rather than a single amount so the money screen shows what is owed and when,
 * which is the question anybody actually asks.
 */
export function billingLegs(amount: number): { label: string; amount: number; due: 'signing' | 'delivery' }[] {
  const half = Math.round(amount / 2)
  return [
    { label: 'Coaching deposit (50%)', amount: half, due: 'signing' },
    { label: 'Coaching balance (50%)', amount: amount - half, due: 'delivery' },
  ]
}
