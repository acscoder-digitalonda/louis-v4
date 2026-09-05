#!/usr/bin/env tsx
/**
 * Regenerates `src/lib/airtable/fields.generated.json` from the live base.
 *
 * This is what binds the app to field **IDs** rather than names — run it after any
 * schema change, and after cloning a base for a new speaker. It reports anything the
 * schema expects but the base does not have, which is usually how a half-finished
 * bootstrap gets noticed.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TABLES, TABLE_KEYS } from '../src/lib/airtable/schema'
import { listBaseTables, readConfig } from '../src/lib/airtable/rest'

const OUT = join(process.cwd(), 'src/lib/airtable/fields.generated.json')

async function main() {
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  const tables = await listBaseTables(cfg)
  const byName = new Map(tables.map((t) => [t.name.toLowerCase(), t]))

  const out: Record<string, { tableId: string; fields: Record<string, string> }> = {}
  const missing: string[] = []

  for (const key of TABLE_KEYS) {
    const spec = TABLES[key]
    const table = byName.get(spec.name.toLowerCase())
    if (!table) {
      missing.push(`table ${spec.name}`)
      continue
    }
    const fieldsByName = new Map(table.fields.map((f) => [f.name.toLowerCase(), f]))
    const fields: Record<string, string> = {}
    for (const field of spec.fields) {
      const found = fieldsByName.get(field.name.toLowerCase())
      if (found) fields[field.key] = found.id
      else missing.push(`${spec.name}.${field.name}`)
    }
    out[key] = { tableId: table.id, fields }
  }

  writeFileSync(
    OUT,
    `${JSON.stringify(
      { baseId: cfg.baseId, generatedAt: new Date().toISOString(), tables: out },
      null,
      2,
    )}\n`,
  )

  console.info(`Wrote ${OUT}`)
  console.info(`  ${Object.keys(out).length} tables bound by ID.`)
  if (missing.length) {
    console.warn(`\nNot found in the base (${missing.length}) — these fall back to name binding:`)
    for (const name of missing) console.warn(`  · ${name}`)
  }
}

void main()
