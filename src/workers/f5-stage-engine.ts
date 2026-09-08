/**
 * F5 — STAGE ENGINE.
 *
 * Trigger: a deal's Stage changes. Action: fire that stage's packet — create Tasks,
 * request Drafts, arm timers, refresh the mirror. Pure automation, no AI of its own
 * (the drafts it requests are where models come in).
 *
 * The packet is declarative data in `lib/stages.ts`; this file is only the mechanism.
 */

import { db } from '@/lib/data'
import { checkCapacity } from '@/lib/capacity'
import { isHold, packetFor, STAGE_PACKETS, guardStage } from '@/lib/stages'
import { detectConflicts, existingFor } from '@/lib/conflicts'
import { SESSIONS_PER_TRACK, isCoaching, plannedSessions } from '@/lib/coaching'
import { notify } from '@/lib/notify'
import { agentActor, recordEvent } from '@/lib/audit'
import { composeDraft } from './f7-drafts'
import { pushMirror } from './f9-mirror'
import type { Deal, StageKey, Task } from '@/lib/types'
import { stageByKey } from '~/speaker.config'

const WORKER = 'F5'

export interface PacketResult {
  stage: StageKey
  tasksCreated: Task[]
  draftsRequested: string[]
  blocked: string | null
}

export class StageBlocked extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'StageBlocked'
  }
}

/**
 * Called after the stage field has been written. Idempotent on tasks: re-firing a
 * packet does not duplicate a task that is already open with the same title.
 */
export async function firePacket(deal: Deal, opts: { source?: string } = {}): Promise<PacketResult> {
  const provider = db()
  // Lane matters: on a bureau deal the agent owns the client relationship, so nothing
  // addressed past them is drafted at all (Gap Analysis §1, "automation stops at agent").
  const packet = packetFor(deal.stage, deal.source)
  const mirror = STAGE_PACKETS[deal.stage].mirror
  const existing = await provider.listTasks({ dealId: deal.id })
  const openTitles = new Set(existing.filter((t) => !t.done).map((t) => t.title.toLowerCase()))

  const tasksCreated: Task[] = []
  for (const spec of packet.tasks) {
    if (openTitles.has(spec.title.toLowerCase())) continue
    tasksCreated.push(
      await provider.createTask({
        dealId: deal.id,
        title: spec.title,
        assignee: assigneeEmail(spec.assignee),
        dueDate: dueDate(spec, deal),
        source: 'stage-packet',
        stage: deal.stage,
        done: false,
        createdAt: new Date().toISOString(),
      }),
    )
  }

  const draftsRequested: string[] = []
  for (const spec of packet.drafts) {
    const alreadySent = (await provider.listDrafts({ dealId: deal.id })).some(
      (d) => d.type === spec.type && d.status !== 'dismissed',
    )
    if (alreadySent) continue
    try {
      const draft = await composeDraft({
        deal,
        type: spec.type,
        templateKey: spec.templateKey,
        autoSend: spec.autoSend,
      })
      draftsRequested.push(draft.id)
    } catch (err) {
      // A draft that cannot be written must not stop the rest of the packet.
      console.error(`[F5] draft ${spec.templateKey} failed`, err)
    }
  }

  for (const surface of mirror) {
    await pushMirror(surface, deal)
  }

  // A coaching deal is three sessions, not an event. The ledger opens when the deal is
  // won, unscheduled, because nobody has agreed times yet — and an empty date is what
  // makes the ledger chase rather than look arranged.
  if (deal.stage === 'closed-won' && isCoaching(deal.dealType)) {
    try {
      const existing = await provider.listCoachingSessions(deal.id)
      if (existing.length === 0) {
        for (const session of plannedSessions(deal)) {
          await provider.createCoachingSession(session)
        }
        await recordEvent({
          table: 'deals',
          recordId: deal.id,
          what: 'Coaching ledger opened',
          detail: `${SESSIONS_PER_TRACK} sessions, unscheduled`,
          actor: agentActor(WORKER),
          reversible: true,
        })
      }
    } catch (err) {
      // A ledger that cannot be opened must not undo a stage change that happened.
      console.error(`[${WORKER}] could not open the coaching ledger for ${deal.name}`, err)
    }
  }

  // WP1.3 — a hold that has just become a firm offer is exactly the moment a competing
  // hold has to be told. Waiting for the nightly sweep would give the first client a day
  // less than the twenty-four hours they are owed.
  if (isHold(deal.stage)) {
    try {
      await raiseConflicts(deal, opts.source ?? null)
    } catch (err) {
      // A conflict that cannot be raised must not undo a stage change that has happened.
      console.error(`[${WORKER}] conflict check failed for ${deal.name}`, err)
    }
  }

  await recordEvent({
    table: 'deals',
    recordId: deal.id,
    what: 'Stage packet fired',
    detail: `${stageByKey.get(deal.stage)?.label}: ${tasksCreated.length} task(s), ${draftsRequested.length} draft(s)`,
    actor: agentActor(WORKER),
    source: opts.source ?? null,
  })

  return { stage: deal.stage, tasksCreated, draftsRequested, blocked: null }
}

/**
 * The full transition: guard → write → packet. API routes call this rather than
 * writing the stage field directly, so the contract gate can never be bypassed.
 */
