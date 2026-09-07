#!/usr/bin/env tsx
/**
 * C4 — the entry point for the QuickBooks payment seed.
 *
 *   npm run seed:quickbooks             dry run
 *   npm run seed:quickbooks -- --apply  write the payment proposals
 *
 * It exists because `planQuickbooks` and `commitQuickbooks` were written, tested and
 * then reachable from nowhere — the same gap the bookings import had, where the plan
 * computed two review lists for Liezel that no checked-in script ever printed.
 *
 * ── Every payment is a proposal ────────────────────────────────────────────
 *
 * The runbook is unambiguous: "Liezel confirms each payment; nothing is marked Paid by a
 * machine." So this writes `status: 'proposed'` and there is no code path here that sets
 * anything else.
 *
 * ── It will tell you when it is reading the sandbox ────────────────────────
 *
 * `QB_ENV` defaults to sandbox, which is Intuit's test company and not Ben's books.
 * Numbers from there look exactly like real ones, so the environment is printed at the
 * top, printed again at the bottom, and written into every proposal's note.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { planQuickbooks, commitQuickbooks, DEFAULT_BATCH_ID } from '../src/workers/c4-quickbooks-seed'
import { qboEnv, refresh, type QboToken } from '../src/lib/quickbooks'

const TOKEN_FILE = process.env.QB_TOKEN_FILE ?? '.qb-token.json'

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
}

async function main() {
  const apply = process.argv.includes('--apply')
  const file = arg('token') ?? TOKEN_FILE

  if (!existsSync(file)) {
    console.error(`No token at ${file}.`)
    console.error('QuickBooks needs a person to click Allow on Intuit\'s consent screen while')
    console.error('signed in to the real company. No amount of code substitutes for that.')
    process.exitCode = 1
    return
  }

  const stored = JSON.parse(readFileSync(file, 'utf8')) as QboToken

  // Intuit rotates the refresh token on every refresh and kills the old one, so a copy
  // that sat unused while another process refreshed is dead rather than stale. Persist
  // what comes back or this works exactly once.
  const token = await refresh(stored)
  writeFileSync(file, `${JSON.stringify(token, null, 2)}\n`)

  const env = qboEnv()
  console.log(`QuickBooks environment: ${env.toUpperCase()}`)
  if (env === 'sandbox') {
    console.log('That is Intuit\'s test company, not Ben\'s books. The figures below are not real.')
  }
  console.log('')

  const plan = await planQuickbooks(token)
  console.log(`${plan.invoices} invoice(s), ${plan.payments} payment(s) read.`)
  console.log(`  ${plan.matched.length} matched to a deal or proposal`)
  console.log(`  ${plan.unmatched.length} could not be placed`)
  console.log(`  ${plan.alreadyRecorded} already recorded against an invoice number\n`)

  const waiting = plan.matched.filter((m) => !m.dealId)
  if (waiting.length > 0) {
    console.log(`${waiting.length} invoice(s) match a proposal that is not yet an accepted deal.`)
    console.log('A payment can only link to a deal, so these are skipped. Re-run after the')
    console.log('reconciliation session and they land.\n')
  }

  if (plan.unmatched.length > 0) {
    console.log('For Liezel — invoices with no matching client:')
    for (const inv of plan.unmatched.slice(0, 15)) {
      console.log(`  · ${inv.CustomerRef?.name ?? '(no customer)'} — ${inv.DocNumber ?? inv.Id}, ${inv.TotalAmt ?? '?'}`)
    }
    if (plan.unmatched.length > 15) console.log(`  … and ${plan.unmatched.length - 15} more`)
    console.log('  Matched on an exact normalised name only. Attaching money to the nearest')
    console.log('  thing is the one error here nobody would catch by reading the queue.\n')
  }

  if (!apply) {
    console.log('Dry run. Re-run with --apply to write the payment proposals.')
    return
  }

  const result = await commitQuickbooks(plan, arg('batch') ?? DEFAULT_BATCH_ID)
  console.log(`\nWrote ${result.created} payment proposal(s).`)
  console.log(`  ${result.skippedNoDeal} waiting for their deal to be accepted`)
  console.log(`  ${result.skippedNoAmount} with no invoice amount`)
  console.log(`\nEvery one is 'proposed'. Liezel confirms each payment; nothing is Paid by a machine.`)
  if (env === 'sandbox') {
    console.log('\nREMINDER: these came from the Intuit sandbox and are not real money.')
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
