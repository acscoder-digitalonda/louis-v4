#!/usr/bin/env tsx
/**
 * WP4.1 — seed the Templates table from `louis-email-templates.csv` (31 templates in
 * Ben's voice, including E01b, the social-proof first reply).
 *
 *   npm run seed:templates -- <louis-email-templates.csv>            dry run
 *   npm run seed:templates -- <louis-email-templates.csv> --commit
 *
 * The live base has an *empty* Templates table, which means the drafts engine currently
 * has no script bank at all. That is a go-live blocker hiding in a table nobody looks at,
 * so this exists as its own step rather than as a footnote in the import.
 *
 * Idempotent on `Key` (the template ID, E01…E21b): re-running updates rather than
 * duplicating, so a copy fix from Ben is a re-run, not a manual edit.
 */

import { readFileSync } from 'node:fs'
import { createRecords, listRecords, readConfig, updateRecord } from '../src/lib/airtable/rest'
import { parseCsv } from '../src/workers/f11-import'
import { fieldRef, refsFor } from '../src/lib/airtable/fields'

interface TemplateRow {
  'Template ID': string
  Name: string
  Stage: string
  Lane: string
  'Deal Type': string
  Trigger: string
  'Send Mode': string
  Sender: string
  Register: string
  Subject: string
  Body: string
  Variables: string
  Notes: string
  Active: string
}

/**
 * Everything the CSV knows that the Templates table has no column for is folded into
 * Notes rather than dropped — stage, lane, trigger and send mode are what tell Liezel
 * why a template exists, and losing them would make the Settings screen useless.
 */
function notesFor(row: TemplateRow): string {
  const parts = [
    row.Stage && `Stage: ${row.Stage}`,
    row.Lane && `Lane: ${row.Lane}`,
    row['Deal Type'] && `Deal type: ${row['Deal Type']}`,
    row.Trigger && `Trigger: ${row.Trigger}`,
    row['Send Mode'] && `Send mode: ${row['Send Mode']}`,
    row.Sender && `Sender: ${row.Sender}`,
    row.Register && `Register: ${row.Register}`,
    row.Variables && `Variables: ${row.Variables}`,
    row.Active && `Active: ${row.Active}`,
    row.Notes,
  ].filter(Boolean)
  return parts.join('\n')
}

async function main() {
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  const args = process.argv.slice(2)
  const file = args.find((a) => !a.startsWith('--'))
  const commit = args.includes('--commit')
  if (!file) {
    console.error('Usage: npm run seed:templates -- <louis-email-templates.csv> [--commit]')
    process.exitCode = 1
    return
  }

  const rows = parseCsv(readFileSync(file, 'utf8')) as unknown as TemplateRow[]
  const existing = await listRecords(cfg, 'templates')
  const keyRef = fieldRef('templates', 'key')
  const byKey = new Map(
    existing
      .map((r) => [String(r.fields[keyRef] ?? '').trim(), r.id] as const)
      .filter(([key]) => key !== ''),
  )

  const creates: Record<string, unknown>[] = []
  const updates: { id: string; fields: Record<string, unknown> }[] = []

  for (const row of rows) {
    const key = row['Template ID']?.trim()
    if (!key) continue
    const fields = {
      key,
      label: row.Name?.trim() ?? key,
      subject: row.Subject?.trim() ?? '',
      body: row.Body ?? '',
      notes: notesFor(row),
    }
    const id = byKey.get(key)
    if (id) updates.push({ id, fields })
    else creates.push(fields)
  }

  console.info(`\nTemplates seed — ${commit ? 'COMMIT' : 'dry run'}`)
  console.info(`  csv rows        ${rows.length}`)
  console.info(`  already in base ${existing.length}`)
  console.info(`  create          ${creates.length}`)
  console.info(`  update          ${updates.length}`)
  for (const c of creates.slice(0, 5)) console.info(`    + ${c.key} — ${c.label}`)
  if (creates.length > 5) console.info(`    … ${creates.length - 5} more`)

  if (!commit) {
    console.info('\nNothing was written. Re-run with --commit to apply.')
    return
  }

  // listRecords/createRecords speak Airtable refs, so map domain keys across.
  const refs = refsFor('templates')
  const encode = (f: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(f).map(([k, v]) => [refs[k] ?? k, v]))

  if (creates.length > 0) await createRecords(cfg, 'templates', creates.map(encode))
  for (const u of updates) await updateRecord(cfg, 'templates', u.id, encode(u.fields))

  console.info(`\nWrote ${creates.length} new and ${updates.length} updated template(s).`)
}

main().catch((err) => {
  console.error('[templates] failed', err)
  process.exitCode = 1
})
