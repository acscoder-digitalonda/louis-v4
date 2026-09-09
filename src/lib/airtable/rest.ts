/**
 * Thin typed Airtable REST client. No SDK — one dependency fewer, and the
 * rate-limit / retry behaviour is ours to see.
 *
 * Airtable allows 5 requests/second/base. `throttle()` serialises with a small
 * gap; 429s back off and retry. Everything else surfaces as an AirtableError so a
 * worker can log a Usage/Notification row rather than dying silently.
 */

import { fieldsAreGenerated, tableRef } from './fields'
import type { TableKey } from './schema'
import { countRequest, invalidate, readThrough, type RequestKind } from './cache'

const API = 'https://api.airtable.com/v0'
const META = 'https://api.airtable.com/v0/meta'
/** Slack added when waiting for the window to open, so a burst does not re-trip it. */
const MIN_GAP_MS = 20
const MAX_RETRIES = 3

export class AirtableError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
    this.name = 'AirtableError'
  }
}

export interface AirtableRecord {
  id: string
  createdTime: string
  fields: Record<string, unknown>
}

export interface AirtableConfig {
  apiKey: string
  baseId: string
}

export function readConfig(): AirtableConfig | null {
  const apiKey = process.env.AIRTABLE_API_KEY
  const baseId = process.env.AIRTABLE_BASE_ID
  if (!apiKey || !baseId) return null
  return { apiKey, baseId }
}

/**
 * Airtable's limit is five requests a second, per base. The old throttle honoured that by
 * running one request at a time and sleeping 210ms after each — which also meant a
 * `Promise.all` of nine reads ran as nine reads in a row. Opening one deal took 44 seconds.
 *
 * This keeps the same ceiling and drops the serialisation: at most five requests may
 * *start* in any rolling second, and they may be in flight together. A 429, if the window
 * is ever wrong, is retried with backoff below — the ceiling is the courtesy, the retry is
 * the guarantee.
 */
const WINDOW_MS = 1000
const MAX_PER_WINDOW = 5
const starts: number[] = []

async function throttle<T>(fn: () => Promise<T>): Promise<T> {
  for (;;) {
    const now = Date.now()
    while (starts.length && now - starts[0]! >= WINDOW_MS) starts.shift()
    if (starts.length < MAX_PER_WINDOW) break
    await new Promise((r) => setTimeout(r, WINDOW_MS - (now - starts[0]!) + MIN_GAP_MS))
  }
  starts.push(Date.now())
  return fn()
}

async function request<T>(
  cfg: AirtableConfig,
  url: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<T> {
  // Counted here because this is the only function that talks to Airtable, and a retry
  // is a second billed request — counting at the call site would undercount exactly when
  // things are going wrong.
  countRequest(tableFromUrl(url), kindOf(url, init.method))

  const res = await throttle(() =>
    fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
      cache: 'no-store',
    }),
  )

  if (res.status === 429 && attempt < MAX_RETRIES) {
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    return request<T>(cfg, url, init, attempt + 1)
  }
  if (res.status >= 500 && attempt < MAX_RETRIES) {
    await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    return request<T>(cfg, url, init, attempt + 1)
  }
  if (!res.ok) {
    const body = await res.text()
    throw new AirtableError(`Airtable ${res.status} on ${url}`, res.status, body)
  }
  return (await res.json()) as T
}

export interface ListOptions {
  filterByFormula?: string
  maxRecords?: number
  pageSize?: number
  sort?: { field: string; direction: 'asc' | 'desc' }[]
  view?: string
}

/**
 * Every read of a table, and the only place requests are counted.
 *
 * Goes through the cache (`airtable/cache.ts`). Use `listRecordsFresh` where a stale
 * answer would be acted on rather than looked at.
 */
export async function listRecords(
  cfg: AirtableConfig,
  table: TableKey,
  opts: ListOptions = {},
): Promise<AirtableRecord[]> {
  return readThrough(
    table,
    opts,
    // What this would have cost: one request per hundred records, at least one.
    estimatedRequests(table),
    () => listRecordsFresh(cfg, table, opts),
  )
}

/** How many requests a whole-table read costs, from the last time we counted it. */
const lastSize = new Map<TableKey, number>()

function estimatedRequests(table: TableKey): number {
  return Math.max(1, Math.ceil((lastSize.get(table) ?? 100) / 100))
}

export interface Page {
  records: AirtableRecord[]
  /** Pass back as `opts.cursor` for the next page. Absent means this was the last one. */
  cursor?: string
}

/**
 * One page of records, rather than the whole table.
 *
 * `listRecords` drains every page in a loop, which is right for a worker that has to see
 * everything and wrong for a screen. A list of 802 deals costs nine requests to render
 * and nobody scrolls past the first twenty; this costs one.
 *
 * Cached like any other read, and the cursor is part of the key, so paging back and forth
 * over the same pages is free inside the TTL.
 */
