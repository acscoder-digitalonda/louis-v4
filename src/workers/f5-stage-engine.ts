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
import { STAGE_PACKETS, guardStage } from '@/lib/stages'
import { agentActor, recordEvent } from '@/lib/audit'
import { notify } from '@/lib/notify'
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
  const packet = STAGE_PACKETS[deal.stage]
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

  for (const surface of packet.mirror) {
    await pushMirror(surface, deal)
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

function dueDate(
  spec: { dueInDays?: number; dueRelativeToEvent?: number },
  deal: Deal,
): string | null {
  if (spec.dueRelativeToEvent !== undefined && deal.eventDate) {
    const base = new Date(deal.eventDate).getTime()
    return new Date(base + spec.dueRelativeToEvent * 86_400_000).toISOString().slice(0, 10)
  }
  if (spec.dueInDays !== undefined) {
    return new Date(Date.now() + spec.dueInDays * 86_400_000).toISOString().slice(0, 10)
  }
  return null
}
