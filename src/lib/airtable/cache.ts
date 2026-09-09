/**
 * A read cache for the Airtable REST layer.
 *
 * Airtable bills per **request**, and this app reads whole tables: a page that shows the
 * CRM pulls 660 companies, 1,348 contacts and 802 deals, which is thirty requests at a
 * hundred records each. Two people clicking around for a day comes to roughly forty
 * thousand requests a month before a single worker runs — which is the upper end of the
 * whole plan's allowance, spent on showing people data they already had on screen a
 * minute ago.
 *
 * So: one cache, at the one place every read passes through.
 *
 * ── What it is honest about ────────────────────────────────────────────────
 *
 * The cache lives in one server process. On serverless that means one warm instance, and
 * a write on instance A does not clear instance B. Two things keep that from mattering:
 * the TTL is short enough that a stale read is measured in seconds, and every write
 * invalidates its table locally — so **you always see your own writes**, which is the
 * case people actually notice. Somebody else's write showing up a few seconds late is
 * the same behaviour Airtable's own interface has.
 *
 * Where seconds are too long, `fresh()` bypasses it. That is for a decision, not a
 * display: accepting a proposal reads the proposal fresh, because acting twice on one
 * row is worse than a slow page.
 */

import type { TableKey } from './schema'

interface Entry {
  at: number
  value: unknown
}

/**
 * Short on purpose.
 *
 * Long enough that a page render, a navigation and a double-click all share one fetch;
 * short enough that nobody watches a stale number long enough to distrust it. Tunable
 * because the right answer depends on how many people are clicking, not on anything in
 * the code.
 */
export const DEFAULT_TTL_MS = Number(process.env.AIRTABLE_CACHE_MS ?? 45_000)

/** `AIRTABLE_CACHE=off` turns it off entirely, for debugging a staleness complaint. */
export function cacheEnabled(): boolean {
  return process.env.AIRTABLE_CACHE !== 'off'
}

// Survives a hot reload in dev, which otherwise makes the cache look broken.
const GLOBAL_KEY = Symbol.for('louis.airtable.cache')

interface Slot {
  entries: Map<string, Entry>
  hits: number
  misses: number
  /** Requests saved, for the usage meter. A cached whole-table read saves several. */
  requestsSaved: number
}

function slot(): Slot {
  const g = globalThis as unknown as Record<symbol, Slot | undefined>
  g[GLOBAL_KEY] ??= { entries: new Map(), hits: 0, misses: 0, requestsSaved: 0 }
  return g[GLOBAL_KEY]!
}

export function cacheKey(table: TableKey, opts: unknown): string {
  // Stable regardless of key order: two callers asking the same question with the object
  // literal written differently must share one entry.
  return `${table}:${JSON.stringify(opts, Object.keys(opts as object).sort())}`
}

/**
 * Reads through the cache.
 *
 * `estimatedRequests` is what the underlying call would have cost, so the saving can be
 * reported rather than assumed. A whole-table read of 802 records is nine requests, and
 * counting it as one would make the meter flatter and less useful than the truth.
 */
export async function readThrough<T>(
  table: TableKey,
  opts: unknown,
  estimatedRequests: number,
  load: () => Promise<T>,
  now: number = Date.now(),
): Promise<T> {
  if (!cacheEnabled()) return load()

  const s = slot()
  const key = cacheKey(table, opts)
  const hit = s.entries.get(key)

  if (hit && now - hit.at < DEFAULT_TTL_MS && !(await recentlyWrote(now))) {
    s.hits += 1
    s.requestsSaved += estimatedRequests
    return hit.value as T
  }

  s.misses += 1
  const value = await load()
  s.entries.set(key, { at: now, value })
  return value
}

/**
 * Did this browser write something within the cache's lifetime?
 *
 * The middleware stamps a cookie on every write through /api. Inside a request this
 * reads it; outside one — a worker on the CLI, a test — `next/headers` throws, and the
 * answer is no. The point is to make a person's own writes visible to their own next
 * read whichever instance serves it; other people, and the workers, keep the cache.
 */
/** Test seam: the cookie cannot be set from a test, so the answer can be. */
let wroteProbe: ((now: number) => Promise<boolean>) | null = null
export function setRecentWriteProbe(fn: ((now: number) => Promise<boolean>) | null): void {
  wroteProbe = fn
}

async function recentlyWrote(now: number): Promise<boolean> {
  if (wroteProbe) return wroteProbe(now)
  try {
    const { cookies } = await import('next/headers')
    const stamp = (await cookies()).get('louis-fresh')?.value
    return Boolean(stamp) && now - Number(stamp) < DEFAULT_TTL_MS
  } catch {
    return false
  }
}

