import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { humanActor, recordChanges } from '@/lib/audit'
import { canWrite } from '@/lib/rbac'
import { loadTemplate } from '@/lib/templates'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * Saves a template edit (WP2.3).
 *
 * Copy is data, so this writes to the Templates table and the next draft picks it up —
 * no deploy, no developer. That only became true today: `loadTemplates` did not exist
 * until now, so the table was seeded and never read.
 *
 * The voice checker runs on the client as advice. It is deliberately not enforced here:
 * a checker that refuses to save teaches people to route around it, and the drafts it
 * would block are the ones somebody needed to send five minutes ago.
 */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser()
    const decision = canWrite(user.role, 'templates')
    if (!decision.allowed) return ok({ error: decision.reason }, { status: 403 })

    const body = (await request.json()) as { key?: string; subject?: string; body?: string }
    const key = body.key?.trim()
    if (!key) return ok({ error: 'Which template?' }, { status: 400 })

    const before = await loadTemplate(key)
    if (!before) return ok({ error: `No template "${key}".` }, { status: 404 })

    const patch = {
      subject: body.subject?.trim() || before.subject,
      body: body.body ?? before.body,
    }
    const after = await db().upsertTemplate(key, patch)

    await recordChanges({
      table: 'templates',
      recordId: key,
      before: { subject: before.subject, body: before.body },
      after: patch,
      actor: humanActor(user.email),
      source: 'Settings → Templates',
    })

    return ok({ template: after })
  } catch (err) {
    return fail(err)
  }
}
