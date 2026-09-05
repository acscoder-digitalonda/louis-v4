#!/usr/bin/env tsx
/**
 * Base bootstrap — the white-label kit's "duplicate the base" step (Rebuild Spec §8.2).
 *
 * Creates every table and field from `src/lib/airtable/schema.ts` in an empty base,
 * skipping anything that already exists, then tells you to run `fields:refresh`.
 *
 *   npm run base:bootstrap            # dry run — prints the plan
 *   npm run base:bootstrap -- --apply # actually creates
 *
 * Link fields are created in a second pass, because a link needs its target table to
 * exist first. Rollups and lookups (Payment Status, Contract Status) are deliberately
 * left for a human: they depend on choices about which payment rows count, and a wrong
 * rollup is worse than a missing one.
 */

import { TABLES, TABLE_KEYS, type TableKey } from '../src/lib/airtable/schema'
import { DEFERRED_TYPES, MANUAL_TYPES, creatableFields, toMetaField } from '../src/lib/airtable/meta-fields'
import {
  createField,
  createTable,
  listBaseTables,
  readConfig,
  type MetaTable,
} from '../src/lib/airtable/rest'

async function main() {
  const apply = process.argv.includes('--apply')
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  const existing = await listBaseTables(cfg)
  const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t]))
  const created = new Map<TableKey, MetaTable>()

  console.info(`Base ${cfg.baseId}: ${existing.length} table(s) present.\n`)

  // Pass 1 — tables with their non-link fields.
  for (const key of TABLE_KEYS) {
    const spec = TABLES[key]
    const found = byName.get(spec.name.toLowerCase())
    if (found) {
      console.info(`= ${spec.name} (exists)`)
      created.set(key, found)
      continue
    }

    const fields = creatableFields(spec.fields)

    // Airtable requires a primary field; the first non-link field becomes it.
    if (fields.length === 0) {
      console.warn(`! ${spec.name} has no createable fields — skipping.`)
      continue
    }

    console.info(`+ ${spec.name} (${fields.length} fields)`)
    if (apply) {
      const table = await createTable(cfg, spec.name, spec.description, fields)
      created.set(key, table)
    }
  }

  // Pass 2 — links, now that every target exists.
  for (const key of TABLE_KEYS) {
    const spec = TABLES[key]
    const table = created.get(key)
    if (!table) continue
    const present = new Set(table.fields.map((f) => f.name.toLowerCase()))

    for (const field of spec.fields) {
      const isLink = field.type === 'multipleRecordLinks'
      const isDeferred = DEFERRED_TYPES.has(field.type)
      if (!isLink && !isDeferred) continue
      if (present.has(field.name.toLowerCase())) continue

      // Created/Last-Modified time: no target table, just a late-added field.
      if (isDeferred) {
        console.info(`+ ${spec.name}.${field.name} (${field.type})`)
        if (apply) await createField(cfg, table.id, toMetaField(field))
        continue
      }

      const target = field.link ? created.get(field.link) : undefined
      if (!target) {
        console.warn(`! ${spec.name}.${field.name}: target table missing, skipped.`)
        continue
      }
      console.info(`+ ${spec.name}.${field.name} → ${TABLES[field.link!].name}`)
      if (apply) {
        // One field Airtable refuses must not cost the rest of the base its schema.
        try {
          await createField(cfg, table.id, {
            name: field.name,
            type: 'multipleRecordLinks',
            description: field.description,
            options: { linkedTableId: target.id },
          })
        } catch (err) {
          console.warn(`  ! ${spec.name}.${field.name} failed: ${err instanceof Error ? err.message : err}`)
        }
      }
    }
  }

  const manual = TABLE_KEYS.flatMap((key) =>
    TABLES[key].fields.filter((f) => MANUAL_TYPES.has(f.type)).map((f) => `${TABLES[key].name}.${f.name}`),
  )

  console.info('')
  if (!apply) {
    console.info('Dry run. Re-run with --apply to create.')
  } else {
    console.info('Done. Next: npm run fields:refresh')
  }
  if (manual.length) {
    console.info(`\nCreate these by hand (they are rollups/lookups and need a decision):`)
    for (const name of manual) console.info(`  · ${name}`)
  }
}


void main()
