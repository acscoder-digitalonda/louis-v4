import { z } from 'zod'
import { ForbiddenError, requireUser } from '@/lib/auth'
import { canApproveSends } from '@/lib/rbac'
import { acceptAndMerge, acceptMany, dismissDealProposal } from '@/workers/c5-accept'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * C5's endpoint. Bulk by design — the reconciliation session moves ~99 rows, and a
 * request per row would make the table feel broken.
 */
const actionSchema = z.object({
  action: z.enum(['accept', 'dismiss', 'merge']),
  // Order matters for merge: the first id is the proposal whose values win.
  ids: z.array(z.string()).min(1).max(200),
})

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    if (!canApproveSends(user.role)) {
      throw new ForbiddenError('Your role cannot accept seeded deals.')
    }

    const { action, ids } = actionSchema.parse(await request.json())

    if (action === 'accept') {
      const result = await acceptMany(ids, user.email)
      return ok(result)
    }

    if (action === 'merge') {
      if (ids.length < 2) {
        return ok({ accepted: [], failed: [{ id: ids[0] ?? '', error: 'Merging needs two or more rows.' }] })
      }
      const { deal, merged, failed } = await acceptAndMerge(ids, user.email)
      return ok({ accepted: [ids[0]!, ...merged], failed, dealId: deal.id })
    }

    const failed: { id: string; error: string }[] = []
    const dismissed: string[] = []
    for (const id of ids) {
      try {
        await dismissDealProposal(id, user.email)
        dismissed.push(id)
      } catch (err) {
        failed.push({ id, error: err instanceof Error ? err.message : String(err) })
      }
    }
    return ok({ accepted: dismissed, failed })
  } catch (err) {
    return fail(err)
  }
}
