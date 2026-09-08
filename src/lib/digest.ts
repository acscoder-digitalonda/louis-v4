/**
 * WP1.2 — the daily digest.
 *
 * One message a morning, to the person whose turn it is, listing what needs them today.
 *
 * ── Why this exists as a thing separate from notifications ─────────────────
 *
 * The timer sweep was raising a notification per finding: a stale hold here, a
 * questionnaire there, a journal nudge, a chase due. On a quiet day that is four emails;
 * on a busy one it is fifteen, and fifteen emails at 7am is a filter rule. The digest
 * inverts it — everything that is not urgent arrives once, in a list, addressed to the
 * person who has to act.
 *
 * ── Whose digest ───────────────────────────────────────────────────────────
 *
 * The Next Action Owner formula already decides who chases each deal: nought or one touch
 * is the office, from the third it is Ben. The digest follows that, so Ben's morning list
 * is the handful that have escalated to him rather than everything Liezel is working.
 *
 * Muted deals are excluded, which is the entire point of mute.
 */

import type { Deal, NextActionOwner } from './types'
import { isMuted, shouldChase } from './followup'
import { isTerminal } from './stages'
import { STALE_HOLD_DAYS } from './followup'
import { isCoaching, ledger } from './coaching'
import { nudgesFor } from './fulfillment'
import type { CoachingSession, Fulfillment } from './types'

export type DigestKind =
  | 'chase'
  | 'stale-hold'
  | 'questionnaire'
  | 'logistics'
  | 'journal'
  | 'coaching'
  | 'conflict'

export interface DigestItem {
  kind: DigestKind
  dealId: string
  title: string
  detail: string
  /** Sorts the list. Lower is more urgent. */
  rank: number
}

export interface Digest {
  owner: NextActionOwner
  items: DigestItem[]
  /** Deals held back by mute, counted rather than listed. */
  muted: number
}

/**
 * How urgent each kind is, and therefore the order of the list.
 *
 * A person reads the top three. Everything below that is reference, so the ordering is
 * the most consequential thing in this file — a chase that has escalated to Ben sits
 * above a journal nudge because a lost deal costs more than a late box of books.
 */
const RANK: Record<DigestKind, number> = {
  conflict: 0,
  logistics: 1,
  chase: 2,
  questionnaire: 3,
  coaching: 4,
  journal: 5,
  'stale-hold': 6,
}

export interface DigestInput {
  deals: Deal[]
  today: string
  sessionsByDeal?: Map<string, CoachingSession[]>
  fulfillment?: Fulfillment[]
  conflictDealIds?: Set<string>
  /**
   * Open pre-event tasks per deal. Names what is actually outstanding, so the line reads
   * "AV contact, travel" rather than "logistics not complete", which nobody can act on.
   */
  openLogisticsByDeal?: Map<string, string[]>
}

/**
 * Builds one person's morning list.
 *
 * Returns items rather than sending anything, so the ordering and the exclusions can be
 * tested without a mail server — and so the same list can be rendered on a screen.
 */
