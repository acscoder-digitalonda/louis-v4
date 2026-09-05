import { z } from 'zod'
import { ForbiddenError, requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canWrite } from '@/lib/rbac'
import { agentActor, recordEvent } from '@/lib/audit'
import { invalidateSearchCache } from '@/lib/search'
import { firePacket } from '@/workers/f5-stage-engine'
import { fail, ok } from '@/lib/http'
import { speaker } from '~/speaker.config'

export const dynamic = 'force-dynamic'

const createSchema = z.object({
  name: z.string().min(1).max(200),
  clientId: z.string().optional(),
  eventDate: z.string().optional(),
  location: z.string().optional(),
})

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const decision = canWrite(user.role, 'deals')
    if (!decision.allowed) throw new ForbiddenError(decision.reason ?? 'You cannot create deals.')

    const input = createSchema.parse(await request.json())
    const provider = db()
    const client = input.clientId ? await provider.getClient(input.clientId) : null

    const deal = await provider.createDeal({
      name: input.name,
      stage: 'inquiry',
      client: client ? { id: client.id, name: client.name } : null,
      eventDate: input.eventDate ?? null,
      location: input.location ?? null,
      listFee: speaker.fees.defaultList,
      owner: user.email,
    })

    await recordEvent({
      table: 'deals',
      recordId: deal.id,
      what: 'Created',
      detail: `by ${user.email}`,
      actor: agentActor('app'),
      source: 'manual',
    })
    await firePacket(deal, { source: 'manual' })
    invalidateSearchCache()

    return ok({ deal }, { status: 201 })
  } catch (err) {
    return fail(err)
  }
}