export async function changeStage(params: {
  deal: Deal
  to: StageKey
  actor: { kind: 'human'; email: string } | { kind: 'agent'; worker: string }
}): Promise<{ deal: Deal; packet: PacketResult }> {
  const blocked = guardStage(params.deal, params.to)
  if (blocked) throw new StageBlocked(blocked)

  const provider = db()
  const from = params.deal.stage
  const updated = await provider.updateDeal(params.deal.id, { stage: params.to })

  await provider.appendAudit({
    entity: 'deals',
    entityId: params.deal.id,
    field: 'Stage',
    oldValue: stageByKey.get(from)?.label ?? from,
    newValue: stageByKey.get(params.to)?.label ?? params.to,
    actor: params.actor.kind === 'human' ? params.actor.email : `agent:${params.actor.worker}`,
    actorKind: params.actor.kind,
    source: null,
    batchId: null,
    at: new Date().toISOString(),
    reversible: true,
  })

  const packet = await firePacket(updated, { source: `stage:${from}→${params.to}` })

  // The capacity check, at Qualify — the moment a hold is granted, which is what the
  // rule is about. It advises and never refuses: the run plan has no capacity guards, and
  // a fourth booking in a week is sometimes three short sessions in one city.
  if (params.to === 'qualified' && updated.eventDate && updated.dealType === 'keynote') {
    try {
      const check = checkCapacity(updated.eventDate, await provider.listDeals(), updated.id)
      if (check.atCap || check.adjacent.length > 0) {
        await notify({
          type: 'review-item',
          title: `Load check — ${updated.client?.name ?? updated.name}`,
          body: `${check.verdict}\n\nThe hold is placed either way. This is for Ben to weigh.`,
          link: `/deals/${updated.id}?tab=sales`,
          roles: ['ops', 'owner'],
        })
      }
    } catch (err) {
      // A hold that is granted must not fail because the advisory could not be sent.
      console.error('[F5] capacity check failed', err)
    }
  }

  if (params.to === 'closed-won') {
    await notify({
      type: 'contract-signed',
      title: `Closed-Won — ${updated.name}`,
      body: 'Contract and deposit tasks are on the board.',
      link: `/deals/${updated.id}`,
      roles: ['ops', 'admin', 'owner'],
    })
  }

  return { deal: updated, packet }
}

function assigneeEmail(role: 'ops' | 'owner' | 'admin' | undefined): string | null {
  if (!role) return null
  const map: Record<string, string | undefined> = {
    ops: process.env.OPS_EMAIL,
    owner: process.env.OWNER_EMAIL,
    admin: process.env.ADMIN_EMAIL,
  }
  return map[role] ?? null
}

/**
 * When a packet task is due.
 *
 * Run Plan rule 4, verbatim: *"Every T-minus timer is 'at T-x, or immediately if T-x has
 * passed.' Last-minute deals never break; they compress."*
 *
 * So a T-21 task on a deal whose event is six days away is due **today**, not fifteen
 * days ago. The distinction matters to a person: a date in the past renders as "overdue
 * by 15 days" on a deal created this morning, which is both false and alarming. Nobody
 * was late; the deal simply arrived late.
 */
export /**
 * Raises a Date Conflict record for any live clash this deal is part of.
 *
 * Detects and flags. Nothing is released, nothing is reordered, and the 24-hour clock is
 * a display: Decisions Log §3 is explicit that two gigs in one day is sometimes doable,
 * so the system must never decide that a clash is a problem.
 */
async function raiseConflicts(deal: Deal, source: string | null): Promise<void> {
  const provider = db()
  const today = new Date().toISOString().slice(0, 10)
  const [deals, existing] = await Promise.all([
    provider.listDeals(),
    provider.listDateConflicts(),
  ])

  for (const clash of detectConflicts(deals, today)) {
    if (!clash.deals.some((d) => d.id === deal.id)) continue
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

    await recordEvent({
      table: 'dateConflicts',
      recordId: created.id,
      what: 'Raised',
      detail: `${clash.label}; first hold is ${clash.firstHold.client?.name ?? clash.firstHold.name}`,
      actor: agentActor(WORKER),
      source,
    })

    await notify({
      type: 'red-alert',
      title: `Two deals on ${clash.date}`,
      body:
        `${clash.label}. First hold: ${clash.firstHold.client?.name ?? clash.firstHold.name}.` +
        (clash.challenged
          ? ' One side has a firm offer out, so the first hold has 24 hours to contract or release.'
          : ''),
      link: `/queue?conflict=${created.id}`,
      roles: ['ops', 'admin', 'owner'],
    })
  }
}

export function dueDate(
  spec: { dueInDays?: number; dueRelativeToEvent?: number },
  deal: Pick<Deal, 'eventDate'>,
  now: Date = new Date(),
): string | null {
  const today = now.toISOString().slice(0, 10)

  if (spec.dueRelativeToEvent !== undefined && deal.eventDate) {
    const base = new Date(`${deal.eventDate.slice(0, 10)}T00:00:00Z`).getTime()
    const due = new Date(base + spec.dueRelativeToEvent * 86_400_000).toISOString().slice(0, 10)
    return due < today ? today : due
  }
  if (spec.dueInDays !== undefined) {
    return new Date(now.getTime() + spec.dueInDays * 86_400_000).toISOString().slice(0, 10)
  }
  return null
}
