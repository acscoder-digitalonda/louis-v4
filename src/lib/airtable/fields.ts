/**
 * Field-ID binding (Handoff §9: "never string names in components").
 *
 * `fields.generated.json` is written by `npm run fields:refresh` against the live base.
 * Until that runs — a fresh clone, or CI with no credentials — we fall back to the
 * human-readable names from `schema.ts` so the app still compiles and runs.
 *
 * Reads always request `returnFieldsByFieldId` when IDs are known, so a field renamed
 * in Airtable is a non-event.
 */

import generated from './fields.generated.json'
import { TABLES, type TableKey } from './schema'

interface GeneratedTable {
  tableId: string
  fields: Record<string, string>
}

interface GeneratedMap {
  baseId: string | null
  generatedAt: string | null
  tables: Partial<Record<TableKey, GeneratedTable>>
}

const map = generated as GeneratedMap

export const fieldsAreGenerated = Boolean(map.generatedAt)

export function tableRef(table: TableKey): string {
  return map.tables[table]?.tableId ?? TABLES[table].name
}

/** Returns the field ID when known, otherwise the Airtable field name. */
export function fieldRef(table: TableKey, key: string): string {
  const id = map.tables[table]?.fields?.[key]
  if (id) return id
  const spec = TABLES[table].fields.find((f) => f.key === key)
  if (!spec) throw new Error(`Unknown field ${table}.${key} — add it to airtable/schema.ts`)
  return spec.name
}

/** domainKey → ref, for encoding writes. */
export function refsFor(table: TableKey): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of TABLES[table].fields) out[f.key] = fieldRef(table, f.key)
  return out
}

/** ref → domainKey, for decoding reads (handles both ID and name responses). */
export function decoderFor(table: TableKey): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of TABLES[table].fields) {
    out[f.name] = f.key
    const id = map.tables[table]?.fields?.[f.key]
    if (id) out[id] = f.key
  }
  return out
}

export const generatedMeta = { baseId: map.baseId, generatedAt: map.generatedAt }
