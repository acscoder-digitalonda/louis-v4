import { z } from 'zod'
import { ForbiddenError, requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canWrite } from '@/lib/rbac'
import { recordChanges, humanActor } from '@/lib/audit'
import { invalidateSearchCache } from '@/lib/search'
import { changeStage } from '@/workers/f5-stage-engine'
import { fail, ok } from '@/lib/http'
import { ALL_STAGES } from '@/lib/stages'
import { buildBrief, shouldResend } from '@/lib/road-warrior'
import { notify } from '@/lib/notify'
import type { Deal, StageKey } from '@/lib/types'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  patch: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])),
  /** The value the client read. A stale write is rejected rather than merged. */
  lastModified: z.string().nullable().optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireUser()
    const { patch, lastModified } = patchSchema.parse(await request.json())

    const provider = db()
    const deal = await provider.getDeal(id)
    if (!deal) return ok({ error: 'Deal not found.' }, { status: 404 })

    // Every field is checked individually: the owner role may edit notes and stage,
    // and nobody may edit a money lookup.
    for (const field of Object.keys(patch)) {
      const decision = canWrite(user.role, 'deals', field)
      if (!decision.allowed) {
        throw new ForbiddenError(decision.reason ?? `You cannot edit ${field}.`)
      }
    }

    // Last-write-wins, but a client working from stale data is told so.
    if (lastModified && deal.lastModified && lastModified !== deal.lastModified) {
      return ok(
        {
          error: 'This record changed since you loaded it. Reload to see the current value.',
          stale: true,
        },
        { status: 409 },
      )
    }

    // Stage is not a field write — it is a transition, guarded and packet-firing.
    if ('stage' in patch) {
      const next = patch.stage
      if (typeof next !== 'string' || !ALL_STAGES.includes(next as StageKey)) {
        return ok({ error: `Unknown stage "${String(next)}".` }, { status: 400 })
      }
      const { deal: updated } = await changeStage({
        deal,
        to: next as StageKey,
        actor: { kind: 'human', email: user.email },
      })
      delete patch.stage
      if (Object.keys(patch).length === 0) {
        invalidateSearchCache()
        return ok({ deal: updated })
      }
    }

    const tasks = await provider.listTasks({ dealId: id })
    const updated = await provider.updateDeal(id, patch as Partial<Deal>)
    await recordChanges({
      table: 'deals',
      recordId: id,
      before: deal as unknown as Record<string, unknown>,
      after: patch,
      actor: humanActor(user.email),
    })
    invalidateSearchCache()

    // WP3.3 — a logistics change after the brief has gone out means Ben is carrying the
    // wrong hotel. Re-sent with an UPDATED header so the newest is obviously the newest.
    // Only the fields the brief prints trigger it: re-sending because somebody edited the
    // audience profile teaches him to stop opening it.
    if (shouldResend(Object.keys(patch) as (keyof Deal)[]) && briefAlreadySent(updated, tasks)) {
      try {
        const brief = buildBrief(updated, {
          contacts: (await provider.listContacts()).filter((c) => c.dealIds.includes(id)),
          tasks,
          updated: true,
        })
        await notify({
          type: 'review-item',
          title: brief.title,
          body: brief.text,
          link: `/deals/${id}?tab=logistics`,
          roles: ['owner', 'ops'],
        })
      } catch (err) {
        // A re-send that fails must not undo an edit that succeeded.
        console.error('[deals] road-warrior re-send failed', err)
      }
    }

    return ok({ deal: updated })
  } catch (err) {
    return fail(err)
  }
}

/** Only re-send a brief that has already gone out once. */
function briefAlreadySent(deal: Deal, tasks: { dealId: string | null; title: string }[]): boolean {
  return tasks.some(
    (t) => t.dealId === deal.id && t.title.toLowerCase().startsWith('road warrior brief'),
  )
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser()
    const { id } = await params
    const deal = await db().getDeal(id)
    if (!deal) return ok({ error: 'Deal not found.' }, { status: 404 })
    return ok({ deal })
  } catch (err) {
    return fail(err)
  }
}
