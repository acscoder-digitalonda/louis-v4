import { z } from 'zod'
import { ForbiddenError, requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canWrite } from '@/lib/rbac'
import { humanActor, recordChanges } from '@/lib/audit'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  email: z.string().email(),
  patch: z.object({
    role: z.enum(['owner', 'admin', 'ops', 'accountant']).optional(),
    active: z.boolean().optional(),
    showMoneyAmounts: z.boolean().optional(),
    landingPage: z.string().max(120).optional(),
    theme: z.enum(['light', 'dark', 'system']).optional(),
  }),
})

export async function GET() {
  try {
    const user = await requireUser()
    if (!canWrite(user.role, 'users').allowed) {
      throw new ForbiddenError('User management is admin-only.')
    }
    return ok({ users: await db().listUsers() })
  } catch (err) {
    return fail(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireUser()
    const decision = canWrite(user.role, 'users')
    if (!decision.allowed) throw new ForbiddenError(decision.reason ?? 'User management is admin-only.')

    const { email, patch } = patchSchema.parse(await request.json())
    const provider = db()
    const before = await provider.getUserByEmail(email)
    if (!before) return ok({ error: 'User not found.' }, { status: 404 })

    // Deactivating or demoting the last active admin would lock everyone out of Settings.
    if ((patch.role && patch.role !== 'admin') || patch.active === false) {
      const admins = (await provider.listUsers()).filter((u) => u.role === 'admin' && u.active)
      if (before.role === 'admin' && before.active && admins.length <= 1) {
        throw new ForbiddenError(
          'That is the last active admin. Promote someone else first — the allowlist is also editable directly in Airtable.',
        )
      }
    }

    const updated = await provider.upsertUser({ email, ...patch })
    await recordChanges({
      table: 'users',
      recordId: updated.id,
      before: before as unknown as Record<string, unknown>,
      after: patch,
      actor: humanActor(user.email),
    })
    return ok({ user: updated })
  } catch (err) {
    return fail(err)
  }
}
