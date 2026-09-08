/**
 * F6 — TIMERS.
 *
 * One daily sweep. No AI: every message comes from the script bank, and every rule below
 * is a date comparison. The point of writing them here rather than in Airtable automations
 * is that they are testable, versioned, and visible in one place.
 *
 * Fires once per condition per deal: existing drafts and tasks are the idempotency key,
 * so running the sweep twice in a day does not send the same nudge twice.
 *
 * ── What this sweep now drives (WP1.2, 1.3, 1.4, 1.7) ──────────────────────
 *
 * The v3 version had five hardcoded date rules. The engines those became live in
 * `lib/`, are individually tested, and are called from here — which is the whole point:
 * a rule nobody invokes is a rule that does not exist, however well it is tested.
 *
 *   `followup`      whose turn it is to chase, and when
 *   `conflicts`     two deals holding one date
 *   `fulfillment`   journals that will miss the ship-by
 *   `reengagement`  the twelve-month knock on a lost deal
 */

import { db } from '@/lib/data'
import { notify } from '@/lib/notify'
import { daysUntil } from '@/lib/format'
import { composeDraft } from './f7-drafts'
import { agentActor, recordChanges, recordEvent } from '@/lib/audit'
import { afterChase, isMuted, nextActionDate, shouldChase, STALE_HOLD_DAYS } from '@/lib/followup'
import { detectConflicts, existingFor } from '@/lib/conflicts'
import { digestFor } from '@/lib/fulfillment'
import { planCampaign } from '@/lib/reengagement'
import { buildBrief, isDueToday } from '@/lib/road-warrior'
import { issueKitToken, kitReadiness, kitRecipient } from '@/lib/kit'
import { isCoaching, ledger } from '@/lib/coaching'
import { buildDigest, renderDigest } from '@/lib/digest'
import type { Deal, Draft, JournalOrder, Role } from '@/lib/types'
import { isLive } from '@/lib/stages'

const WORKER = 'F6'
const JOURNAL_NUDGE_DAYS = 35

