import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { checkCapacity } from '@/lib/capacity'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * The load around a date — on demand, never on page load.
 *
 * Answering this means reading every deal, which on a per-request billing plan is the
 * single most expensive question in the product. It is asked once, by a person, at the
 * moment they are deciding whether to grant a hold — not nine requests every time
 * somebody opens a deal.
 */
export async function GET(request: Request) {
  try {
    await requireUser()
    const url = new URL(request.url)
    const date = url.searchParams.get('date')
    if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) {
      return ok({ error: 'A date is required, as YYYY-MM-DD.' }, { status: 400 })
    }

    const check = checkCapacity(
      date,
      await db().listDeals(),
      url.searchParams.get('dealId') ?? undefined,
    )
    return ok({
      verdict: check.verdict,
      atCap: check.atCap,
      week: check.week.map((d) => ({
        id: d.id,
        name: d.client?.name ?? d.name,
        eventDate: d.eventDate,
        adjacent: check.adjacent.some((a) => a.id === d.id),
      })),
    })
  } catch (err) {
    return fail(err)
  }
}
