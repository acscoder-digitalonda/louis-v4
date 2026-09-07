#!/usr/bin/env tsx
/**
 * WP3.5 — restores a backup into a base.
 *
 *   npm run restore -- --from=backup --into=appXXXX            dry run
 *   npm run restore -- --from=backup --into=appXXXX --apply
 *   npm run restore -- --from=backup --into=appXXXX --only=deals,clients
 *
 * ── Why this exists, and why it refuses so much ────────────────────────────
 *
 * A backup nobody has restored from is a hope, not a backup. Doc 4 §4 asks for a
 * quarterly drill, and a drill needs a script — otherwise the drill is "somebody works
 * out how to restore, under pressure, having never done it".
 *
 * So this is written to be run by a person who is having a bad day:
 *
 *   - **It will not write into the base the app is pointed at.** `--into` must be given
 *     explicitly and must differ from `AIRTABLE_BASE_ID`. Restoring over live data is a
 *     thing you do deliberately, after moving the app, not something a flag typo does.
 *   - **It refuses a table that already has rows** unless `--overwrite` is given, and
 *     even then it appends rather than deleting: this script has no delete path at all,
 *     because the failure mode of a restore that deletes is unrecoverable.
 *   - **It reports before it writes.** The dry run prints every table and count.
 *
 * Record ids are not preserved — Airtable assigns them — so linked fields are remapped
 * from old id to new as each table lands. Tables are restored in dependency order for
 * that reason, and a link to a record that was never restored is dropped and counted
 * rather than silently written as an empty cell.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TABLE_KEYS, TABLES, type TableKey } from '../src/lib/airtable/schema'
import { createRecords, listRecords, readConfig, type AirtableConfig } from '../src/lib/airtable/rest'

/**
 * Parents before children, so a link has something to point at.
 *
 * Anything not named here follows in schema order, which is fine: only these carry links
 * that matter for a restore to be usable rather than merely complete.
 */
const ORDER: TableKey[] = [
  'clients',
  'contacts',
  'products',
  'rateCards',
  'templates',
  'users',
  'settings',
  'deals',
  'dealLineItems',
  'fulfillment',
  'coachingSessions',
  'tasks',
  'drafts',
  'emails',
  'payments',
  'scheduleLegs',
  'journalOrders',
  'dealProposals',
  'dateConflicts',
]

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
}

interface Dump {
  table: TableKey
  count: number
  records: { id: string; fields: Record<string, unknown> }[]
}

function readDump(dir: string, table: TableKey): Dump | null {
  const path = join(dir, `${table}.json`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as Dump
}

/** Rewrites linked-record ids from the backup onto the ids this restore just created. */
function remap(
  fields: Record<string, unknown>,
  idMap: Map<string, string>,
): { fields: Record<string, unknown>; dropped: number } {
  const out: Record<string, unknown> = {}
  let dropped = 0
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value) && value.every((v) => typeof v === 'string' && v.startsWith('rec'))) {
      const mapped = (value as string[]).map((id) => idMap.get(id)).filter(Boolean) as string[]
      dropped += value.length - mapped.length
      // An empty link is written as empty rather than omitted, so the difference between
      // "had no link" and "the link did not survive" is visible in the base.
      out[key] = mapped
      continue
    }
    out[key] = value
  }
  return { fields: out, dropped }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const overwrite = process.argv.includes('--overwrite')
  const dir = arg('from') ?? 'backup'
  const into = arg('into')
  const only = arg('only')?.split(',').map((s) => s.trim())

  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY must be set (try .env.local).')
    process.exitCode = 1
    return
  }
  if (!into) {
    console.error('--into=<baseId> is required. Restoring is always into a base you name.')
    process.exitCode = 1
    return
  }
  if (into === cfg.baseId) {
    console.error(`--into is the base the app is pointed at (${into}).`)
    console.error('Point the app somewhere else first, or restore into a scratch base.')
    console.error('Restoring over live data is deliberate, not a flag typo.')
    process.exitCode = 1
    return
  }

  const target: AirtableConfig = { ...cfg, baseId: into }
  const tables = [...ORDER, ...TABLE_KEYS.filter((t) => !ORDER.includes(t))].filter(
    (t) => !only || only.includes(t),
  )

  console.log(`Restoring ${dir}/ into ${into}\nMode: ${apply ? 'APPLY' : 'dry run'}\n`)

  const idMap = new Map<string, string>()
  let restored = 0
  let droppedLinks = 0
  const skipped: string[] = []

  for (const table of tables) {
    const dump = readDump(dir, table)
    if (!dump) continue
    if (dump.records.length === 0) continue

    let existing = 0
    try {
      existing = (await listRecords(target, table)).length
    } catch (err) {
      console.warn(`  ! ${TABLES[table].name}: cannot read the target — ${String(err).slice(0, 60)}`)
      skipped.push(table)
      continue
    }

    if (existing > 0 && !overwrite) {
      console.log(
        `  = ${TABLES[table].name.padEnd(24)} ${String(dump.records.length).padStart(5)} in backup, ${existing} already there — skipped`,
      )
      skipped.push(table)
      continue
    }

    console.log(`  + ${TABLES[table].name.padEnd(24)} ${String(dump.records.length).padStart(5)} record(s)`)
    if (!apply) continue

    // Ten to a request, because a restore of a full base is the one time the request
    // count is genuinely large.
    for (let i = 0; i < dump.records.length; i += 10) {
      const batch = dump.records.slice(i, i + 10)
      const payload = batch.map((r) => {
        const { fields, dropped } = remap(r.fields, idMap)
        droppedLinks += dropped
        return fields
      })
      const created = await createRecords(target, table, payload)
      created.forEach((rec, n) => idMap.set(batch[n]!.id, rec.id))
      restored += created.length
    }
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.')
    if (skipped.length > 0) {
      console.log(`${skipped.length} table(s) would be skipped because the target is not empty.`)
      console.log('Add --overwrite to append into them. Nothing is ever deleted by this script.')
    }
    return
  }

  console.log(`\nRestored ${restored} record(s) into ${into}.`)
  if (droppedLinks > 0) {
    console.log(
      `${droppedLinks} link(s) pointed at records that were not restored and were dropped.`,
    )
    console.log('That is expected on a partial restore and a problem on a full one.')
  }
  console.log('\nNow point a copy of the app at this base and click through it. A restore')
  console.log('that has not been looked at is the same hope the backup was.')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