export interface TimerReport {
  softCheckIns: number
  forcingEmails: number
  staleHolds: number
  questionnaireChases: number
  redAlerts: number
  journalNudges: number
  /** WP1.2 — deals whose next action came due today. */
  chasesDue: number
  /** WP1.2 — of those, the ones that escalated to Ben. */
  escalated: number
  /** WP1.3 — date clashes raised that were not already open. */
  conflictsRaised: number
  /** WP1.4 — fulfillment records with something going wrong. */
  fulfillmentAlerts: number
  /** WP1.7 — lost deals that reached their twelve-month anniversary. */
  reEngagementsDue: number
  /** WP3.3 — road-warrior briefs due the day before travel. */
  briefsSent: number
  /** Welcome kits that became due because the sequence completed. */
  kitsReady: number
  /** Coaching tracks that have gone quiet with sessions still owed. */
  coachingStalled: number
  /** Morning digests sent, one per owner who had anything. */
  digestsSent: number
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
    chasesDue: 0,
    escalated: 0,
    conflictsRaised: 0,
    fulfillmentAlerts: 0,
    reEngagementsDue: 0,
    briefsSent: 0,
    kitsReady: 0,
    coachingStalled: 0,
    digestsSent: 0,
  }

  const today = new Date().toISOString().slice(0, 10)

  for (const deal of deals) {
    // `isLive`, not `!isTerminal`: the 802 imported bookings sit at Delivered.
    if (!isLive(deal)) continue
    // One deal that cannot be processed — an unwritable draft, a model outage — must not
    // cost every other deal its sweep for the day.
    try {
      await sweepDeal(deal)
    } catch (err) {
      console.error(`[${WORKER}] ${deal.name} failed`, err)
    }
  }

  // ── Whole-base passes (WP1.3, 1.4, 1.7) ─────────────────────────────────
  // These look across deals rather than at one, so they run after the per-deal loop.
  try {
    await sweepConflicts()
  } catch (err) {
    console.error(`[${WORKER}] conflict sweep failed`, err)
  }
  try {
    await sweepFulfillment()
  } catch (err) {
    console.error(`[${WORKER}] fulfillment sweep failed`, err)
  }
  try {
    await sweepReEngagement()
  } catch (err) {
    console.error(`[${WORKER}] re-engagement sweep failed`, err)
  }

  // ── WP1.2: one morning message per person, instead of one per finding ────
  //
  // The sweep above raises the urgent things immediately — a red alert at T-12 is not a
  // digest item. Everything else arrives here, once, addressed to whoever has to act.
  // Fifteen separate emails at 7am is a filter rule, which is the opposite of the point.
  try {
    await sendDigests()
  } catch (err) {
    console.error(`[${WORKER}] digest failed`, err)
  }

  console.info(`[${WORKER}]`, report)
  return report

  async function sendDigests(): Promise<void> {
    const [users, fulfillment, conflicts] = await Promise.all([
      provider.listUsers(),
      provider.listFulfillment().catch(() => []),
      provider.listDateConflicts().catch(() => []),
    ])

    const sessionsByDeal = new Map<string, Awaited<ReturnType<typeof provider.listCoachingSessions>>>()
    for (const session of await provider.listCoachingSessions().catch(() => [])) {
      if (!session.dealId) continue
      sessionsByDeal.set(session.dealId, [...(sessionsByDeal.get(session.dealId) ?? []), session])
    }

    const openLogisticsByDeal = new Map<string, string[]>()
    for (const deal of deals) {
      const open = openLogistics(tasks, deal)
      if (open.length > 0) openLogisticsByDeal.set(deal.id, open)
    }

    const conflictDealIds = new Set(
      conflicts.filter((c) => c.status === 'open').flatMap((c) => c.dealIds),
    )

    for (const owner of ['ops', 'owner'] as const) {
      const digest = buildDigest(owner, { deals, today, sessionsByDeal, fulfillment, conflictDealIds, openLogisticsByDeal })
      // A digest with nothing in it still goes: silence that means "nothing to do" and
      // silence that means "the worker died" have to look different.
      const wanted: Role[] = owner === 'ops' ? ['ops', 'admin'] : ['owner']
      const recipients = users.filter((u) => u.active && wanted.includes(u.role))
      if (recipients.length === 0) continue

      const { subject, body } = renderDigest(digest, recipients[0]!.name?.split(' ')[0] ?? 'there')
      await notify({
        type: 'qa-digest',
        title: subject,
        body,
        link: '/pipeline',
        to: recipients.map((u) => u.email),
      })
      report.digestsSent += 1
    }
  }

  /**
   * WP1.3 — two live deals holding one date.
   *
   * Detects and raises; never resolves. Decisions Log §3: sometimes two gigs in one day
   * is doable, so the system must not assume a conflict is a conflict. A clash already
   * on the board is left alone rather than re-raised every night.
   */
  async function sweepConflicts(): Promise<void> {
    const existing = await provider.listDateConflicts()
    for (const clash of detectConflicts(deals, today)) {
      if (existingFor(clash, existing)) continue
      const created = await provider.createDateConflict({
        label: clash.label,
        date: clash.date,
        status: 'open',
        proposalIds: [],
        dealIds: clash.deals.map((d) => d.id),
        resolution: null,
        resolvedBy: null,
        createdAt: new Date().toISOString(),
      })
      await notify({
        type: 'red-alert',
        title: `Two deals on ${clash.date}`,
        body:
          `${clash.label}. First hold: ${clash.firstHold.client?.name ?? clash.firstHold.name}.` +
          (clash.challenged ? ' One side has a firm offer out.' : ''),
        link: `/queue?conflict=${created.id}`,
        roles: ['ops', 'admin', 'owner'],
      })
      report.conflictsRaised += 1
    }
  }

  /** WP1.4 — journals that will miss the ship-by unless somebody moves. */
  async function sweepFulfillment(): Promise<void> {
    const records = await provider.listFulfillment()
    // Raised in the morning list rather than one alert per order: a ship-by that is a
    // week out does not improve by arriving separately.
    report.fulfillmentAlerts = digestFor(records, today).length
  }

  /**
   * WP1.7 — the twelve-month knock.
   *
   * Counts and reports; sends nothing. The campaign reaches people who already said no
   * once, and the difference between a good list and a burned one is a human reading it
   * first. What this does is make sure the anniversary is never missed.
   */
  async function sweepReEngagement(): Promise<void> {
    const plan = planCampaign(deals, today)
    report.reEngagementsDue = plan.due.length
    if (plan.due.length === 0) return

    const segments = Object.entries(plan.segments)
      .map(([reason, n]) => `${n} ${reason}`)
      .join(', ')
    await notify({
      type: 'review-item',
      title: `${plan.due.length} lost deal(s) reached twelve months`,
      body:
        `${segments}. Nothing has been sent. Review and send from the queue.\n\n` +
        plan.due.slice(0, 10).map((c) => `${c.deal.name} — ${c.angle}`).join('\n'),
      link: '/queue?tab=reengagement',
      roles: ['ops', 'admin'],
    })
  }

  async function sweepDeal(input: Deal): Promise<void> {
    let deal = input
    // ── WP1.2: whose turn it is to chase, and when ──────────────────────
    //
    // A deal with no next action date has never been armed, so arm it from its last
    // activity rather than waiting for someone to notice. Then ask the engine.
    if (!deal.nextActionDate && !isMuted(deal, today)) {
      const armed = nextActionDate(deal, deal.lastModified.slice(0, 10), today)
      if (armed) {
        await provider.updateDeal(deal.id, { nextActionDate: armed })
        deal = { ...deal, nextActionDate: armed }
      }
    }

    const chase = shouldChase(deal, today)
    if (chase.due) {
      // The escalation is the point: two nudges from the office, then a note from Ben.
      const fromBen = chase.owner === 'owner'
      const type = fromBen ? 'forcing' : 'follow-up'
      if (!hasDraft(drafts, deal.id, type)) {
        await composeDraft({
          deal,
          type,
          templateKey: fromBen ? 'followup.forcing' : 'followup.soft',
        })
        const next = afterChase(deal, today)
        await provider.updateDeal(deal.id, next)
        await recordChanges({
          table: 'deals',
          recordId: deal.id,
          before: { followUpCount: deal.followUpCount, nextActionDate: deal.nextActionDate },
          after: next,
          actor: agentActor(WORKER),
          source: chase.reason,
        })
        report.chasesDue += 1
        if (fromBen) report.escalated += 1
        if (fromBen) report.forcingEmails += 1
        else report.softCheckIns += 1
      }
    }

    // ── stale hold ──────────────────────────────────────────────────────
    const holdAge = negate(daysUntil(deal.holdDate))
    // Counted, not notified. The morning digest lists it — a hold that has sat for three
    // weeks has never once been urgent at the moment the sweep happens to notice it.
    if (deal.stage === 'qualified' && holdAge !== null && holdAge >= STALE_HOLD_DAYS) {
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
      // Also a digest line. It is twelve days out, so it needs to be on today's list and
      // not in today's inbox.
      report.redAlerts += 1
    }

    // ── A coaching track that has stopped moving ────────────────────────
    //
    // A keynote that goes wrong is loud. A coaching engagement that goes wrong quietly
    // stops after session two, and the client who paid for three notices before we do.
    if (isCoaching(deal.dealType) && isLive(deal)) {
      const sessions = await provider.listCoachingSessions(deal.id)
      const state = ledger(sessions, today, deal.lastModified)
      if (state.stalled) report.coachingStalled += 1
    }

    // ── The welcome kit, once the sequence has completed ────────────────
    //
    // Closed Won, then contract signed, then invoice shared, then the kit. Not at
    // Closed-Won, which is where v3 drafted it: the kit says "delighted this is
    // happening" and reads badly to somebody who has not signed anything.
    if (!deal.kitToken && kitReadiness(deal).ready) {
      const token = issueKitToken()
      await provider.updateDeal(deal.id, { kitToken: token })
      deal = { ...deal, kitToken: token }

      const to = kitRecipient(deal)
      await composeDraft({
        deal,
        type: 'kit',
        templateKey: to === 'agent' ? 'kit.welcome' : 'kit.welcome',
      }).catch((err) => console.error(`[${WORKER}] kit draft failed for ${deal.name}`, err))

      await recordEvent({
        table: 'deals',
        recordId: deal.id,
        what: 'Welcome kit ready',
        detail:
          `${process.env.NEXTAUTH_URL ?? ''}/kit/${token}` +
          (to === 'agent' ? ' — goes to the bureau agent, who forwards it' : ''),
        actor: agentActor(WORKER),
        reversible: true,
      })
      report.kitsReady += 1
    }

    // ── WP3.3: the road-warrior brief, T-1 from travel ──────────────────
    if (isDueToday(deal, today) && isLive(deal)) {
      const title = `Road warrior brief — ${deal.name}`
      const already = tasks.some(
        (t) => t.dealId === deal.id && t.title.toLowerCase() === title.toLowerCase(),
      )
      if (!already) {
        const brief = buildBrief(deal, {
          contacts: (await provider.listContacts()).filter((c) => c.dealIds.includes(deal.id)),
          tasks: tasks.filter((t) => t.dealId === deal.id),
        })
        await notify({
          type: 'review-item',
          title: brief.title,
          // The whole brief in the body: it is read in an airport, and a link needs
          // signal, a login and a working screen.
          body: brief.text,
          link: `/deals/${deal.id}?tab=logistics`,
          roles: ['owner', 'ops'],
        })
        await provider.createTask({
          dealId: deal.id,
          title,
          assignee: null,
          dueDate: today,
          source: 'timer',
          stage: deal.stage,
          done: true,
          createdAt: new Date().toISOString(),
        })
        report.briefsSent += 1
      }
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
