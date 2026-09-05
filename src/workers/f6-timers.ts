/**
 * F6 — TIMERS.
 *
 * One daily sweep. No AI: every message comes from the script bank, and every rule below
 * is a date comparison. The point of writing them here rather than in Airtable automations
 * is that they are testable, versioned, and visible in one place.
 *
 * Fires once per condition per deal: existing drafts and tasks are the idempotency key,
 * so running the sweep twice in a day does not send the same nudge twice.
 */

import { db } from '@/lib/data'
import { notify } from '@/lib/notify'
import { daysUntil } from '@/lib/format'
import { composeDraft } from './f7-drafts'
import type { Deal, Draft, JournalOrder } from '@/lib/types'

const WORKER = 'F6'
const STALE_HOLD_DAYS = 21
const JOURNAL_NUDGE_DAYS = 35

export interface TimerReport {
  softCheckIns: number
  forcingEmails: number
  staleHolds: number
  questionnaireChases: number
  redAlerts: number
  journalNudges: number
}

export async function run(): Promise<TimerReport> {
  const provider = db()
  const [deals, drafts, tasks, journal] = await Promise.all([
    provider.listDeals(),
    provider.listDrafts(),
    provider.listTasks(),
    provider.listJournalOrders(),
  ])

  const report: TimerReport = {
    softCheckIns: 0,
    forcingEmails: 0,
    staleHolds: 0,
    questionnaireChases: 0,
    redAlerts: 0,
    journalNudges: 0,
  }

  for (const deal of deals) {
    if (deal.stage === 'dormant') continue
    // One deal that cannot be processed — an unwritable draft, a model outage — must not
    // cost every other deal its sweep for the day.
    try {
      await sweepDeal(deal)
    } catch (err) {
      console.error(`[${WORKER}] ${deal.name} failed`, err)
    }
  }

  console.info(`[${WORKER}]`, report)
  return report

  async function sweepDeal(deal: Deal): Promise<void> {
    // ── decision date passed ────────────────────────────────────────────
    const sinceDecision = negate(daysUntil(deal.decisionDate))
    if (deal.stage === 'sales' && sinceDecision !== null) {
      if (sinceDecision >= 2 && !hasDraft(drafts, deal.id, 'follow-up')) {
        await composeDraft({ deal, type: 'follow-up', templateKey: 'followup.soft' })
        report.softCheckIns += 1
      }
      if (sinceDecision >= 7 && !hasDraft(drafts, deal.id, 'forcing')) {
        await composeDraft({ deal, type: 'forcing', templateKey: 'followup.forcing' })
        report.forcingEmails += 1
      }
    }

    // ── stale hold ──────────────────────────────────────────────────────
    const holdAge = negate(daysUntil(deal.holdDate))
    if (deal.stage === 'sales' && holdAge !== null && holdAge >= STALE_HOLD_DAYS) {
      await notify({
        type: 'red-alert',
        title: `Hold going stale — ${deal.name}`,
        body: `The hold was placed ${holdAge} days ago with no movement. Release it or force a decision.`,
        link: `/deals/${deal.id}?tab=sales`,
        roles: ['ops', 'admin'],
      })
      report.staleHolds += 1
    }

    const toEvent = daysUntil(deal.eventDate)

    // ── questionnaire unreturned at T-14 ────────────────────────────────
    if (
      toEvent !== null &&
      toEvent <= 14 &&
      toEvent >= 0 &&
      !deal.questionnaireReceived &&
      ['closed-won', 'pre-event'].includes(deal.stage) &&
      !hasDraft(drafts, deal.id, 'chase')
    ) {
      await composeDraft({ deal, type: 'chase', templateKey: 'chase.questionnaire' })
      report.questionnaireChases += 1
    }

    // ── logistics incomplete at T-12 ────────────────────────────────────
    if (
      toEvent !== null &&
      toEvent <= 12 &&
      toEvent >= 0 &&
      !deal.logisticsComplete &&
      deal.stage === 'pre-event'
    ) {
      await notify({
        type: 'red-alert',
        title: `Logistics incomplete at T-${toEvent} — ${deal.name}`,
        body: openLogistics(tasks, deal).join(' · ') || 'Logistics are not marked complete.',
        link: `/deals/${deal.id}?tab=logistics`,
        roles: ['ops', 'admin'],
      })
      report.redAlerts += 1
    }

    // ── journal: promo sent but no order, T-35 ──────────────────────────
    if (toEvent !== null && toEvent <= JOURNAL_NUDGE_DAYS && toEvent >= 0) {
      const orders = journal.filter((o) => o.dealId === deal.id)
      if (needsJournalNudge(orders)) {
        const title = `Nudge ${deal.client?.name ?? deal.name} on the journal`
        const already = tasks.some(
          (t) => t.dealId === deal.id && !t.done && t.title.toLowerCase() === title.toLowerCase(),
        )
        if (!already) {
          await provider.createTask({
            dealId: deal.id,
            title,
            assignee: process.env.OPS_EMAIL ?? null,
            dueDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
            source: 'timer',
            stage: deal.stage,
            done: false,
            createdAt: new Date().toISOString(),
          })
          report.journalNudges += 1
        }
      }
    }
  }
}

function hasDraft(drafts: Draft[], dealId: string, type: Draft['type']): boolean {
  return drafts.some((d) => d.dealId === dealId && d.type === type && d.status !== 'dismissed')
}

function negate(days: number | null): number | null {
  return days === null ? null : -days
}

function openLogistics(tasks: { dealId: string | null; done: boolean; title: string; stage: string | null }[], deal: Deal): string[] {
  return tasks
    .filter((t) => t.dealId === deal.id && !t.done && t.stage === 'pre-event')
    .map((t) => t.title)
}

/** Promo went out, interest exists, but nobody has ordered. That is the nudge moment. */
function needsJournalNudge(orders: JournalOrder[]): boolean {
  if (orders.length === 0) return false
  const ordered = orders.some((o) => ['bulk-ordered', 'shipped', 'dropship'].includes(o.status))
  const promoed = orders.some((o) => ['promo-sent', 'received', 'interested'].includes(o.status))
  return promoed && !ordered
}