export function buildDigest(owner: NextActionOwner, input: DigestInput): Digest {
  const items: DigestItem[] = []
  let muted = 0

  for (const deal of input.deals) {
    if (deal.historical || isTerminal(deal.stage)) continue

    if (isMuted(deal, input.today)) {
      muted += 1
      continue
    }

    const chase = shouldChase(deal, input.today)
    if (chase.due && chase.owner === owner) {
      items.push({
        kind: 'chase',
        dealId: deal.id,
        title: deal.client?.name ?? deal.name,
        detail: chase.reason,
        rank: RANK.chase,
      })
    }

    // Everything below is the office's work regardless of whose chase it is: Ben does not
    // want a questionnaire reminder, and putting one in his list is how he stops reading.
    if (owner !== 'ops') continue

    if (input.conflictDealIds?.has(deal.id)) {
      items.push({
        kind: 'conflict',
        dealId: deal.id,
        title: deal.client?.name ?? deal.name,
        detail: 'Two deals want this date. Nothing is released until somebody decides.',
        rank: RANK.conflict,
      })
    }

    // A hold that has sat three weeks is not an emergency at 3am and never was one; it
    // is a decision nobody has made, which is exactly what a morning list is for.
    const holdAge = daysSince(deal.holdDate, input.today)
    if (deal.stage === 'qualified' && holdAge !== null && holdAge >= STALE_HOLD_DAYS) {
      items.push({
        kind: 'stale-hold',
        dealId: deal.id,
        title: deal.client?.name ?? deal.name,
        detail: `Hold placed ${holdAge} days ago with no movement. Release it or force a decision.`,
        rank: RANK['stale-hold'],
      })
    }

    const toEvent = daysUntil(deal.eventDate, input.today)

    // The stage gates match the timer's: a deal still at Inquiry with a date ten days out
    // has no questionnaire to chase, and putting it in the list teaches people to skim.
    if (
      toEvent !== null &&
      toEvent >= 0 &&
      toEvent <= 14 &&
      !deal.questionnaireReceived &&
      (deal.stage === 'closed-won' || deal.stage === 'pre-event')
    ) {
      items.push({
        kind: 'questionnaire',
        dealId: deal.id,
        title: deal.client?.name ?? deal.name,
        detail: `Questionnaire not back, ${toEvent} days out.`,
        rank: RANK.questionnaire,
      })
    }

    if (
      toEvent !== null &&
      toEvent >= 0 &&
      toEvent <= 12 &&
      !deal.logisticsComplete &&
      deal.stage === 'pre-event'
    ) {
      items.push({
        kind: 'logistics',
        dealId: deal.id,
        title: deal.client?.name ?? deal.name,
        detail:
          `${toEvent} days out — ` +
          (input.openLogisticsByDeal?.get(deal.id)?.join(', ') || 'logistics are not marked complete'),
        rank: RANK.logistics,
      })
    }

    if (isCoaching(deal.dealType)) {
      const state = ledger(input.sessionsByDeal?.get(deal.id) ?? [], input.today, deal.lastModified)
      if (state.stalled) {
        items.push({
          kind: 'coaching',
          dealId: deal.id,
          title: deal.client?.name ?? deal.name,
          detail: state.nextAction,
          rank: RANK.coaching,
        })
      }
    }
  }

  if (owner === 'ops') {
    for (const record of input.fulfillment ?? []) {
      const red = nudgesFor(record, input.today).filter((n) => n.severity === 'red')
      if (red.length === 0) continue
      items.push({
        kind: 'journal',
        dealId: record.dealId ?? '',
        title: 'Journal order',
        detail: red.map((n) => n.message).join(' · '),
        rank: RANK.journal,
      })
    }
  }

  return {
    owner,
    items: items.sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title)),
    muted,
  }
}

/** Days elapsed since a past date, or null when there is no date. */
function daysSince(date: string | null, today: string): number | null {
  const d = daysUntil(date, today)
  return d === null ? null : -d
}

function daysUntil(date: string | null, today: string): number | null {
  if (!date) return null
  return Math.round(
    (new Date(`${date.slice(0, 10)}T00:00:00Z`).getTime() -
      new Date(`${today}T00:00:00Z`).getTime()) /
      86_400_000,
  )
}

/**
 * The digest as a message.
 *
 * Says the count first, because the useful question at 7am is "how much is there", and
 * says explicitly when the answer is none — a digest that only arrives when there is work
 * teaches people that silence means broken.
 */
export function renderDigest(digest: Digest, name: string): { subject: string; body: string } {
  if (digest.items.length === 0) {
    return {
      subject: 'Nothing needs you today',
      body: [
        `Morning ${name}. Nothing is waiting.`,
        digest.muted > 0 ? `\n${digest.muted} deal(s) are muted and were not counted.` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  }

  const lines = digest.items.map((i) => `${i.title} — ${i.detail}`)
  return {
    subject: `${digest.items.length} thing${digest.items.length === 1 ? '' : 's'} today`,
    body: [
      `Morning ${name}. ${digest.items.length} thing${digest.items.length === 1 ? '' : 's'} need you:`,
      '',
      ...lines,
      digest.muted > 0 ? `\n${digest.muted} muted deal(s) were left out.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  }
}