/**
 * Drops every cached read of a table.
 *
 * Called by every write. Coarse on purpose: working out which cached queries a new record
 * would have appeared in means re-implementing `filterByFormula`, and getting that subtly
 * wrong shows someone a list their own new row is missing from.
 */
export function invalidate(table: TableKey): void {
  const s = slot()
  const prefix = `${table}:`
  for (const key of s.entries.keys()) {
    if (key.startsWith(prefix)) s.entries.delete(key)
  }
}

export function invalidateAll(): void {
  slot().entries.clear()
}

export interface CacheStats {
  entries: number
  hits: number
  misses: number
  hitRate: number
  requestsSaved: number
  ttlMs: number
  enabled: boolean
}

export function cacheStats(): CacheStats {
  const s = slot()
  const total = s.hits + s.misses
  return {
    entries: s.entries.size,
    hits: s.hits,
    misses: s.misses,
    hitRate: total === 0 ? 0 : Math.round((s.hits / total) * 100) / 100,
    requestsSaved: s.requestsSaved,
    ttlMs: DEFAULT_TTL_MS,
    enabled: cacheEnabled(),
  }
}

/** Test seam. */
export function resetCache(): void {
  const g = globalThis as unknown as Record<symbol, Slot | undefined>
  g[GLOBAL_KEY] = { entries: new Map(), hits: 0, misses: 0, requestsSaved: 0 }
}

// ── The request counter ─────────────────────────────────────────────────────
//
// Airtable bills per request and its own usage page is the authority, but that page is
// a month-to-date total with no breakdown — it cannot tell you *which* table or *which*
// worker is spending it. This counts every call at the one place they all pass through,
// so the answer to "what is eating the plan" is a number rather than a theory.
//
// Honest about its limit: the count is per process. On serverless that is one warm
// instance, so it is a rate and a shape, not a bill. Workers log their tally at the end
// of each run, which is where the shape actually becomes useful — a run that suddenly
// costs ten times what it did last week is visible in the logs the same day.

export type RequestKind = 'read' | 'write' | 'meta'

interface Counter {
  total: number
  byTable: Map<string, number>
  byKind: Map<RequestKind, number>
  startedAt: number
}

const COUNTER_KEY = Symbol.for('louis.airtable.requests')

function counter(): Counter {
  const g = globalThis as unknown as Record<symbol, Counter | undefined>
  g[COUNTER_KEY] ??= { total: 0, byTable: new Map(), byKind: new Map(), startedAt: Date.now() }
  return g[COUNTER_KEY]!
}

export function countRequest(table: string, kind: RequestKind): void {
  const c = counter()
  c.total += 1
  c.byTable.set(table, (c.byTable.get(table) ?? 0) + 1)
  c.byKind.set(kind, (c.byKind.get(kind) ?? 0) + 1)
}

export interface RequestStats {
  total: number
  reads: number
  writes: number
  meta: number
  byTable: Record<string, number>
  /** Whole minutes this process has been counting, so a rate can be read off it. */
  minutes: number
  perHour: number
  /** What the cache stopped us from spending. */
  savedByCache: number
}

export function requestStats(now = Date.now()): RequestStats {
  const c = counter()
  const minutes = Math.max(1, Math.round((now - c.startedAt) / 60_000))
  return {
    total: c.total,
    reads: c.byKind.get('read') ?? 0,
    writes: c.byKind.get('write') ?? 0,
    meta: c.byKind.get('meta') ?? 0,
    byTable: Object.fromEntries([...c.byTable].sort((a, b) => b[1] - a[1])),
    minutes,
    perHour: Math.round((c.total / minutes) * 60),
    savedByCache: cacheStats().requestsSaved,
  }
}

/** One line for a worker to log when it finishes, so the cost of a run is in the logs. */
export function requestSummary(label: string, before: number): string {
  const spent = counter().total - before
  const top = [...counter().byTable].sort((a, b) => b[1] - a[1]).slice(0, 3)
  return `${label}: ${spent} Airtable request(s)` + (top.length ? ` — ${top.map(([t, n]) => `${t} ${n}`).join(', ')}` : '')
}

export function requestsSoFar(): number {
  return counter().total
}

export function resetCounter(): void {
  const g = globalThis as unknown as Record<symbol, Counter | undefined>
  g[COUNTER_KEY] = { total: 0, byTable: new Map(), byKind: new Map(), startedAt: Date.now() }
}
