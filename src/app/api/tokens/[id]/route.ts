import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { agentActor, recordEvent } from '@/lib/audit'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * Revokes a token.
 *
 * A tick, not a delete: the row stays so an audit entry written months ago still resolves
 * to a person. And it takes effect on the next call, because the endpoint reads the token
 * table on every request rather than caching who is allowed in.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser()
    if (user.role !== 'admin') {
      return ok({ error: 'Only an admin can revoke an API token.' }, { status: 403 })
    }

    const { id } = await params
    const provider = db()
    const token = (await provider.listApiTokens()).find((t) => t.id === id)
    if (!token) return ok({ error: 'No such token.' }, { status: 404 })

    await provider.revokeApiToken(id)
    await recordEvent({
      table: 'users',
      recordId: id,
      what: 'MCP token revoked',
      detail: `${token.prefix}… for ${token.userEmail}, by ${user.email}`,
      actor: agentActor('WP3.4'),
      source: 'MCP',
    })
    return ok({ revoked: id })
  } catch (err) {
    return fail(err)
  }
}
