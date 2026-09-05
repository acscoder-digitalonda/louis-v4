#!/usr/bin/env tsx
/**
 * Phase A step 1 of the go-live cutover: freeze the sample base as test fixtures
 * before anything is deleted.
 *
 *   npm run fixtures:export                      → fixtures/sample-<yyyy-mm>/
 *   npm run fixtures:export -- --out fixtures/x
 *
 * Deliberately *not* built on the app's data provider. This is a raw dump keyed by
 * Airtable's own field names, so it stays readable and restorable even if `schema.ts`
 * moves on — a fixture only one version of the app can read is not a backup.
 *
 * Record IDs are kept for reference, but reloading a fixture creates new records with
 * new IDs and linked-record fields will not reconnect. The manifest says so rather than
 * leaving someone to discover it during a restore.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listBaseTables, readConfig, type AirtableConfig } from '../src/lib/airtable/rest'

const API = 'https://api.airtable.com/v0'
const GAP_MS = 210

interface RawRecord {
  id: string
  createdTime: string
  fields: Record<string, unknown>
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/** "Field Proposals" → "field-proposals" */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Lists by table ID with field *names* in the response — the raw shape. The app's
 * `listRecords` is keyed by TableKey and returns field IDs; neither is what a fixture
 * wants.
 */
async function listAll(cfg: AirtableConfig, tableId: string): Promise<RawRecord[]> {
  const out: RawRecord[] = []
  let offset: string | undefined

  do {
    const params = new URLSearchParams({ pageSize: '100' })
    if (offset) params.set('offset', offset)
    const res = await fetch(`${API}/${cfg.baseId}/${tableId}?${params}`, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      cache: 'no-store',
    })
    if (res.status === 429) {
      await sleep(1200)
      continue
    }
    if (!res.ok) throw new Error(`Airtable ${res.status} on ${tableId}: ${await res.text()}`)
    const page = (await res.json()) as { records: RawRecord[]; offset?: string }
    out.push(...page.records)
    offset = page.offset
    await sleep(GAP_MS)
  } while (offset)

  return out
}

async function main() {
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  const args = process.argv.slice(2)
  const outFlag = args.indexOf('--out')
  const stamp = new Date().toISOString().slice(0, 7)
  const outDir = outFlag >= 0 ? args[outFlag + 1]! : join('fixtures', `sample-${stamp}`)

  console.info(`[fixtures] base ${cfg.baseId} → ${outDir}`)
  mkdirSync(outDir, { recursive: true })

  const tables = await listBaseTables(cfg)
  const manifest = {
    baseId: cfg.baseId,
    exportedAt: new Date().toISOString(),
    note:
      'Raw dump keyed by Airtable field names. Record IDs are preserved for reference, ' +
      'but a reload creates new records with new IDs — linked-record fields will not ' +
      'reconnect automatically.',
    tables: [] as { name: string; id: string; file: string; records: number }[],
  }

  let total = 0
  for (const table of tables) {
    const records = await listAll(cfg, table.id)
    const file = `${slug(table.name)}.json`
    writeFileSync(
      join(outDir, file),
      `${JSON.stringify(
        {
          table: table.name,
          tableId: table.id,
          fields: table.fields.map((f) => ({ id: f.id, name: f.name, type: f.type })),
          records,
        },
        null,
        2,
      )}\n`,
    )
    manifest.tables.push({ name: table.name, id: table.id, file, records: records.length })
    total += records.length
    console.info(`  ${table.name.padEnd(18)} ${String(records.length).padStart(5)} → ${file}`)
  }

  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  console.info(`[fixtures] ${tables.length} tables, ${total} records → ${outDir}`)
}

main().catch((err) => {
  console.error('[fixtures] failed', err)
  process.exitCode = 1
})