export async function listRecordsPage(
  cfg: AirtableConfig,
  table: TableKey,
  opts: ListOptions & { cursor?: string; pageSize?: number } = {},
): Promise<Page> {
  return readThrough(table, opts, 1, async () => {
    const params = new URLSearchParams()
    if (fieldsAreGenerated) params.set('returnFieldsByFieldId', 'true')
    if (opts.filterByFormula) params.set('filterByFormula', opts.filterByFormula)
    params.set('pageSize', String(Math.min(opts.pageSize ?? 50, 100)))
    if (opts.view) params.set('view', opts.view)
    opts.sort?.forEach((srt, i) => {
      params.set(`sort[${i}][field]`, srt.field)
      params.set(`sort[${i}][direction]`, srt.direction)
    })
    if (opts.cursor) params.set('offset', opts.cursor)

    const url = `${API}/${cfg.baseId}/${encodeURIComponent(tableRef(table))}?${params}`
    const page = await request<{ records: AirtableRecord[]; offset?: string }>(cfg, url)
    return { records: page.records, cursor: page.offset }
  })
}

/** Straight to Airtable, no cache. For a read whose answer is about to be acted on. */
export async function listRecordsFresh(
  cfg: AirtableConfig,
  table: TableKey,
  opts: ListOptions = {},
): Promise<AirtableRecord[]> {
  const out: AirtableRecord[] = []
  let offset: string | undefined

  do {
    const params = new URLSearchParams()
    if (fieldsAreGenerated) params.set('returnFieldsByFieldId', 'true')
    if (opts.filterByFormula) params.set('filterByFormula', opts.filterByFormula)
    if (opts.maxRecords) params.set('maxRecords', String(opts.maxRecords))
    params.set('pageSize', String(opts.pageSize ?? 100))
    if (opts.view) params.set('view', opts.view)
    opts.sort?.forEach((s, i) => {
      params.set(`sort[${i}][field]`, s.field)
      params.set(`sort[${i}][direction]`, s.direction)
    })
    if (offset) params.set('offset', offset)

    const url = `${API}/${cfg.baseId}/${encodeURIComponent(tableRef(table))}?${params}`
    const page = await request<{ records: AirtableRecord[]; offset?: string }>(cfg, url)
    out.push(...page.records)
    offset = page.offset
    if (opts.maxRecords && out.length >= opts.maxRecords) break
  } while (offset)

  lastSize.set(table, out.length)
  return out
}

export async function getRecord(
  cfg: AirtableConfig,
  table: TableKey,
  id: string,
): Promise<AirtableRecord | null> {
  // Cached like a list read, keyed by id. Right for a record read to *label* something —
  // a name in a filter, a client on a list row. Wrong for the record a person is looking
  // at: the cache is per serverless instance, so a stage change written on one instance
  // still read as the old stage on another for up to 45 seconds. That happened, the
  // afternoon this cache was added. `getRecordFresh` is for the record itself.
  return readThrough(table, { id }, 1, () => getRecordFresh(cfg, table, id))
}

export async function getRecordFresh(
  cfg: AirtableConfig,
  table: TableKey,
  id: string,
): Promise<AirtableRecord | null> {
  const params = fieldsAreGenerated ? '?returnFieldsByFieldId=true' : ''
  const url = `${API}/${cfg.baseId}/${encodeURIComponent(tableRef(table))}/${id}${params}`
  try {
    return await request<AirtableRecord>(cfg, url)
  } catch (err) {
    if (err instanceof AirtableError && err.status === 404) return null
    throw err
  }
}

export async function createRecords(
  cfg: AirtableConfig,
  table: TableKey,
  records: Record<string, unknown>[],
): Promise<AirtableRecord[]> {
  invalidate(table)
  const out: AirtableRecord[] = []
  for (let i = 0; i < records.length; i += 10) {
    const batch = records.slice(i, i + 10)
    const url = `${API}/${cfg.baseId}/${encodeURIComponent(tableRef(table))}`
    const res = await request<{ records: AirtableRecord[] }>(cfg, url, {
      method: 'POST',
      body: JSON.stringify({
        records: batch.map((fields) => ({ fields })),
        typecast: true,
        ...(fieldsAreGenerated ? { returnFieldsByFieldId: true } : {}),
      }),
    })
    out.push(...res.records)
  }
  return out
}

export async function updateRecord(
  cfg: AirtableConfig,
  table: TableKey,
  id: string,
  fields: Record<string, unknown>,
): Promise<AirtableRecord> {
  invalidate(table)
  const url = `${API}/${cfg.baseId}/${encodeURIComponent(tableRef(table))}/${id}`
  return request<AirtableRecord>(cfg, url, {
    method: 'PATCH',
    body: JSON.stringify({
      fields,
      typecast: true,
      ...(fieldsAreGenerated ? { returnFieldsByFieldId: true } : {}),
    }),
  })
}

