#!/usr/bin/env tsx
/**
 * C3 — the entry point for Liezel's tracking sheets.
 *
 *   npm run seed:sheets                          dry run
 *   npm run seed:sheets -- --apply               write the proposals
 *   npm run seed:sheets -- --sheet="Inquiry Steps 2026"
 *
 * The third script written to close the same gap. `planSheets` and `commitSheets` were
 * written, tested and reachable from nowhere, exactly like the bookings import and the
 * QuickBooks seed before them — and in every case the code was run once from a scratch
 * file that no longer exists, so nobody could repeat it or see what it decided.
 *
 * The Google helpers had the same problem from the other side: `findSpreadsheet`,
 * `tabNames` and `readTab` are imported by nothing. This is what joins them up.
 *
 * ── What it reads ──────────────────────────────────────────────────────────
 *
 * Two shapes in one workbook. The inquiry-steps tabs are a printed page rather than a
 * table: month rows repeat the column headings and act as section headings, and the
 * client sits in whichever column the month was written in. The released-inquiry tab is
 * a normal table whose header can start anywhere.
 *
 * Both parsers already know this and are tested against it. What was missing was
 * something to hand them the rows.
 */

import { findSpreadsheet, readTab, tabNames } from '../src/lib/google/sheets'
import {
  commitSheets,
  parseInquirySteps,
  parseReleasedInquiries,
  planSheets,
  DEFAULT_BATCH_ID,
  type ReleasedInquiry,
  type SheetBooking,
} from '../src/workers/c3-sheets-seed'

const DEFAULT_SUBJECT = process.env.GOOGLE_SHEETS_SUBJECT ?? 'liezel@bennemtin.com'

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
}

/** A tab that holds bookings. The year in the name is what dates the rows. */
function yearOf(tab: string): string | null {
  return tab.match(/20\d{2}/)?.[0] ?? null
}

async function main() {
  const apply = process.argv.includes('--apply')
  const subject = arg('as') ?? DEFAULT_SUBJECT
  const sheetName = arg('sheet') ?? 'Inquiry Steps'

  let spreadsheetId: string
  try {
    spreadsheetId = arg('id') ?? (await findSpreadsheet(subject, sheetName))
  } catch (err) {
    console.error(`Could not find a sheet named "${sheetName}" in ${subject}'s Drive.`)
    console.error(String(err).slice(0, 200))
    console.error('\nPass --id=<spreadsheetId> to skip the search, or --as=<email> to look')
    console.error('in a different mailbox. The service account impersonates, so it only')
    console.error('sees what that person can see.')
    process.exitCode = 1
    return
  }

  const tabs = await tabNames(subject, spreadsheetId)
  console.log(`${sheetName}\n  ${tabs.length} tab(s): ${tabs.join(', ')}\n`)

  const bookings: SheetBooking[] = []
  const released: ReleasedInquiry[] = []

  for (const tab of tabs) {
    const rows = await readTab(subject, spreadsheetId, tab)
    if (rows.length === 0) {
      console.log(`  ${tab.padEnd(28)} empty`)
      continue
    }

    // Released inquiries are a different shape from bookings, and the tab name is the
    // only thing that says which. Guessing from the contents would be cleverer and would
    // fail silently the first time somebody renames a column.
    if (/release/i.test(tab)) {
      const parsed = parseReleasedInquiries(rows)
      released.push(...parsed)
      console.log(`  ${tab.padEnd(28)} ${parsed.length} released inquiry/ies`)
      continue
    }

    const year = yearOf(tab)
    if (!year) {
      // The tab year dates every row on it, including the ones whose cell year is
      // mistyped. Without it the dates would be wrong in a way nobody would notice.
      console.log(`  ${tab.padEnd(28)} skipped — no year in the tab name`)
      continue
    }
    const parsed = parseInquirySteps(rows, year)
    bookings.push(...parsed)
    console.log(`  ${tab.padEnd(28)} ${parsed.length} booking(s)`)
  }

  console.log(`\n${bookings.length} booking(s), ${released.length} released inquiry/ies.\n`)

  const plan = await planSheets(bookings, released)
  console.log(`Rows read from the sheets          ${plan.bookings}`)
  console.log(`Matched to a proposal in the queue ${plan.matched.length}`)
  console.log(`Matched nothing                    ${plan.unmatched.length}`)
  console.log(`Released inquiries                 ${plan.released.length}`)
  console.log(`  already in the queue             ${plan.releasedAlreadyProposed}`)

  // What a match would actually fill in. The sheets carry fees and lanes that the
  // calendar and the inbox never had, which is the entire reason this seed exists.
  const fills = new Map<string, number>()
  for (const m of plan.matched) for (const f of m.fills) fills.set(f, (fills.get(f) ?? 0) + 1)
  if (fills.size > 0) {
    console.log(`\nFields the sheets would fill:`)
    for (const [field, n] of [...fills].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${field}`)
    }
  }

  if (plan.unmatched.length > 0) {
    console.log(`\nFor Liezel — sheet rows with no proposal to attach to:`)
    for (const b of plan.unmatched.slice(0, 15)) {
      console.log(`  · ${b.client} — ${b.eventDate ?? 'no date'}${b.fee ? `, ${b.fee}` : ''}`)
    }
    if (plan.unmatched.length > 15) console.log(`  … and ${plan.unmatched.length - 15} more`)
    console.log('  Matched on client name *and* a nearby date. A name-only match would')
    console.log('  attach a March fee to a November booking for the same client.')
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.')
    return
  }

  const batch = arg('batch') ?? DEFAULT_BATCH_ID
  const result = await commitSheets(plan, batch)
  console.log(`\nEnriched ${result.enriched} proposal(s), created ${result.releasedCreated} released inquiry/ies.`)
  console.log(`Batch ${batch} — reversible with revert:batch.`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
