import { WORKERS } from '@/workers'
import { notifyWorkerFailure } from '@/lib/notify'
import { classifyFailure, explain, shouldReport, statusFor } from '@/lib/backend-health'
import { requestSummary, requestsSoFar } from '@/lib/airtable/cache'
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
    const requestsBefore = requestsSoFar()
    const result = await worker.run()

    // The cost of the run, in the logs, every run. A worker that suddenly costs ten
    // times what it did last week is then visible the same day rather than at the end
    // of the month on a billing page.
    const summary = requestSummary(name, requestsBefore)
    console.info(`[cron] ${summary}`)

    return ok({
      worker: name,
      ok: true,
      durationMs: Date.now() - startedAt,
      airtableRequests: requestsSoFar() - requestsBefore,
      result,
    })
  } catch (err) {
    // Never silent, but not ninety-six times for one cause. A backend that is briefly
    // unavailable is logged; one that needs a person is emailed once every six hours;
    // a worker that actually threw is emailed every time, as before.
    const kind = classifyFailure(err)
    console.error(`[cron] ${explain(kind, name)}`, err)

    if (shouldReport(name, kind)) {
      await notifyWorkerFailure({
        worker: name,
        error: err,
        logTail: explain(kind, name),
      }).catch(() => undefined)
    }

    if (kind === 'bug') return fail(err)
    // 503 rather than a thrown error, so Vercel's cron view shows it and retries later.
    return ok(
      { worker: name, ok: false, kind, message: explain(kind, name) },
      { status: statusFor(kind) },
    )
  }
}

export const POST = GET
