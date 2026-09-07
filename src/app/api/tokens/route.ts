import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { agentActor, recordEvent } from '@/lib/audit'
import { issueToken, roleAllowed } from '@/lib/mcp/tokens'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * Issues an MCP token (WP3.4, surfaced by WP2.3).
 *
 * Admin-only twice over: the caller must be an admin, and so must the person the token is
 * for. The second check is not redundant — a token for an ops account would authenticate
 * happily and then be refused by every tool, which is a confusing hour for whoever holds
 * it.
 *
 * The token is returned exactly once, in this response. Only its hash is stored.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser()
    if (user.role !== 'admin') {
      return ok({ error: 'Only an admin can issue an API token.' }, { status: 403 })
    }

    const body = (await request.json()) as { userEmail?: string; label?: string }
    const email = body.userEmail?.trim().toLowerCase()
    if (!email) return ok({ error: 'Who is the token for?' }, { status: 400 })

    const provider = db()
    const owner = (await provider.listUsers()).find((u) => u.email.toLowerCase() === email)
    if (!owner) return ok({ error: `No account for ${email}.` }, { status: 404 })
    if (!roleAllowed(owner.role)) {
      return ok(
        {
          error: `${owner.email} is ${owner.role}. The MCP endpoint is admin-only, so this token would be refused on every call.`,
        },
        { status: 400 },
      )
    }

    const { token, hash, prefix } = issueToken()
    const created = await provider.createApiToken({
      label: body.label?.trim() || `${owner.name} · MCP`,
      tokenHash: hash,
      prefix,
      userEmail: owner.email,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      expiresAt: null,
      revoked: false,
    })

    // The prefix, never the token. An audit log that carried the credential would put it
    // in every nightly backup.
    await recordEvent({
      table: 'users',
      recordId: owner.id,
      what: 'MCP token issued',
      detail: `${prefix}… for ${owner.email}, by ${user.email}`,
      actor: agentActor('WP3.4'),
      source: 'MCP',
    })

    return ok({ token, id: created.id, prefix })
  } catch (err) {
    return fail(err)
  }
}
