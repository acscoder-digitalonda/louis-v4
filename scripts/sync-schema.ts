#!/usr/bin/env tsx
/**
 * Additive schema sync — adds fields that `schema.ts` declares but the live base does
 * not have, on tables that already exist.
 *
 *   npm run schema:sync            dry run — prints the delta
 *   npm run schema:sync -- --apply create the missing fields
 *
 * Why this exists alongside `base:bootstrap`: bootstrap creates whole *tables* and, in
 * its second pass, only revisits the tables it just created. A field added to an
 * existing table — `Deals.Historical`, `Audit Log.Batch ID` — is invisible to it and is
 * silently skipped. The app then writes by field name, Airtable rejects the unknown
 * name, and the failure surfaces as a worker error rather than a schema problem.
 *
 * Strictly additive. It never renames, retypes or deletes a field: those are decisions,
 * and a script that makes them quietly is a script that loses data. Anything already
 * present is left exactly as it is, even if its type disagrees with the schema — the
 * disagreement is reported instead.
 */

import { TABLES, TABLE_KEYS, type FieldSpec, type TableKey } from '../src/lib/airtable/schema'
import { DEFERRED_TYPES, MANUAL_TYPES, toMetaField } from '../src/lib/airtable/meta-fields'
import { createField, listBaseTables, readConfig, type MetaTable } from '../src/lib/airtable/rest'

interface Missing {
  table: TableKey
  tableId: string
  field: FieldSpec
}

async function main() {
  const apply = process.argv.includes('--apply')
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  const existing = await listBaseTables(cfg)
  const byName = new Map<string, MetaTable>(existing.map((t) => [t.name.toLowerCase(), t]))

  const missing: Missing[] = []
  const missingTables: string[] = []
  const typeMismatches: string[] = []
  const manual: string[] = []

  for (const key of TABLE_KEYS) {
    const spec = TABLES[key]
    const table = byName.get(spec.name.toLowerCase())
    if (!table) {
      missingTables.push(spec.name)
      continue
    }

    const present = new Map(table.fields.map((f) => [f.name.toLowerCase(), f]))

    for (const field of spec.fields) {
      const live = present.get(field.name.toLowerCase())
      if (live) {
        // Report, never repair. A type change can destroy the column's contents.
        if (!typesAgree(field, live.type)) {
          typeMismatches.push(
            `${spec.name}.${field.name}: schema says ${field.type}, base has ${live.type}`,
          )
        }
        continue
      }
      if (MANUAL_TYPES.has(field.type)) {
        manual.push(`${spec.name}.${field.name} (${field.type})`)
        continue
      }
      missing.push({ table: key, tableId: table.id, field })
    }
  }

  console.info(`Base ${cfg.baseId}: ${existing.length} table(s) present.`)
  console.info(`Mode: ${apply ? 'APPLY' : 'dry run'}\n`)

  if (missingTables.length > 0) {
    console.info('Tables missing entirely — run `npm run base:bootstrap -- --apply` first:')
    for (const t of missingTables) console.info(`  · ${t}`)
    console.info('')
  }

  if (missing.length === 0) {
    console.info('No missing fields. The base matches schema.ts.')
  } else {
    console.info(`${missing.length} field(s) to add:`)
    for (const m of missing) {
      console.info(`  + ${TABLES[m.table].name}.${m.field.name} (${m.field.type})`)
    }
  }

  if (typeMismatches.length > 0) {
    console.info('\nType disagreements (reported, never changed automatically):')
    for (const t of typeMismatches) console.info(`  ! ${t}`)
  }

  if (manual.length > 0) {
    console.info('\nCreate by hand (rollups/lookups need a decision):')
    for (const m of manual) console.info(`  · ${m}`)
  }

  if (!apply) {
    console.info('\nDry run. Re-run with --apply to create the missing fields.')
    return
  }

  let created = 0
  for (const m of missing) {
    const spec = TABLES[m.table]
    try {
      if (m.field.type === 'multipleRecordLinks') {
        const target = m.field.link ? byName.get(TABLES[m.field.link].name.toLowerCase()) : undefined
        if (!target) {
          console.warn(`  ! ${spec.name}.${m.field.name}: target table missing, skipped.`)
          continue
        }
        await createField(cfg, m.tableId, {
          name: m.field.name,
          type: 'multipleRecordLinks',
          description: m.field.description,
          options: { linkedTableId: target.id },
        })
      } else {
        await createField(cfg, m.tableId, toMetaField(m.field))
      }
      created += 1
      console.info(`  + ${spec.name}.${m.field.name}`)
    } catch (err) {
      // One rejected field must not cost the rest of the sync.
      console.warn(
        `  ! ${spec.name}.${m.field.name} failed: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  console.info(`\nCreated ${created} of ${missing.length} field(s).`)
  console.info('Now run `npm run fields:refresh` so the app binds to the new field IDs.')
}

/** Airtable reports some types under a different name than the schema uses. */
function typesAgree(field: FieldSpec, liveType: string): boolean {
  if (field.type === liveType) return true
  if (DEFERRED_TYPES.has(field.type)) return true
  // Single/multi selects and text often round-trip loosely; only flag real surprises.
  const loose: Record<string, string[]> = {
    singleLineText: ['singleLineText', 'multilineText', 'richText'],
    multilineText: ['multilineText', 'singleLineText', 'richText'],
    number: ['number', 'percent', 'currency'],
    percent: ['percent', 'number'],
    currency: ['currency', 'number'],
  }
  return loose[field.type]?.includes(liveType) ?? false
}

main().catch((err) => {
  console.error('[schema:sync] failed', err)
  process.exitCode = 1
})
