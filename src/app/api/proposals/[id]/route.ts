import { z } from 'zod'
import { ForbiddenError, requireUser } from '@/lib/auth'
import { canApproveSends } from '@/lib/rbac'
import { acceptProposal, dismissProposal } from '@/workers/f4-change-handler'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

const actionSchema = z.object({ action: z.enum(['accept', 'dismiss']) })

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireUser()
    if (!canApproveSends(user.role)) {
      throw new ForbiddenError('Your role cannot resolve field changes.')
    }

    const { action } = actionSchema.parse(await request.json())
    if (action === 'accept') await acceptProposal(id, user.email)
    else await dismissProposal(id, user.email)

    return ok({ ok: true })
  } catch (err) {
    return fail(err)
  }
}
