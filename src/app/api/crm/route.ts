import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * One page of the CRM, searched in Airtable.
 *
 * Three views over two tables, and which table is read depends on the view — a search for
 * a bureau agent must not also read 660 companies to answer.
 */
export async function GET(request: Request) {
  try {
    await requireUser()
    const url = new URL(request.url)
    const view = url.searchParams.get('view') ?? 'bureau'
    const q = url.searchParams.get('q') ?? undefined
    const cursor = url.searchParams.get('cursor') ?? undefined
    const pageSize = Math.min(Number(url.searchParams.get('pageSize')) || 40, 100)

    if (view === 'clients') {
      return ok(await db().listClientsPage({ q, cursor, pageSize }))
    }
    return ok(
      await db().listContactsPage({
        q,
        cursor,
        pageSize,
        bureauOnly: view === 'bureau',
        directOnly: view === 'direct',
      }),
    )
  } catch (err) {
    return fail(err)
  }
}
