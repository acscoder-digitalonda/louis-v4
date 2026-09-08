/**
 * WP1.2 — FOLLOW-UP MECHANICS. When to chase, and whose job it is.
 *
 * v3 had two timers hanging off the decision date: a soft check-in at +2 and a forcing
 * email at +7. SpeakerOS replaces that with a cadence that keeps running whether or not a
 * decision date exists, and — the part that actually matters — decides **who** chases.
 *
 * ── The owner rule ─────────────────────────────────────────────────────────
 *
 * Zero or one touches, Liezel. From the third, Ben.
 *
 * It is a formula rather than a field for one reason: a field can be forgotten. The whole
 * point is that the escalation happens without anyone deciding to escalate, because
 * deciding to escalate is exactly what a busy person does not do.
 *
 * ── Mute is not close ──────────────────────────────────────────────────────
 *
 * A muted deal is still live and still forecast. It just stops being chased, because the
 * client said "ask me in March" and chasing them in January loses the deal. Mute has an
 * end date; a mute with no end is a deal quietly abandoned, so an expired mute simply
 * stops applying rather than needing anyone to un-mute it.
 */

import type { Deal, NextActionOwner } from './types'
import { isTerminal } from './stages'

/** Business days, because a chase that lands on Sunday is a chase nobody reads. */
export function addBusinessDays(from: string, days: number): string {
  const d = new Date(`${from.slice(0, 10)}T00:00:00Z`)
  let left = days
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const day = d.getUTCDay()
    if (day !== 0 && day !== 6) left -= 1
  }
  return d.toISOString().slice(0, 10)
}

/**
 * Who owns the next chase.
 *
 * SpeakerOS: 0–1 touches Liezel, 2+ Ben. Read as "the third contact comes from Ben",
 * which is the point — a second nudge from the office is a nudge; a note from the speaker
 * is a decision moment.
 */
export function nextActionOwner(followUpCount: number): NextActionOwner {
  return followUpCount >= 2 ? 'owner' : 'ops'
}

/** True while a mute is in force. An expired mute stops applying on its own. */
export function isMuted(
  deal: Pick<Deal, 'muted' | 'muteUntil'>,
  today = new Date().toISOString().slice(0, 10),
): boolean {
  if (!deal.muted) return false
  if (!deal.muteUntil) return true
  return deal.muteUntil >= today
}

export const FOLLOW_UP_GAP_DAYS = 3

/**
 * How long a hold may sit unmoved before it is a decision nobody has made.
 *
 * Lives here rather than in the timer because two callers now need the same number: the
 * sweep that counts stale holds and the digest that lists them. A rule with two copies is
 * a rule that will be changed in one of them.
 */
export const STALE_HOLD_DAYS = 21

/**
 * The date the next chase is due.
 *
 * The decision date stretches the cadence rather than replacing it: while a client is
 * still inside the window they gave us, chasing every three days is noise. Once it
 * passes, the normal rhythm resumes — and if it has already passed when we look, the
 * chase is due now, per the run plan's no-limits rule.
 */
export function nextActionDate(
  deal: Pick<Deal, 'decisionDate' | 'stage'>,
  lastActivity: string,
  today = new Date().toISOString().slice(0, 10),
): string | null {
  if (isTerminal(deal.stage)) return null

  const normal = addBusinessDays(lastActivity, FOLLOW_UP_GAP_DAYS)
  const decision = deal.decisionDate?.slice(0, 10)

  // Inside the window the client named: wait for it, then chase the day after.
  if (decision && decision > today && normal < decision) {
    return addBusinessDays(decision, 1)
  }
  return normal < today ? today : normal
}

export interface ChaseDecision {
  due: boolean
  /** Null when nothing is due. */
  owner: NextActionOwner | null
  /** Always populated — the reason it is or is not due, for the digest and the audit. */
  reason: string
}

/**
 * Should this deal be chased today, and by whom?
 *
 * Every branch returns a reason. A follow-up engine that silently decides not to chase is
 * indistinguishable from one that is broken, and the digest is where a person notices.
 */
export function shouldChase(
  deal: Pick<Deal, 'stage' | 'muted' | 'muteUntil' | 'nextActionDate' | 'followUpCount' | 'historical'>,
  today = new Date().toISOString().slice(0, 10),
): ChaseDecision {
  if (deal.historical) {
    return { due: false, owner: null, reason: 'Imported history — never chased.' }
  }
  if (isTerminal(deal.stage)) {
    return { due: false, owner: null, reason: 'The deal is closed.' }
  }
  if (isMuted(deal, today)) {
    const until = deal.muteUntil ? ` until ${deal.muteUntil}` : ' with no end date'
    return { due: false, owner: null, reason: `Muted${until}.` }
  }
  if (!deal.nextActionDate) {
    return { due: false, owner: null, reason: 'No next action date set yet.' }
  }
  if (deal.nextActionDate > today) {
    return { due: false, owner: null, reason: `Next action is ${deal.nextActionDate}.` }
  }

  const owner = nextActionOwner(deal.followUpCount)
  const nth = deal.followUpCount + 1
  return {
    due: true,
    owner,
    reason:
      owner === 'owner'
        ? `Follow-up ${nth}: escalated, because two have already gone out from the office.`
        : `Follow-up ${nth}, due ${deal.nextActionDate}.`,
  }
}

/**
 * What a chase does to the deal afterwards.
 *
 * Separated from `shouldChase` so the engine can decide and record in two steps, and so
 * the arithmetic is testable without a database.
 */
export function afterChase(
  deal: Pick<Deal, 'followUpCount' | 'decisionDate' | 'stage'>,
  on = new Date().toISOString().slice(0, 10),
): { followUpCount: number; nextActionDate: string | null } {
  const followUpCount = deal.followUpCount + 1
  return { followUpCount, nextActionDate: nextActionDate(deal, on, on) }
}

/** Closing a deal clears the chase state, so a reopened deal does not resume mid-cadence. */
export function clearOnClose(): Pick<Deal, 'nextActionDate' | 'followUpCount' | 'muted' | 'muteUntil'> {
  return { nextActionDate: null, followUpCount: 0, muted: false, muteUntil: null }
}
