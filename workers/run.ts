#!/usr/bin/env tsx
/**
 * Worker CLI.
 *
 *   npm run worker                      list the workers
 *   npm run worker f6-timers            run one
 *   npm run worker f11-import -- file.csv [--commit]
 *
 * Every worker is runnable standalone against the live base — which is what makes the
 * "if Vercel is down, the workers keep running" claim in the spec true rather than
 * aspirational. They talk to Airtable, never to the front-end.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { WORKERS, WORKER_NAMES } from '../src/workers'
import { db } from '../src/lib/data'
import { notifyWorkerFailure } from '../src/lib/notify'
import { commit, detectTarget, dryRun, parseCsv } from '../src/workers/f11-import'
import { GmailNotConfigured, type GmailThread } from '../src/lib/google/gmail'
import { findSpreadsheet, readTab, tabNames } from '../src/lib/google/sheets'
import { qboEnv, refresh, type QboToken } from '../src/lib/quickbooks'
import {
  commitQuickbooks,
  DEFAULT_BATCH_ID as QBO_BATCH_ID,
  planQuickbooks,
} from '../src/workers/c4-quickbooks-seed'
import {
  commitSheets,
  DEFAULT_BATCH_ID as SHEETS_BATCH_ID,
  parseInquirySteps,
  parseReleasedInquiries,
  planSheets,
  type SheetBooking,
} from '../src/workers/c3-sheets-seed'
import {
  commitSweep,
  DEFAULT_BATCH_ID as INBOX_BATCH_ID,
  DEFAULT_QUERY as INBOX_QUERY,
  sweepInbox,
} from '../src/workers/c2-inbox-seed'
import {
  DEFAULT_BATCH_ID as CALENDAR_BATCH_ID,
  extractDeals,
  findDateConflicts,
  matchClient,
  toProposal,
  type CalendarEvent,
} from '../src/workers/c1-calendar-seed'
import {
  commitBookings,
  companyKey,
  DEFAULT_BATCH_ID,
  planBookings,
  type BookingRow,
} from '../src/workers/f11-bookings'

async function main() {
  const [, , name, ...rest] = process.argv

  if (!name) {
    console.info('Workers:')
    for (const key of WORKER_NAMES) {
      const w = WORKERS[key]!
      console.info(`  ${key.padEnd(18)} ${w.title.padEnd(18)} ${w.schedule}`)
    }
    console.info('  f11-import         Import a CSV       (npm run worker f11-import -- file.csv)')
    console.info('  f11-bookings       Bookings master    (npm run worker f11-bookings -- master.csv [reclassified.csv])')
    console.info('  c1-calendar        Calendar seed      (npm run worker c1-calendar -- events.json [--commit])')
    console.info('  c2-inbox           Inbox seed         (npm run worker c2-inbox -- events.json [--limit n] [--commit])')
    console.info('  c3-sheets          Sheets seed        (npm run worker c3-sheets [-- --years 2026,2027] [--commit])')
    console.info('  c4-quickbooks      QuickBooks seed    (npm run worker c4-quickbooks -- token.json [--commit])')
    return
  }

  if (name === 'f11-import') {
    await runImport(rest)
    return
  }

  if (name === 'f11-bookings') {
    await runBookings(rest)
    return
  }

  if (name === 'c1-calendar') {
    await runCalendarSeed(rest)
    return
  }

  if (name === 'c2-inbox') {
    await runInboxSeed(rest)
    return
  }

  if (name === 'c3-sheets') {
    await runSheetsSeed(rest)
    return
  }

  if (name === 'c4-quickbooks') {
    await runQuickbooksSeed(rest)
    return
  }

  const worker = WORKERS[name]
  if (!worker) {
    console.error(`Unknown worker "${name}". Known: ${WORKER_NAMES.join(', ')}`)
    process.exitCode = 1
    return
  }

  const started = Date.now()
  console.info(`[run] ${worker.title} (${worker.name})`)
  try {
    const result = await worker.run()
    console.info(`[run] done in ${Date.now() - started}ms`, result ?? '')
  } catch (err) {
    console.error(`[run] ${worker.name} failed`, err)
    // The same failure path the scheduled run uses: an admin hears about it.
    await notifyWorkerFailure({ worker: worker.name, error: err }).catch(() => undefined)
    process.exitCode = 1
  }
}

async function runImport(args: string[]) {
  const file = args.find((a) => !a.startsWith('--'))
  const shouldCommit = args.includes('--commit')
  if (!file) {
    console.error('Usage: npm run worker f11-import -- <file.csv> [--commit]')
    process.exitCode = 1
    return
  }

  const rows = parseCsv(readFileSync(file, 'utf8'))
  const headers = Object.keys(rows[0] ?? {})
  const target = detectTarget(headers)
  if (!target) {
    console.error(`Could not tell what this file is. Headers seen: ${headers.join(', ')}`)
    process.exitCode = 1
    return
  }

  const report = await dryRun(target, rows)
  console.info(`\nDry run — ${target}`)
  console.info(`  ${report.creates} create · ${report.updates} update · ${report.skips} skip`)
  for (const row of report.rows.slice(0, 20)) {
    const label = row.raw['Deal Name'] ?? row.raw.Email ?? row.raw['Company Name'] ?? '?'
    console.info(`  ${row.action.padEnd(7)} ${String(label).padEnd(42)} ${row.reason}`)
  }
  if (report.rows.length > 20) console.info(`  … ${report.rows.length - 20} more`)

  if (!shouldCommit) {
    console.info('\nNothing was written. Re-run with --commit to apply.')
    return
  }

  const approver = process.env.IMPORT_APPROVER ?? process.env.ADMIN_EMAIL ?? 'cli'
  const { written } = await commit(report, approver)
  console.info(`\nWrote ${written} record(s), approved by ${approver}.`)
}

/**
 * Phase B of the go-live cutover. Dry run by default; the plan is meant to be read by a
 * person (Fable signs off on the diff) before --commit ever runs.
 */
