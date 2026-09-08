/**
 * Telling a broken worker apart from a backend that is briefly unavailable.
 *
 * The rule in the spec is "never silent: a scheduled failure emails an admin", and it is
 * a good rule that has one bad case. When the *backend* is unavailable, every scheduled
 * worker fails for the same reason at the same time, and the intake worker runs every
 * fifteen minutes — so one Airtable problem becomes ninety-six identical emails a day
 * saying something the admin learned from the first one.
 *
 * So failures are sorted into three kinds:
 *
 *   **transient** — a rate limit, a 5xx, a dropped connection. Airtable self-heals within
 *   seconds or minutes and the next run succeeds. Logged, not emailed: there is nothing
 *   for a person to do, and the app itself is fine by the time they read it.
 *
 *   **needs-a-person** — the monthly quota is spent, the key is revoked, the base is
 *   gone. Nothing self-heals, so it emails — but once per window, not once per run.
 *
 *   **a bug** — anything else. Emails every time, as before. A worker that throws a
 *   TypeError is exactly the thing that rule exists for.
 */

export type FailureKind = 'transient' | 'needs-a-person' | 'bug'

interface Httpish {
  status?: number
  body?: string
  message?: string
  code?: string
}

function shapeOf(error: unknown): Httpish {
  if (typeof error !== 'object' || error === null) return { message: String(error) }
  const e = error as Httpish
  return { status: e.status, body: e.body ?? '', message: e.message ?? '', code: e.code }
}

/** Network-level failures, which say nothing about our code. */
const NETWORK_CODES = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT']

export function classifyFailure(error: unknown): FailureKind {
  const { status, body, message, code } = shapeOf(error)
  const text = `${body} ${message}`

  // A spent monthly quota is a 429, but it does not clear on its own and it stops reads
  // as well as writes — the app is down until somebody upgrades or the month turns.
  if (/BILLING_LIMIT|QUOTA|payment required|plan limit/i.test(text)) return 'needs-a-person'

  // Credentials and configuration: a person has to fix these, and quickly.
  if (status === 401 || status === 403 || status === 404) return 'needs-a-person'
  if (/AUTHENTICATION_REQUIRED|INVALID_API_KEY|NOT_FOUND/i.test(text)) return 'needs-a-person'

  if (status === 429 || status === 408) return 'transient'
  if (typeof status === 'number' && status >= 500) return 'transient'
  if (code && NETWORK_CODES.includes(code)) return 'transient'
  if (/fetch failed|socket hang up|network|timeout/i.test(message ?? '')) return 'transient'

  return 'bug'
}

/**
 * How long to stay quiet about a condition already reported.
 *
 * Six hours: long enough that a quota problem produces four emails a day rather than
 * ninety-six, short enough that nobody can forget about it for a working week.
 */
export const QUIET_HOURS = 6

const lastReported = new Map<string, number>()

/**
 * Whether to email about this failure now.
 *
 * The memory is per process, which on serverless means per warm instance — so this
 * dampens the flood without ever suppressing the *first* report, which is the one that
 * carries the information. A guarantee of exactly-once would need shared state in the
 * very backend that is failing, and a notifier that depends on the thing it reports on is
 * a notifier that goes quiet exactly when it matters.
 */
export function shouldReport(
  worker: string,
  kind: FailureKind,
  now: number = Date.now(),
): boolean {
  if (kind === 'transient') return false

  // A bug used to report every time. A worker that throws on a fifteen-minute schedule
  // is then ninety-six identical emails a day, and the ninety-sixth carries no more
  // information than the first — it just makes the first harder to find. Repeats are
  // damped the same way as everything else; the first one still goes immediately.
  const key = `${worker}:${kind}`
  const last = lastReported.get(key)
  if (last !== undefined && now - last < QUIET_HOURS * 3_600_000) return false
  lastReported.set(key, now)
  return true
}

/** Test seam. */
export function resetReportMemory(): void {
  lastReported.clear()
}

/** What the cron endpoint returns, so Vercel's own monitoring shows the right colour. */
export function statusFor(kind: FailureKind): number {
  // 503 says "try again later" for the two backend cases; a bug is our fault, so 500.
  return kind === 'bug' ? 500 : 503
}

export function explain(kind: FailureKind, worker: string): string {
  switch (kind) {
    case 'transient':
      return `${worker}: the backend was briefly unavailable. The next scheduled run should succeed.`
    case 'needs-a-person':
      return `${worker}: the backend is refusing every request and will not recover on its own. Check the Airtable plan, the API key, and the base id.`
    case 'bug':
      return `${worker} failed.`
  }
}
