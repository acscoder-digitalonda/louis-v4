#!/usr/bin/env tsx
/**
 * The mailboxes intake sweeps.
 *
 *   npm run seed:mail-accounts                dry run
 *   npm run seed:mail-accounts -- --apply     write them
 *
 * `resolveAccounts` reads this table first and falls back to an env var only when it is
 * empty. The table was empty, the env var was unset, and the sweep therefore resolved
 * zero accounts and returned in a millisecond looking exactly like a quiet morning.
 *
 * Scope is **label**, not full mailbox: an install that reads every message in somebody's
 * inbox is a surprise nobody asked for. Ben and Liezel apply `louis-intake` to what they
 * want swept. `speaking@` is the public inquiry address, so its whole mailbox is fair
 * game — everything arriving there is already addressed to the business.
 */

import { createRecords, listRecords, readConfig } from '../src/lib/airtable/rest'
import { fieldRef } from '../src/lib/airtable/fields'

const ACCOUNTS = [
  { address: 'speaking@bennemtin.com', label: 'Public inquiries', scope: 'Full mailbox', watchedLabel: 'louis-intake', lookbackDays: 2 },
  { address: 'liezel@bennemtin.com', label: 'Liezel', scope: 'Watched label', watchedLabel: 'louis-intake', lookbackDays: 2 },
  { address: 'b@bennemtin.com', label: 'Ben', scope: 'Watched label', watchedLabel: 'louis-intake', lookbackDays: 2 },
  { address: 'team@bennemtin.com', label: 'Team', scope: 'Watched label', watchedLabel: 'louis-intake', lookbackDays: 2 },
]

async function main() {
  const apply = process.argv.includes('--apply')
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  const existing = new Set(
    (await listRecords(cfg, 'mailAccounts'))
      .map((r) => String(r.fields[fieldRef('mailAccounts', 'address')] ?? '').toLowerCase())
      .filter(Boolean),
  )
  const fresh = ACCOUNTS.filter((a) => !existing.has(a.address))

  console.log(`Mail Accounts: ${existing.size} present, ${fresh.length} to add.`)
  for (const a of fresh) {
    console.log(`  + ${a.address.padEnd(26)} ${a.scope}${a.scope === 'Watched label' ? ` (${a.watchedLabel})` : ''}`)
  }

  if (fresh.length === 0) return
  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.')
    return
  }

  await createRecords(
    cfg,
    'mailAccounts',
    fresh.map((a) => ({
      [fieldRef('mailAccounts', 'address')]: a.address,
      [fieldRef('mailAccounts', 'label')]: a.label,
      [fieldRef('mailAccounts', 'scope')]: a.scope,
      [fieldRef('mailAccounts', 'watchedLabel')]: a.watchedLabel,
      [fieldRef('mailAccounts', 'lookbackDays')]: a.lookbackDays,
      [fieldRef('mailAccounts', 'active')]: true,
    })),
  )
  console.log(`\nSeeded ${fresh.length} mail account(s).`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
