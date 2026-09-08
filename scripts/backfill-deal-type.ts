#!/usr/bin/env tsx
/**
 * Backfills Deal Type on the imported history.
 *
 *   npm run backfill:dealtype             dry run
 *   npm run backfill:dealtype -- --apply  write it
 *
 * WP0.1 made Deal Type a first-class field with three values, and the 802 deals loaded
 * from the bookings master carry none: the source file has no such column, because in
 * 2019 there was nothing else to be. So "how many keynotes have we delivered" answers
 * zero, and the Deal Type filter WP2.1 asks for has nothing to filter.
 *
 * Every row gets `Keynote`, with one deliberate exception to the sweep: rows whose title
 * says workshop, full day or bootcamp are listed rather than assumed. In Jordan's model a
 * workshop is an add-on line item on a keynote deal, not a deal type of its own — so they
 * are almost certainly Keynote too. Almost certainly is not the same as checked, and four
 * rows is a two-minute read for Liezel.
 *
 * Nothing here touches a deal that already has a type, and nothing touches a live deal:
 * only `historical` rows from the import batch, so a re-run after the C5 session cannot
 * reach in and stamp a real deal.
 */

import { readFileSync } from 'node:fs'
import { db } from '../src/lib/data'
import { agentActor, recordChangesMany, type AuditWrite } from '../src/lib/audit'
import { parseCsv } from '../src/workers/f11-import'
import type { Deal } from '../src/lib/types'

const BATCH_ID = 'backfill-dealtype-2026-09'
const WORKER = 'WP0.1'

/** Titles that describe something other than a plain keynote. */
const NEEDS_A_LOOK = /\b(workshop|bootcamp|3rc)\b|\b(full|half)[ -]day\b/i

const CSV = 'fixtures/seed-2026-09/bookings-master.csv'

/**
 * The three title columns of the source row, joined, keyed by `event_id`.
 *
 * Matching the deal *name* is not enough: the import built the name from `event_title`
 * alone, so TaxJar arrived as "TAXJAR [REMOTE]" and its `event_name` — "TaxJar Holiday
 * Workshop" — never reached Airtable. Reading the source row back is the only way to see
 * what the deal actually was. Scanning every column instead would be worse: it matches a
 * company called CoachHub and four keynotes delivered at training events.
 */
function sourceTitles(): Map<string, string> {
  const out = new Map<string, string>()
  for (const r of parseCsv(readFileSync(CSV, 'utf8')) as Record<string, string>[]) {
    const id = (r.event_id ?? '').trim()
    if (!id) continue
    out.set(id, [r.event_title, r.event_name, r.event_theme].filter(Boolean).join(' · '))
  }
  return out
}

async function main() {
  const apply = process.argv.includes('--apply')
  const provider = db()
  const deals = await provider.listDeals()

  const titles = sourceTitles()
  const describes = (d: Deal) =>
    `${d.name} ${d.sourceRef ? (titles.get(d.sourceRef) ?? '') : ''}`

  const candidates = deals.filter((d) => d.historical && !d.dealType)
  const flagged = candidates.filter((d) => NEEDS_A_LOOK.test(describes(d)))
  const plain = candidates.filter((d) => !NEEDS_A_LOOK.test(describes(d)))

  const alreadyTyped = deals.filter((d) => d.historical && d.dealType).length
  const live = deals.filter((d) => !d.historical).length

  console.log(`${deals.length} deal(s): ${live} live (untouched), ${deals.length - live} historical.`)
  console.log(`  ${alreadyTyped} already carry a Deal Type — left alone.`)
  console.log(`  ${candidates.length} to set to Keynote, of which ${flagged.length} are flagged below.\n`)

  if (flagged.length > 0) {
    console.log('For Liezel — these say workshop, full day or bootcamp in the title.')
    console.log('They are being set to Keynote on the reading that a workshop is an add-on')
    console.log('line item, not a deal type. Correct any that are not:\n')
    for (const d of flagged) {
      const src = d.sourceRef ? titles.get(d.sourceRef) : null
      console.log(`  · ${d.name}`)
      if (src && !d.name.includes(src)) console.log(`      source row: ${src}`)
    }
    console.log('')
  }

  if (!apply) {
    console.log('Dry run. Re-run with --apply to write.')
    return
  }

  // One audit row per record, but written ten to a request rather than one at a time.
  // Doing it the other way is what exhausted a month of Airtable quota in a day: this
  // script alone was 802 updates plus 802 audit writes, where 160 requests would do.
  const audits: AuditWrite[] = []
  let done = 0

  for (const d of [...plain, ...flagged]) {
    await provider.updateDeal(d.id, { dealType: 'keynote' } satisfies Partial<Deal>)
    audits.push({
      table: 'deals',
      recordId: d.id,
      before: { dealType: null },
      after: { dealType: 'Keynote' },
      actor: agentActor(WORKER),
      source: 'Import (bookings master 2026-09)',
      batchId: BATCH_ID,
    })
    done += 1
    if (done % 100 === 0) console.log(`  ${done}/${candidates.length}`)
  }

  const rows = await recordChangesMany(audits)
  console.log(`\nSet Deal Type on ${done} deal(s), ${rows} audit row(s) written in batches.`)
  console.log(`Batch ${BATCH_ID} — reversible with revert:batch.`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
