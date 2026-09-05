import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const user = await requireUser()
    return ok({ notifications: await db().listNotifications(user.email, 30) })
  } catch (err) {
    return fail(err)
  }
}

const markReadSchema = z.object({ ids: z.array(z.string()).default([]) })

export async function POST(request: Request) {
  try {
    const user = await requireUser()
    const { ids } = markReadSchema.parse(await request.json())
    // An empty list means "everything of mine" — the mark-all-read case.
    await db().markNotificationsRead(user.email, ids)
    return ok({ ok: true })
  } catch (err) {
    return fail(err)
  }
}
