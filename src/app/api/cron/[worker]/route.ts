import { WORKERS } from '@/workers'
import { notifyWorkerFailure } from '@/lib/notify'
import { assertCronAuth, fail, ok } from '@/lib/http'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * The scheduled entry point. Vercel Cron (or a GitHub Actions cron as the free backup)
 * hits these with the CRON_SECRET; the same functions are runnable from the CLI, so
 * "it works on the schedule" and "it works when I run it" are the same claim.
 */
export async function GET(request: Request, { params }: { params: Promise<{ worker: string }> }) {
  const { worker: name } = await params
  try {
    assertCronAuth(request)
    const worker = WORKERS[name]
    if (!worker) return ok({ error: `Unknown worker "${name}".` }, { status: 404 })

    const startedAt = Date.now()
    const result = await worker.run()
    return ok({ worker: name, ok: true, durationMs: Date.now() - startedAt, result })
  } catch (err) {
    // Never silent: a scheduled failure emails an admin with the worker name and the tail.
    await notifyWorkerFailure({ worker: name, error: err }).catch(() => undefined)
    return fail(err)
  }
}

export const POST = GET