/**
 * Updates many records, ten per request.
 *
 * This exists because its absence cost a month of API quota. Airtable bills per request,
 * not per record, and a bulk script written against `updateRecord` sends one request per
 * row: three backfills in one day — 698 contacts, 150 proposals, 802 deals, each with an
 * audit row — came to roughly 3,300 requests where batching would have sent 330, and the
 * workspace hit `PUBLIC_API_BILLING_LIMIT_EXCEEDED`, which blocks *reads* too and takes
 * the whole app down with it.
 *
 * So: any script touching more than a handful of records uses this, not a loop.
 */
export async function updateRecords(
  cfg: AirtableConfig,
  table: TableKey,
  records: { id: string; fields: Record<string, unknown> }[],
): Promise<AirtableRecord[]> {
  invalidate(table)
  const out: AirtableRecord[] = []
  for (let i = 0; i < records.length; i += 10) {
    const url = `${API}/${cfg.baseId}/${encodeURIComponent(tableRef(table))}`
    const res = await request<{ records: AirtableRecord[] }>(cfg, url, {
      method: 'PATCH',
      body: JSON.stringify({
        records: records.slice(i, i + 10),
        typecast: true,
        ...(fieldsAreGenerated ? { returnFieldsByFieldId: true } : {}),
      }),
    })
    out.push(...res.records)
  }
  return out
}

export async function deleteRecord(
  cfg: AirtableConfig,
  table: TableKey,
  id: string,
): Promise<void> {
  invalidate(table)
  const url = `${API}/${cfg.baseId}/${encodeURIComponent(tableRef(table))}/${id}`
  await request<unknown>(cfg, url, { method: 'DELETE' })
}

// ── Meta API — used by the bootstrap and field-refresh scripts only ─────────

export interface MetaField {
  id: string
  name: string
  type: string
  options?: Record<string, unknown>
}

export interface MetaTable {
  id: string
  name: string
  fields: MetaField[]
}

export async function listBaseTables(cfg: AirtableConfig): Promise<MetaTable[]> {
  const res = await request<{ tables: MetaTable[] }>(cfg, `${META}/bases/${cfg.baseId}/tables`)
  return res.tables
}

export async function createTable(
  cfg: AirtableConfig,
  name: string,
  description: string,
  fields: { name: string; type: string; options?: Record<string, unknown>; description?: string }[],
): Promise<MetaTable> {
  return request<MetaTable>(cfg, `${META}/bases/${cfg.baseId}/tables`, {
    method: 'POST',
    body: JSON.stringify({ name, description, fields }),
  })
}

export async function createField(
  cfg: AirtableConfig,
  tableId: string,
  field: { name: string; type: string; options?: Record<string, unknown>; description?: string },
): Promise<MetaField> {
  return request<MetaField>(cfg, `${META}/bases/${cfg.baseId}/tables/${tableId}/fields`, {
    method: 'POST',
    body: JSON.stringify(field),
  })
}

/**
 * Updates a field's name, description or options.
 *
 * The only caller is the additive schema sync, and it only ever *adds* select choices.
 * Airtable replaces the whole option list on write, so a caller that sends a short list
 * deletes every option it left out — and every record holding one. Read the live options
 * first, append, and send the union. Never the schema's list on its own.
 */
export async function updateField(
  cfg: AirtableConfig,
  tableId: string,
  fieldId: string,
  patch: { name?: string; description?: string; options?: Record<string, unknown> },
): Promise<MetaField> {
  return request<MetaField>(cfg, `${META}/bases/${cfg.baseId}/tables/${tableId}/fields/${fieldId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** Escapes a value for use inside a filterByFormula string literal. */
export function formulaValue(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

/**
 * Batch delete — up to 10 per request, the same ceiling as create.
 *
 * The purge in the go-live cutover walks whole tables; one request per record would
 * spend an hour inside the 5 req/s budget doing nothing but waiting.
 */
export async function deleteRecords(
  cfg: AirtableConfig,
  table: TableKey,
  ids: string[],
): Promise<number> {
  invalidate(table)
  let deleted = 0
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10)
    const params = new URLSearchParams()
    batch.forEach((id) => params.append('records[]', id))
    const url = `${API}/${cfg.baseId}/${encodeURIComponent(tableRef(table))}?${params}`
    const res = await request<{ records: { id: string; deleted: boolean }[] }>(cfg, url, {
      method: 'DELETE',
    })
    deleted += res.records.filter((r) => r.deleted).length
  }
  return deleted
}

/** Best effort: the table segment of an Airtable URL, for the per-table breakdown. */
function tableFromUrl(url: string): string {
  const meta = url.match(/\/meta\/bases\/[^/]+\/tables(?:\/([^/?]+))?/)
  if (meta) return `meta:${meta[1] ?? 'tables'}`
  const rec = url.match(/\/v0\/[^/]+\/([^/?]+)/)
  return rec ? decodeURIComponent(rec[1]!) : 'unknown'
}

function kindOf(url: string, method: string | undefined): RequestKind {
  if (url.includes('/meta/')) return 'meta'
  return !method || method === 'GET' ? 'read' : 'write'
}
