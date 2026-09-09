/**
 * WP1.7 — CLOSED-LOST RECOVERY. The twelve-month knock.
 *
 * Every lost deal carries a reason, and the reason is the whole mechanism: a company that
 * ran out of budget is a different conversation twelve months later from one that decided
 * against having a speaker at all. Segmenting by reason is what makes the campaign a
 * follow-up rather than a mailshot.
 *
 * This is why `Closed Lost Reason` is an enum and not a note, and why the WP0.2 migration
 * parsed forty-five released inquiries into it instead of leaving the text where it sat.
 *
 * ── Who is eligible, and who is deliberately not ───────────────────────────
 *
 * Twelve months since the deal was lost, give or take a window. Not sooner: a company
 * that said no in March does not want to hear from us in June, and the annual cycle is
 * the point — most of these events repeat, so the right moment is when they are planning
 * the next one.
 *
 * Three reasons are never re-engaged automatically. `chose-another-speaker` is a
 * relationship question, not a campaign. `went-quiet` means we already sent more than
 * they wanted. `other` means nobody knows why, and a campaign built on not knowing is
 * how a list gets burned.
 */

import type { ClosedLostReason, Deal } from './types'

/** Reasons that come back around, and the angle each one gets. */
export const RE_ENGAGEABLE: Record<string, { angle: string; templateKey: string }> = {
  budget: {
    angle: 'Budget cycles reset. Ask what the number would need to be.',
    templateKey: 'reengage.budget',
  },
  'date-unavailable': {
    angle: 'The date was the problem, not the fit. Lead with availability.',
    templateKey: 'reengage.date',
  },
  'no-speaker': {
    angle: 'They ran the event without a speaker. Ask how it went.',
    templateKey: 'reengage.nospeaker',
  },
  postponed: {
    angle: 'The event moved or died. Find out whether it came back.',
    templateKey: 'reengage.postponed',
  },
}

/** Reasons a machine must not act on. Each is a person's call, not a campaign's. */
export const HANDS_OFF: ClosedLostReason[] = ['chose-another-speaker', 'went-quiet', 'other', 'junk']

export const WINDOW_MONTHS = 12
/** How wide the anniversary is. A campaign that fires on one exact day misses most of them. */
export const WINDOW_DAYS = 45

export function monthsBetween(from: string, to: string): number {
  const a = new Date(`${from.slice(0, 10)}T00:00:00Z`)
  const b = new Date(`${to.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth())
}

function daysBetween(from: string, to: string): number {
  const ms =
    new Date(`${to.slice(0, 10)}T00:00:00Z`).getTime() -
    new Date(`${from.slice(0, 10)}T00:00:00Z`).getTime()
  return Math.round(ms / 86_400_000)
}

export interface Candidate {
  deal: Deal
  reason: ClosedLostReason
  angle: string
  templateKey: string
  /** Days since the deal was lost, for the reviewer. */
  daysSince: number
}

export interface Skipped {
  deal: Deal
  why: string
}

export interface CampaignPlan {
  due: Candidate[]
  skipped: Skipped[]
  /** Counts by reason, so a person can see the shape of a segment before sending. */
  segments: Record<string, number>
}

/**
 * The anniversary date a deal becomes eligible.
 *
 * Measured from when it was lost, which is `lastModified` on a closed-lost deal — the
 * closest thing to a "lost on" date the schema has. Worth knowing: if someone edits an
 * old lost deal, its anniversary moves. That is a real limitation and the alternative is
 * a Closed Lost Date field nobody would remember to fill.
 */
export function eligibleFrom(deal: Pick<Deal, 'lastModified'>): string {
  const d = new Date(`${deal.lastModified.slice(0, 10)}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + WINDOW_MONTHS)
  return d.toISOString().slice(0, 10)
}

/**
 * Which lost deals are ready for a knock today, and which are not, and why.
 *
 * The `skipped` list is not decoration. This campaign reaches real people who already
 * said no once, and the difference between a good list and a burned one is entirely in
 * what was left out — so leaving something out has to be as visible as including it.
 */
export function planCampaign(deals: Deal[], today: string): CampaignPlan {
  const due: Candidate[] = []
  const skipped: Skipped[] = []

  for (const deal of deals) {
    if (deal.stage !== 'closed-lost') continue

    if (deal.historical) {
      skipped.push({ deal, why: 'Imported history — never campaigned to.' })
      continue
    }
    if (!deal.closedLostReason) {
      skipped.push({ deal, why: 'No reason recorded, so there is no angle to lead with.' })
      continue
    }
    if (HANDS_OFF.includes(deal.closedLostReason)) {
      skipped.push({
        deal,
        why:
          deal.closedLostReason === 'chose-another-speaker'
            ? 'Chose another speaker — a relationship question, not a campaign.'
            : deal.closedLostReason === 'went-quiet'
              ? 'Went quiet — they already had more from us than they wanted.'
              : deal.closedLostReason === 'junk'
                ? 'Discarded as junk — it was never a deal, so there is nobody to re-engage.'
                : 'Reason is Other, and a campaign built on not knowing burns the list.',
      })
      continue
    }
    if (deal.muted) {
      skipped.push({ deal, why: 'Muted.' })
      continue
    }

    const from = eligibleFrom(deal)
    const drift = daysBetween(from, today)
    if (drift < 0) {
      skipped.push({ deal, why: `Not yet — eligible from ${from}.` })
      continue
    }
    if (drift > WINDOW_DAYS) {
      skipped.push({
        deal,
        why: `The anniversary passed ${drift} days ago; outside the ${WINDOW_DAYS}-day window.`,
      })
      continue
    }

    const spec = RE_ENGAGEABLE[deal.closedLostReason]!
    due.push({
      deal,
      reason: deal.closedLostReason,
      angle: spec.angle,
      templateKey: spec.templateKey,
      daysSince: daysBetween(deal.lastModified.slice(0, 10), today),
    })
  }

  const segments: Record<string, number> = {}
  for (const c of due) segments[c.reason] = (segments[c.reason] ?? 0) + 1

  return {
    due: due.sort((a, b) => a.deal.name.localeCompare(b.deal.name)),
    skipped,
    segments,
  }
}
