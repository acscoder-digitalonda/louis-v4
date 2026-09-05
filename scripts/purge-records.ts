#!/usr/bin/env tsx
/**
 * Phase A step 2 of the go-live cutover: empty the sample base of *records* while
 * leaving the *schema* and the config tables exactly as they are.
 *
 *   npm run purge:records                  dry run — counts what would go
 *   npm run purge:records -- --commit      delete, after the confirmation gate
 *   npm run purge:records -- --commit --yes-i-have-a-fixture-export
 *
 * Three guards, because this is the one irreversible step in the runbook:
 *
 *  1. Dry run is the default. `--commit` alone is not enough.
 *  2. `--commit` refuses to run unless a fixture export for this base exists on disk,
 *     unless the operator passes the long flag saying they know it does not.
 *  3. Config tables (`PRESERVED_TABLES`) are never touched, and the script re-checks
 *     that list against what it is about to delete rather than trusting the caller.
 *
 * Purging records never touches fields, so `fields.generated.json` stays valid and
 * `fields.ts` needs no re-run — that is Phase A step 3's assertion, enforced here by
 * simply never calling the Meta API.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  deleteRecords,
  listRecords,
  readConfig,
  type AirtableConfig,
} from '../src/lib/airtable/rest'
import {
  PRESERVED_TABLES,
  PURGEABLE_TABLES,
  TABLES,
  type TableKey,
} from '../src/lib/airtable/schema'

const FIXTURES_DIR = 'fixtures'

/** Finds a fixture export taken against this base, so the purge has something to fall back to. */
function fixtureExportFor(baseId: string): string | null {
  if (!existsSync(FIXTURES_DIR)) return null
  for (const entry of readdirSync(FIXTURES_DIR)) {
    const manifest = join(FIXTURES_DIR, entry, 'manifest.json')
    if (!existsSync(manifest)) continue
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { baseId?: string }
      if (parsed.baseId === baseId) return join(FIXTURES_DIR, entry)
    } catch {
      // A manifest we cannot parse is not a fixture we can rely on.
    }
  }
  return null
}

async function countAndDelete(
  cfg: AirtableConfig,
  table: TableKey,
  commit: boolean,
): Promise<number> {
  const records = await listRecords(cfg, table)
  if (records.length === 0 || !commit) return records.length
  return deleteRecords(
    cfg,
    table,
    records.map((r) => r.id),
  )
}

async function main() {
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  const args = process.argv.slice(2)
  const commit = args.includes('--commit')
  const skipFixtureCheck = args.includes('--yes-i-have-a-fixture-export')

  // Guard 3, applied before anything is read: never delete out of a config table.
  const targets = PURGEABLE_TABLES.filter((t) => !PRESERVED_TABLES.includes(t))
  if (targets.length !== PURGEABLE_TABLES.length) {
    console.error('Refusing to run: a preserved table appeared in the purge list.')
    process.exitCode = 1
    return
  }

  const fixture = fixtureExportFor(cfg.baseId)
  if (commit && !fixture && !skipFixtureCheck) {
    console.error(
      `No fixture export found for base ${cfg.baseId} under ./${FIXTURES_DIR}/.\n` +
        'Run `npm run fixtures:export` first — Phase A step 1 exists so this step is survivable.\n' +
        'To purge anyway, pass --yes-i-have-a-fixture-export.',
    )
    process.exitCode = 1
    return
  }

  console.info(`[purge] base ${cfg.baseId}`)
  console.info(`[purge] mode ${commit ? 'COMMIT — records will be deleted' : 'dry run'}`)
  console.info(`[purge] fixtures ${fixture ?? 'none found'}`)
  console.info(`[purge] preserving ${PRESERVED_TABLES.map((t) => TABLES[t].name).join(', ')}`)
  console.info('')

  let total = 0
  for (const table of targets) {
    const n = await countAndDelete(cfg, table, commit)
    total += n
    const verb = commit ? 'deleted' : 'would delete'
    console.info(`  ${TABLES[table].name.padEnd(18)} ${String(n).padStart(5)} ${verb}`)
  }

  console.info('')
  console.info(
    commit
      ? `[purge] ${total} record(s) deleted from ${targets.length} table(s). Schema untouched.`
      : `[purge] ${total} record(s) would be deleted from ${targets.length} table(s). ` +
          'Re-run with --commit.',
  )
}

main().catch((err) => {
  console.error('[purge] failed', err)
  process.exitCode = 1
})
