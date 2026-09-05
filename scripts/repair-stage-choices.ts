#!/usr/bin/env tsx
/**
 * One-off repair: the first migration run wrote Stage as the domain key ("pre-event")
 * instead of the Airtable label ("Pre-Event"). With `typecast: true` Airtable does not
 * reject an unknown option — it *creates* it, so the field ended up with both spellings.
 *
 * This rewrites every record onto the canonical label, then prunes the options that are
 * no longer used. Kept in the repo because the same trap catches any import that trusts
 * typecast with a select field.
 *
 *   npm run repair:stages            # dry run
 *   npm run repair:stages -- --apply
 */

import { fieldRef, tableRef } from '../src/lib/airtable/fields'
import {
  listRecords,
  readConfig,
  updateRecord,
  listBaseTables,
  type AirtableConfig,
} from '../src/lib/airtable/rest'
import { stageCodec } from '../src/lib/data/airtable-codec'
import { ALL_STAGES } from '../src/lib/stages'
import type { StageKey } from '../src/lib/types'

const APPLY = process.argv.includes('--apply')

/** The seven labels the schema defines, in order. */
const CANONICAL = ALL_STAGES.map((s) => stageCodec.toAirtable(s))

async function main() {
  const cfg = readConfig()
  if (!cfg) throw new Error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set')

  const stageRef = fieldRef('deals', 'stage')
  const records = await listRecords(cfg, 'deals')

  const wrong = records.filter((r) => {
    const raw = r.fields[stageRef]
    return typeof raw === 'string' && !CANONICAL.includes(raw)
  })

  console.info(`${records.length} deal(s); ${wrong.length} using a non-canonical Stage label.`)
  for (const r of wrong) {
    const raw = String(r.fields[stageRef])
    const key = stageCodec.fromAirtable(raw, 'inquiry') as StageKey
    console.info(`  ${raw}  →  ${stageCodec.toAirtable(key)}`)
    if (APPLY) {
      await updateRecord(cfg, 'deals', r.id, { [stageRef]: stageCodec.toAirtable(key) })
    }
  }

  if (!APPLY) {
    console.info('\nDry run. Re-run with --apply.')
    return
  }

  await pruneChoices(cfg)
}

/** Removes select options that no record uses. Airtable refuses to drop one in use. */
async function pruneChoices(cfg: AirtableConfig) {
  const tables = await listBaseTables(cfg)
  const deals = tables.find((t) => t.id === tableRef('deals') || t.name === 'Deals')
  const field = deals?.fields.find((f) => f.id === fieldRef('deals', 'stage') || f.name === 'Stage')
  if (!deals || !field) throw new Error('Could not find Deals.Stage')

  const choices = (field.options?.choices ?? []) as { id: string; name: string; color?: string }[]
  const keep = choices.filter((c) => CANONICAL.includes(c.name))
  const drop = choices.filter((c) => !CANONICAL.includes(c.name))
  if (drop.length === 0) {
    console.info('\nNo stray options to remove.')
    return
  }

  // The update-field endpoint accepts `name` and `description` only — select options
  // cannot be edited through the API at all. The records are now correct, so these
  // options are unused and the Airtable UI will let you delete them.
  console.info(`\n${keep.length} canonical option(s) kept.`)
  console.info(`${drop.length} stray option(s) are now unused but must be removed by hand:`)
  for (const c of drop) console.info(`  · ${c.name}`)
  console.info(
    `\n  Deals → Stage → Customize field type → delete each greyed-out option.\n` +
      `  Cosmetic only: every record already uses the canonical label, and the app\n` +
      `  decodes case-insensitively either way.`,
  )
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
