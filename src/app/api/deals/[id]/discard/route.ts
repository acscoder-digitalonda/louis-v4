import { ForbiddenError, requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canDiscard } from '@/lib/rbac'
import { humanActor, recordEvent } from '@/lib/audit'
import { invalidateSearchCache } from '@/lib/search'
import { changeStage } from '@/workers/f5-stage-engine'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * Discard: this was never a deal.
 *
 * Deals are closed, not deleted — the audit log is append-only, the twelve-month
 * re-engagement segments on the closed-lost reason, and the history is the history. But
 * a spam form submission or a marketing reply mis-filed as an inquiry is not a lost deal,
 * and closing it as one would re-engage it in a year.
 *
 * So `junk` is a closed-lost reason with different consequences: closed, dropped from the
 * board and every sweep, never re-engaged, and reversible by changing the stage back.
 * Nothing is deleted.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireUser()
    if (!canDiscard(user.role)) throw new ForbiddenError('Only the office can discard a deal.')

    const provider = db()
    const deal = await provider.getDeal(id)
    if (!deal) return ok({ error: 'Deal not found.' }, { status: 404 })
    if (deal.closedLostReason === 'junk') return ok({ deal })

    // The reason first: the Closed Lost guard reads it off the record, not the request.
    const marked = await provider.updateDeal(id, { closedLostReason: 'junk' })
    const { deal: closed, packet } =
      marked.stage === 'closed-lost'
        ? { deal: marked, packet: null }
        : await changeStage({ deal: marked, to: 'closed-lost', actor: { kind: 'human', email: user.email } })

    // The Closed Lost packet asks somebody to record why it was lost. For junk the reason
    // is the discard itself, so the task closes with a note rather than sitting open.
    for (const task of packet?.tasksCreated ?? []) {
      await provider.updateTask(task.id, { done: true }).catch(() => undefined)
    }

    await recordEvent({
      table: 'deals',
      recordId: id,
      what: 'Discarded',
      detail: 'Marked junk by the office: not a deal. Change the stage to bring it back.',
      actor: humanActor(user.email),
      reversible: true,
    })
    invalidateSearchCache()
    return ok({ deal: closed })
  } catch (err) {
    return fail(err)
  }
}
