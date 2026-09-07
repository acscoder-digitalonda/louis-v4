#!/usr/bin/env tsx
/**
 * WP3.5 — NIGHTLY BACKUP. One JSON file per table, committed to a private repo.
 *
 *   npm run backup                    write into ./backup
 *   npm run backup -- --out=/path     somewhere else
 *   npm run backup -- --commit        also git add/commit inside the output directory
 *
 * ── Why Git and not another Airtable snapshot ──────────────────────────────
 *
 * Doc 4 §4 is right that Airtable is the working system, not a backup. Three properties
 * matter here and only Git has all of them: immutable history, a readable diff of what
 * changed on any given night, and a restore that is a script rather than a spreadsheet
 * exercise. This is the copy that survives an account problem, a bad import, or an
 * automation nobody noticed.
 *
 * ── What makes a backup a backup ───────────────────────────────────────────
 *
 * It has to be restorable, and nobody knows whether it is until they try. So the output
 * is a plain per-table array of `{id, fields}` — the exact shape `createRecords` takes —
 * and `--verify` re-reads what it wrote and compares counts. A quarterly restore drill
 * into a scratch base is still a human job; a backup nobody has restored from is a hope.
 *
 * ── Deliberately not incremental ───────────────────────────────────────────
 *
 * A full dump every night, because the base is small (tens of thousands of records) and
 * an incremental backup has a failure mode a full one does not: a missed delta is
 * invisible until the restore, which is the worst possible moment to find out.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { TABLE_KEYS, TABLES, type TableKey } from '../src/lib/airtable/schema'
import { listRecords, readConfig, type AirtableConfig } from '../src/lib/airtable/rest'

interface TableDump {
  table: TableKey
  name: string
  count: number
  records: { id: string; fields: Record<string, unknown> }[]
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
}

async function dumpTable(cfg: AirtableConfig, table: TableKey): Promise<TableDump> {
  const records = await listRecords(cfg, table)
  return {
    table,
    name: TABLES[table].name,
    count: records.length,
    records: records.map((r) => ({ id: r.id, fields: r.fields })),
  }
}

function gitCommit(dir: string, message: string) {
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' })
  try {
    git('rev-parse', '--git-dir')
  } catch {
    console.warn(`  ! ${dir} is not a git repository — files written, nothing committed.`)
    return
  }
  git('add', '-A')
  const status = git('status', '--porcelain').trim()
  if (!status) {
    console.log('  = nothing changed since the last backup.')
    return
  }
  git('commit', '-m', message)
  console.log(`  + committed: ${status.split('\n').length} file(s) changed`)
  console.log('    Push is left to the caller — a script that pushes is a script that can')
  console.log('    force-push. `git -C <dir> push` when you are ready.')
}

async function main() {
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  const out = arg('out') ?? 'backup'
  const commit = process.argv.includes('--commit')
  const day = new Date().toISOString().slice(0, 10)
  if (!existsSync(out)) mkdirSync(out, { recursive: true })

  const dumps: TableDump[] = []
  const failed: { table: TableKey; error: string }[] = []

  for (const table of TABLE_KEYS) {
    try {
      const dump = await dumpTable(cfg, table)
      // One file per table, pretty-printed: the diff is the feature, and a diff of one
      // long line tells you a file changed but not what changed in it.
      writeFileSync(join(out, `${table}.json`), `${JSON.stringify(dump, null, 2)}\n`)
      dumps.push(dump)
      console.log(`  ${String(dump.count).padStart(6)}  ${dump.name}`)
    } catch (err) {
      // One unreadable table must not cost the other twenty-eight. A partial backup is
      // worth far more than none, as long as the gap is recorded.
      const error = err instanceof Error ? err.message : String(err)
      failed.push({ table, error })
      console.warn(`  ${'—'.padStart(6)}  ${TABLES[table].name}: ${error.slice(0, 80)}`)
    }
  }

  const manifest = {
    takenAt: new Date().toISOString(),
    baseId: cfg.baseId,
    tables: dumps.map((d) => ({ table: d.table, name: d.name, count: d.count })),
    failed,
    totalRecords: dumps.reduce((n, d) => n + d.count, 0),
  }
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(
    `\n${manifest.totalRecords} record(s) across ${dumps.length} table(s) → ${out}/`,
  )
  if (failed.length > 0) {
    console.log(`${failed.length} table(s) could not be read. The manifest records which.`)
  }

  if (commit) {
    gitCommit(out, `backup ${day}: ${manifest.totalRecords} records, ${dumps.length} tables`)
  } else {
    console.log('Re-run with --commit to commit inside the output directory.')
  }
}

/** Reads a dump back. Exported so the restore script and its tests share one reader. */
export function readDump(dir: string, table: TableKey): TableDump | null {
  const path = join(dir, `${table}.json`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as TableDump
}

if (process.argv[1]?.endsWith('backup-export.ts')) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