async function runBookings(args: string[]) {
  const files = args.filter((a) => !a.startsWith('--'))
  const [masterFile, reclassifiedFile] = files
  const shouldCommit = args.includes('--commit')
  const batchFlag = args.indexOf('--batch')
  const batchId = batchFlag >= 0 ? (args[batchFlag + 1] ?? DEFAULT_BATCH_ID) : DEFAULT_BATCH_ID

  if (!masterFile) {
    console.error(
      'Usage: npm run worker f11-bookings -- <bookings-master.csv> [reclassified.csv] [--commit] [--batch id]',
    )
    process.exitCode = 1
    return
  }

  const rows = parseCsv(readFileSync(masterFile, 'utf8')) as unknown as BookingRow[]

  // The reclassified sheet overrides "Other/Unclassified" with hand-checked industries.
  const reclassified = new Map<string, string>()
  if (reclassifiedFile) {
    for (const r of parseCsv(readFileSync(reclassifiedFile, 'utf8'))) {
      const name = r.client_organization
      const industry = r.industry
      if (name && industry) reclassified.set(companyKey(name), industry)
    }
  }

  const plan = await planBookings(rows, reclassified, batchId)

  console.info(`\nBookings master — dry run (batch ${plan.batchId})`)
  console.info(`  rows            ${plan.rows}`)
  console.info(
    `  companies       ${plan.companies.create} create · ${plan.companies.update} update`,
  )
  console.info(
    `  contacts        ${plan.contacts.create} create · ${plan.contacts.update} update · ` +
      `${plan.contacts.withoutEmail} named but no email`,
  )
  console.info(
    `  deals           ${plan.deals.create} create · ${plan.deals.update} update · ` +
      `${plan.deals.dateUnverified} with unverified date`,
  )
  console.info(
    `  bureaus         ${plan.bureaus.rawLabels} raw labels → ${plan.bureaus.canonical.length} companies`,
  )
  console.info(`  reclassified    ${reclassified.size} industry overrides loaded`)
  console.info('')
  console.info(`  For Liezel: ${plan.review.needsReviewLane.length} rows need a direct/bureau call`)
  for (const r of plan.review.needsReviewLane) console.info(`    ${r}`)
  console.info(
    `  For enrichment: ${plan.review.unclassifiedIndustry.length} companies still unclassified`,
  )
  for (const w of plan.warnings.slice(0, 10)) console.info(`  ! ${w}`)
  if (plan.warnings.length > 10) console.info(`  ! … ${plan.warnings.length - 10} more warnings`)

  if (!shouldCommit) {
    console.info('\nNothing was written. Re-run with --commit to apply.')
    return
  }

  const approver = process.env.IMPORT_APPROVER ?? process.env.ADMIN_EMAIL ?? 'cli'
  const result = await commitBookings(rows, approver, reclassified, batchId)
  console.info(
    `\nWrote ${result.companies} companies, ${result.contacts} contacts, ` +
      `${result.deals} deals as batch ${result.batchId}, approved by ${approver}.`,
  )
}

