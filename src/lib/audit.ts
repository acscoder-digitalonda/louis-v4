/**
 * Audit writing.
 *
 * Every write that changes a value — human or agent — lands here. The rule from the
 * spec is that automation is reversible and attributable: `reversible` records whether
 * the old value is recoverable from the entry itself.
 */

import { db } from './data'
import { TABLES, type TableKey } from './airtable/schema'
import type { AuditEntry } from './types'

export type Actor =
  | { kind: 'human'; email: string }
  | { kind: 'agent'; worker: string }

export function agentActor(worker: string): Actor {
  return { kind: 'agent', worker }
}

export function humanActor(email: string): Actor {
  return { kind: 'human', email }
}

function actorString(actor: Actor): string {
  return actor.kind === 'human' ? actor.email : `agent:${actor.worker}`
}

export function fieldLabel(table: TableKey, key: string): string {
  return TABLES[table].fields.find((f) => f.key === key)?.name ?? key
}

export function display(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export interface AuditWrite {
  table: TableKey
  recordId: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  actor: Actor
  source?: string | null
  /** Set by bulk operations (an import, a seed accept) so the whole run reverses as one. */
  batchId?: string | null
}

export interface FieldChange {
  key: string
  oldValue: string | null
  newValue: string | null
}

/**
 * The diff itself, with no I/O — this is what decides whether a change is recorded at
 * all, and therefore whether it can ever be reverted.
 *
 * Two rules do the work. `undefined` in `after` means "not part of this write", which is
 * different from `null` meaning "cleared"; a partial patch must not record every field it
 * omitted. And equality is compared on the *rendered* strings, so writing 40000 over
 * "40000" is correctly seen as no change rather than logged as an edit nobody made.
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = []
  for (const [key, nextValue] of Object.entries(after)) {
    if (nextValue === undefined) continue
    const oldValue = display(before[key])
    const newValue = display(nextValue)
    if (oldValue === newValue) continue
    changes.push({ key, oldValue, newValue })
  }
  return changes
}

/**
 * Diffs before/after and writes one entry per changed field.
 * Returns the entries written, so a caller can surface "3 fields updated".
 */
export async function recordChanges(write: AuditWrite): Promise<AuditEntry[]> {
  const provider = db()
  const at = new Date().toISOString()
  const entries: AuditEntry[] = []

  for (const { key, oldValue, newValue } of diffFields(write.before, write.after)) {
    entries.push(
      await provider.appendAudit({
        entity: write.table,
        entityId: write.recordId,
        field: fieldLabel(write.table, key),
        oldValue,
        newValue,
        actor: actorString(write.actor),
        actorKind: write.actor.kind,
        source: write.source ?? null,
        batchId: write.batchId ?? null,
        at,
        reversible: true,
      }),
    )
  }
  return entries
}

/** For events that are not a field diff (a send, an import, a stage packet firing). */
export async function recordEvent(params: {
  table: TableKey
  recordId: string
  what: string
  detail?: string | null
  actor: Actor
  source?: string | null
  batchId?: string | null
  reversible?: boolean
}): Promise<AuditEntry> {
  return db().appendAudit({
    entity: params.table,
    entityId: params.recordId,
    field: params.what,
    oldValue: null,
    newValue: params.detail ?? null,
    actor: actorString(params.actor),
    actorKind: params.actor.kind,
    source: params.source ?? null,
    batchId: params.batchId ?? null,
    at: new Date().toISOString(),
    reversible: params.reversible ?? false,
  })
}

/**
 * Records the same field change across many records in as few requests as possible.
 *
 * A bulk script that calls `recordChanges` per row spends two Airtable requests per row —
 * one update, one audit — and Airtable bills per request, not per record. Three backfills
 * written that way exhausted a month of quota in a day and took the app's reads down with
 * it. Pair this with `updateRecords` and the same work costs a tenth as much.
 */
export async function recordChangesMany(writes: AuditWrite[]): Promise<number> {
  const provider = db()
  const at = new Date().toISOString()
  const rows = []

  for (const write of writes) {
    for (const { key, oldValue, newValue } of diffFields(write.before, write.after)) {
      rows.push({
        entity: write.table,
        entityId: write.recordId,
        field: fieldLabel(write.table, key),
        oldValue,
        newValue,
        actor: actorString(write.actor),
        actorKind: write.actor.kind,
        source: write.source ?? null,
        batchId: write.batchId ?? null,
        at,
        reversible: true,
      })
    }
  }

  await provider.appendAuditMany(rows)
  return rows.length
}
