import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { humanActor, recordChanges } from '@/lib/audit'
import { canWrite } from '@/lib/rbac'
import { ledger, templateAfter } from '@/lib/coaching'
import { composeDraft } from '@/workers/f7-drafts'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * Schedules a coaching session, or marks one held.
 *
 * Marking a session held is the trigger for the follow-up, and for "sell the next track"
 * once it is the third. Drafted, never sent: the same rule as everything else that
 * reaches a client.
 */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser()
    const decision = canWrite(user.role, 'coachingSessions')
    if (!decision.allowed) return ok({ error: decision.reason }, { status: 403 })

    const body = (await request.json()) as {
      id?: string
      scheduledFor?: string | null
      held?: boolean
      notes?: string | null
    }
    if (!body.id) return ok({ error: 'Which session?' }, { status: 400 })

    const provider = db()
    const before = (await provider.listCoachingSessions()).find((s) => s.id === body.id)
    if (!before) return ok({ error: 'No such session.' }, { status: 404 })

    const patch = {
      ...(body.scheduledFor !== undefined ? { scheduledFor: body.scheduledFor } : {}),
      ...(body.held !== undefined ? { held: body.held } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    }
    const after = await provider.updateCoachingSession(body.id, patch)

    await recordChanges({
      table: 'coachingSessions',
      recordId: body.id,
      before: { scheduledFor: before.scheduledFor, held: before.held },
      after: patch,
      actor: humanActor(user.email),
      source: 'Deal → Coaching',
    })

    // A session that has just been marked held is the moment the follow-up is worth
    // writing, while what happened is still in someone's head.
    const justHeld = body.held === true && !before.held
    if (justHeld && before.dealId) {
      const deal = await provider.getDeal(before.dealId)
      const state = ledger(await provider.listCoachingSessions(before.dealId), new Date().toISOString().slice(0, 10))
      const template = templateAfter(state)
      if (deal && template) {
        await composeDraft({
          deal,
          type: state.sellNextTrack ? 'proposal' : 'follow-up',
          templateKey: template,
        }).catch((err) => console.error('[coaching] follow-up draft failed', err))
      }
    }

    return ok({ session: after })
  } catch (err) {
    return fail(err)
  }
}