/**
 * C1 of the go-live cutover. Takes the raw calendar export (a JSON array of events, as
 * the calendar API returns them) and proposes one deal per booking. Read-only against
 * the calendar in every case; --commit only writes Deal Proposals, never Deals.
 */
async function runCalendarSeed(args: string[]) {
  const file = args.find((a) => !a.startsWith('--'))
  const shouldCommit = args.includes('--commit')
  const todayFlag = args.indexOf('--today')
  const today = todayFlag >= 0 ? args[todayFlag + 1]! : new Date().toISOString().slice(0, 10)

  if (!file) {
    console.error('Usage: npm run worker c1-calendar -- <events.json> [--commit] [--today YYYY-MM-DD]')
    process.exitCode = 1
    return
  }

  const parsed = JSON.parse(readFileSync(file, 'utf8')) as CalendarEvent[] | { events: CalendarEvent[] }
  const events = Array.isArray(parsed) ? parsed : parsed.events
  const deals = extractDeals(events, today)
  const conflicts = findDateConflicts(deals, today)

  const upcoming = deals.filter((d) => !d.historical)
  const historical = deals.filter((d) => d.historical)
  const highConfidence = upcoming.filter((d) => d.confidence >= 0.8)
  const tbd = deals.filter((d) => d.clientUnknown)

  console.info(`\nCalendar seed — dry run (batch ${CALENDAR_BATCH_ID}), today ${today}`)
  console.info(`  events read           ${events.length}`)
  console.info(`  booking-shaped        ${deals.reduce((n, d) => n + d.eventIds.length, 0)}`)
  console.info(`  → distinct deals      ${deals.length}`)
  console.info(`     upcoming           ${upcoming.length}`)
  console.info(`     already delivered  ${historical.length}  (→ historical, no timers)`)
  console.info(`     client still TBD   ${tbd.length}`)
  console.info(`  bulk-acceptable (≥80%) ${highConfidence.length} of ${upcoming.length}`)
  console.info(`  date conflicts        ${conflicts.length}`)
  for (const c of conflicts) {
    console.info(`     ${c.date}  ${c.deals.map((d) => d.client).join('  vs  ')}`)
  }

  const preview = db()
  const previewClients = await preview.listClients()
  const matches = deals.map((d) => matchClient(d.clientUnknown ? null : d.client, previewClients))
  console.info(`  linked to a company   ${matches.filter((m) => m.clientId).length}`)
  console.info(`  ambiguous (for C5)    ${matches.filter((m) => m.reason.startsWith('Ambiguous')).length}`)
  console.info(`  new company proposed  ${matches.filter((m) => m.reason.startsWith('No imported')).length}`)

  if (!shouldCommit) {
    console.info('\nNothing was written. Re-run with --commit to create Deal Proposals.')
    return
  }

  const provider = db()
  const clients = await provider.listClients()
  let written = 0
  let linked = 0
  let ambiguous = 0
  for (const deal of deals) {
    const match = matchClient(deal.clientUnknown ? null : deal.client, clients)
    if (match.clientId) linked += 1
    else if (match.reason.startsWith('Ambiguous')) ambiguous += 1
    await provider.createDealProposal({
      ...toProposal(deal, CALENDAR_BATCH_ID, match),
      createdAt: new Date().toISOString(),
    })
    written += 1
  }
  for (const c of conflicts) {
    await provider.createDateConflict({
      label: `${c.date}: ${c.deals.map((d) => d.client).join(' vs ')}`,
      date: c.date,
      status: 'open',
      proposalIds: [],
      dealIds: [],
      resolution: null,
      resolvedBy: null,
      createdAt: new Date().toISOString(),
    })
  }
  console.info(
    `\nWrote ${written} deal proposal(s) and ${conflicts.length} date conflict(s) as batch ${CALENDAR_BATCH_ID}.` +
      `\n  linked to an imported company: ${linked}` +
      `\n  ambiguous, left for C5:        ${ambiguous}`,
  )
}

