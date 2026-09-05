/**
 * F11 bookings master import — the entry point for WP4.2 Phase B.
 *
 * Dry run unless --commit, which is the contract the runbook sets: a person reads the
 * plan, then approves it. `--by` names that person in the audit trail.
 *
 * It also prints the three lists the mapping doc asks to be surfaced rather than guessed
 * at — unclassified industries, rows flagged `needs_review`, and rows crediting two
 * bureaus. Until now `planBookings` computed them and nothing ever showed them.
 */

import { readFileSync, existsSync } from 'node:fs'
import { parseCsv } from '../src/workers/f11-import'
import { planBookings, commitBookings, DEFAULT_BATCH_ID, type BookingRow } from '../src/workers/f11-bookings'

const CSV = 'fixtures/seed-2026-09/bookings-master.csv'
const RECLASSIFIED = 'Louis-AddOn-Handoff-Package/louis-addon-handoff/seeds/louis-reclassified-companies.csv'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

function list(label: string, items: string[], limit = 25) {
  if (items.length === 0) return
  console.log(`\n${label} (${items.length}):`)
  for (const i of items.slice(0, limit)) console.log(`  ${i}`)
  if (items.length > limit) console.log(`  … and ${items.length - limit} more`)
}

async function main() {
  const commit = process.argv.includes('--commit')
  const approver = arg('by')
  if (commit && !approver) {
    console.error('--commit needs --by="Name" — the audit trail records who approved it.')
    process.exitCode = 1
    return
  }

  const rows = parseCsv(readFileSync(CSV, 'utf8')) as unknown as BookingRow[]

  // Industry reclassifications Liezel supplied, keyed by company.
  const reclassified = new Map<string, string>()
  if (existsSync(RECLASSIFIED)) {
    const { companyKey } = await import('../src/workers/f11-bookings')
    for (const r of parseCsv(readFileSync(RECLASSIFIED, 'utf8')) as Record<string, string>[]) {
      const name = r.company ?? r.client_organization ?? r.name
      const industry = r.industry ?? r.new_industry
      if (name && industry) reclassified.set(companyKey(name), industry)
    }
  }

  const batchId = arg('batch') ?? DEFAULT_BATCH_ID
  const plan = await planBookings(rows, reclassified, batchId)

  console.log(`Bookings master: ${plan.rows} row(s), batch ${plan.batchId}`)
  console.log(`  companies  ${plan.companies.create} new, ${plan.companies.update} existing`)
  console.log(`  contacts   ${plan.contacts.create} new, ${plan.contacts.update} existing, ${plan.contacts.withoutEmail} named but no address`)
  console.log(`  deals      ${plan.deals.create} new, ${plan.deals.update} existing, ${plan.deals.dateUnverified} with an unverified date`)
  console.log(`  bureaus    ${plan.bureaus.rawLabels} raw label(s) -> ${plan.bureaus.canonical.length} bureau(s)`)

  list('For Liezel — bureau credited to two agencies', plan.review.ambiguousBureau)
  list('For Liezel — lane flagged needs_review', plan.review.needsReviewLane)
  list('For Liezel — industry unclassified', plan.review.unclassifiedIndustry)
  list('Warnings', plan.warnings)

  if (!commit) {
    console.log('\nDry run. Re-run with --commit --by="Name" to write.')
    return
  }

  const result = await commitBookings(rows, approver!, reclassified, batchId)
  console.log(
    `\nImported ${result.companies} company/ies, ${result.contacts} contact(s), ${result.deals} deal(s).`,
  )
  console.log(`Batch ${result.batchId} — reversible with: npm run revert:batch -- ${result.batchId}`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
