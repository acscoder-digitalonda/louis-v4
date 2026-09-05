import { requireUser } from '@/lib/auth'
import { search } from '@/lib/search'
import { fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    await requireUser()
    const q = new URL(request.url).searchParams.get('q') ?? ''
    return ok({ results: await search(q) })
  } catch (err) {
    return fail(err)
  }
}