/**
 * C2 of the go-live cutover. Reads the calendar export to know what deals exist, sweeps
 * the mailboxes, and reports before it writes. Read-only against Gmail in every case.
 */
async function runInboxSeed(args: string[]) {
  const file = args.find((a) => !a.startsWith('--'))
  const shouldCommit = args.includes('--commit')
  const limitFlag = args.indexOf('--limit')
  const limit = limitFlag >= 0 ? Number(args[limitFlag + 1]) : 200
  const todayFlag = args.indexOf('--today')
  const today = todayFlag >= 0 ? args[todayFlag + 1]! : new Date().toISOString().slice(0, 10)
  // A saved thread fixture stands in for the live mailbox, so the prompts can be tuned
  // against real mail without a Gmail credential and without re-fetching every run.
  const threadsFlag = args.indexOf('--threads')
  const threadsFile = threadsFlag >= 0 ? args[threadsFlag + 1] : undefined
  // Saving the report matters more than it sounds: every re-read of a sweep otherwise
  // re-runs both model passes, so tuning a prompt would keep paying for the same threads.
  const outFlag = args.indexOf('--out')
  const outFile = outFlag >= 0 ? args[outFlag + 1] : undefined

  if (!file) {
    console.error('Usage: npm run worker c2-inbox -- <calendar-events.json> [--threads f.json] [--limit n] [--commit]')
    console.error('  The calendar export is how threads are matched to the deals C1 found.')
    process.exitCode = 1
    return
  }

  const parsed = JSON.parse(readFileSync(file, 'utf8')) as CalendarEvent[] | { events: CalendarEvent[] }
  const events = Array.isArray(parsed) ? parsed : parsed.events
  const deals = extractDeals(events, today)

  console.info(`\nInbox seed — ${shouldCommit ? 'COMMIT' : 'dry run'} (batch ${INBOX_BATCH_ID})`)
  console.info(`  calendar deals to match against  ${deals.length}`)
  console.info(`  query   ${INBOX_QUERY.slice(0, 96)}…`)
  console.info(threadsFile ? `  source  fixture ${threadsFile}` : `  limit   ${limit} thread(s) per mailbox`)
  console.info('')

  let report
  try {
    report = await sweepInbox(deals, {
      limit,
      threads: threadsFile
        ? (JSON.parse(readFileSync(threadsFile, 'utf8')) as GmailThread[])
        : undefined,
    })
  } catch (err) {
    if (err instanceof GmailNotConfigured) {
      console.error(`  Cannot sweep: ${err.message}`)
      process.exitCode = 1
      return
    }
    throw err
  }

  console.info(`  threads fetched        ${report.threads}`)
  console.info(`  skipped as noise       ${report.skippedAsNoise}`)
  console.info(`  classified by model    ${report.classified}`)
  console.info(`  extracted by model     ${report.extracted}`)
  console.info(`  matched to a hold      ${report.matchedToCalendar}`)
  console.info(`  deal-shaped, no hold   ${report.unplaced}`)
  if (report.pausedByCap) console.info('  ! stopped early: the monthly AI cap was reached')
  console.info('')
  console.info('  by intent:')
  for (const [intent, n] of Object.entries(report.byIntent).sort((a, b) => b[1] - a[1])) {
    console.info(`    ${intent.padEnd(14)} ${n}`)
  }

  const withFee = report.outcomes.filter((o) => o.extraction?.negotiatedFee != null).length
  const withLane = report.outcomes.filter((o) => o.extraction?.lane).length
  const withDecision = report.outcomes.filter((o) => o.extraction?.decisionDate).length
  console.info('')
  console.info('  fields the sweep can fill:')
  console.info(`    negotiated fee   ${withFee}`)
  console.info(`    lane             ${withLane}`)
  console.info(`    decision date    ${withDecision}`)

  if (outFile) {
    writeFileSync(outFile, `${JSON.stringify(report, null, 1)}\n`)
    console.info(`\n  report saved → ${outFile}`)
  }

  if (!shouldCommit) {
    console.info('\nNothing was written. Re-run with --commit to apply.')
    return
  }

  const result = await commitSweep(report, INBOX_BATCH_ID)
  console.info(
    `\nEnriched ${result.enriched} proposal(s), created ${result.created}, skipped ${result.skipped}.`,
  )
}

/**
 * C3 of the go-live cutover. Reads Liezel's tracking sheets, reconciles them against the
 * proposals already in the queue, and reports before it writes.
 */
async function runSheetsSeed(args: string[]) {
  const shouldCommit = args.includes('--commit')
  const yearsFlag = args.indexOf('--years')
  const years = (yearsFlag >= 0 ? args[yearsFlag + 1]! : '2026,2027').split(',').map((y) => y.trim())
  const owner = process.env.SHEETS_OWNER ?? 'liezel@bennemtin.com'

  console.info(`\nSheets seed — ${shouldCommit ? 'COMMIT' : 'dry run'} (batch ${SHEETS_BATCH_ID})`)
  console.info(`  reading as  ${owner}`)
  console.info(`  year tabs   ${years.join(', ')}`)

  const trackerId = await findSpreadsheet(owner, 'Client Inquiry Steps')
  const available = await tabNames(owner, trackerId)
  const bookings: SheetBooking[] = []
  for (const year of years) {
    const tab = available.find((t) => t === year || t === `DONE ${year}`)
    if (!tab) {
      console.info(`  ! no tab for ${year} — skipped`)
      continue
    }
    const rows = await readTab(owner, trackerId, tab)
    const parsed = parseInquirySteps(rows, tab)
    console.info(`  ${tab.padEnd(12)} ${String(rows.length).padStart(4)} rows → ${parsed.length} bookings`)
    bookings.push(...parsed)
  }

  const releasedId = await findSpreadsheet(owner, 'Released Inquiries')
  const releasedTabs = await tabNames(owner, releasedId)
  const released = parseReleasedInquiries(await readTab(owner, releasedId, releasedTabs[0]!))
  console.info(`  Released Inquiries  ${released.length} row(s)`)

  const plan = await planSheets(bookings, released)

  const withFee = bookings.filter((b) => b.fee !== null).length
  const withBureau = bookings.filter((b) => b.bureau).length
  console.info('')
  console.info(`  bookings parsed        ${plan.bookings}`)
  console.info(`    carrying a fee       ${withFee}`)
  console.info(`    carrying a bureau    ${withBureau}`)
  console.info(`  matched to a proposal  ${plan.matched.length}`)
  console.info(`  no match in the queue  ${plan.unmatched.length}`)
  console.info(`  released inquiries     ${plan.released.length} new, ${plan.releasedAlreadyProposed} already in the queue`)

  const fills = new Map<string, number>()
  for (const m of plan.matched) for (const f of m.fills) fills.set(f, (fills.get(f) ?? 0) + 1)
  if (fills.size) {
    console.info('')
    console.info('  fields it would fill:')
    for (const [f, n] of [...fills].sort((a, b) => b[1] - a[1])) console.info(`    ${f.padEnd(10)} ${n}`)
  }

  console.info('')
  for (const m of plan.matched.slice(0, 12)) {
    console.info(
      `    ${(m.proposal.clientName ?? m.proposal.title).slice(0, 28).padEnd(28)} ` +
        `${m.booking.eventDate ?? ''}  ${m.fills.join('+')}` +
        (m.booking.fee !== null ? `  ${m.booking.fee.toLocaleString()}` : ''),
    )
  }
  if (plan.matched.length > 12) console.info(`    … ${plan.matched.length - 12} more`)

  if (!shouldCommit) {
    console.info('\nNothing was written. Re-run with --commit to apply.')
    return
  }

  const result = await commitSheets(plan, SHEETS_BATCH_ID)
  console.info(
    `\nEnriched ${result.enriched} proposal(s), created ${result.releasedCreated} released inquiry proposal(s).`,
  )
}

/**
 * C4 of the go-live cutover. Read-only against QuickBooks; every Payment it writes is a
 * proposal for Liezel to confirm.
 */
async function runQuickbooksSeed(args: string[]) {
  const tokenFile = args.find((a) => !a.startsWith('--'))
  const shouldCommit = args.includes('--commit')
  const allowSandbox = args.includes('--allow-sandbox')

  if (!tokenFile) {
    console.error('Usage: npm run worker c4-quickbooks -- <qb-token.json> [--commit] [--allow-sandbox]')
    console.error('  The token file is the one written by quickbooks-mirror/auth-setup.')
    process.exitCode = 1
    return
  }

  const stored = JSON.parse(readFileSync(tokenFile, 'utf8')) as QboToken
  const env = qboEnv()

  console.info(`\nQuickBooks seed — ${shouldCommit ? 'COMMIT' : 'dry run'} (batch ${QBO_BATCH_ID})`)
  console.info(`  environment  ${env}`)
  console.info(`  realm        ${stored.realmId}`)

  // Sandbox figures are Intuit's demo company. Writing them into the money tables of a
  // system Liezel is about to trust would be worse than having no payments at all, so a
  // commit against sandbox has to be asked for explicitly.
  if (env === 'sandbox' && shouldCommit && !allowSandbox) {
    console.error('')
    console.error('  Refusing to commit sandbox data into the money tables.')
    console.error('  Set QB_ENV=production and re-authorise against the real company,')
    console.error('  or pass --allow-sandbox if you are deliberately seeding test figures.')
    process.exitCode = 1
    return
  }

  let token: QboToken
  try {
    token = await refresh(stored)
    writeFileSync(tokenFile, `${JSON.stringify(token, null, 2)}\n`)
    console.info('  token        refreshed and saved back')
  } catch (err) {
    console.error(`  token        ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
    return
  }

  const plan = await planQuickbooks(token)
  console.info('')
  console.info(`  invoices read          ${plan.invoices}`)
  console.info(`  payments read          ${plan.payments}`)
  console.info(`  matched to a deal      ${plan.matched.filter((m) => m.dealId).length}`)
  console.info(`  matched a proposal only ${plan.matched.filter((m) => !m.dealId).length}  (waiting on C5)`)
  console.info(`  no match               ${plan.unmatched.length}`)
  console.info(`  already recorded       ${plan.alreadyRecorded}`)

  for (const m of plan.matched.slice(0, 12)) {
    console.info(
      `    ${(m.invoice.CustomerRef?.name ?? '?').slice(0, 30).padEnd(30)} ` +
        `${String(m.invoice.TotalAmt ?? '?').padStart(9)}  ${m.dealId ? 'deal' : 'proposal'}`,
    )
  }

  if (!shouldCommit) {
    console.info('\nNothing was written. Re-run with --commit to apply.')
    return
  }

  const result = await commitQuickbooks(plan, QBO_BATCH_ID)
  console.info(
    `\nCreated ${result.created} payment proposal(s). ` +
      `${result.skippedNoDeal} wait on their deal, ${result.skippedNoAmount} had no amount.`,
  )
}

void main()
