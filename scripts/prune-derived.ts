#!/usr/bin/env tsx
/**
 * Deletes derived rows that no longer describe anything true.
 *
 *   npm run prune:derived                 dry run
 *   npm run prune:derived -- --apply      delete
 *
 * Two tables, both rebuilt by the workers that own them:
 *
 *   **Mirror State** — one row per deal per surface, recording the last push. Every row
 *   in it is a failure recorded while F9 was pushing seven years of imported bookings at
 *   Google, which it no longer does. Left alone they are 150 findings in the QA digest
 *   every night, for ever.
 *
 *   **Emails** — duplicates created while `Emails.messageId` was declared, written, and
 *   silently dropped by the encoder, so every sweep re-ingested every message. The
 *   earliest copy of each is kept.
 *
 * Nothing here touches a deal, a company, a contact or a proposal.
 */

import { deleteRecords, listRecords, readConfig } from '../src/lib/airtable/rest'
import { fieldRef } from '../src/lib/airtable/fields'

async function main() {
  const apply = process.argv.includes('--apply')
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  // ── Mirror State ────────────────────────────────────────────────────────
  const mirror = await listRecords(cfg, 'mirrorState')
  const failed = mirror.filter((r) => !r.fields[fieldRef('mirrorState', 'ok')])
  console.log(`Mirror State   ${mirror.length} row(s), ${failed.length} recording a failure`)

  // ── Emails ──────────────────────────────────────────────────────────────
  const emails = await listRecords(cfg, 'emails')
  const seen = new Map<string, string>()
  const dupes: string[] = []
  for (const r of [...emails].sort((a, b) => (a.createdTime ?? '').localeCompare(b.createdTime ?? ''))) {
    // These rows predate the messageId fix, so identity has to come from the content.
    const key = [
      r.fields[fieldRef('emails', 'threadId')],
      r.fields[fieldRef('emails', 'subject')],
      r.fields[fieldRef('emails', 'from')],
      r.fields[fieldRef('emails', 'receivedAt')],
    ].join('|')
    if (seen.has(key)) dupes.push(r.id)
    else seen.set(key, r.id)
  }
  console.log(`Emails         ${emails.length} row(s), ${seen.size} distinct, ${dupes.length} duplicate`)

  const total = failed.length + dupes.length
  if (total === 0) {
    console.log('\nNothing to prune.')
    return
  }
  if (!apply) {
    console.log(`\n${total} row(s) would be deleted. Re-run with --apply.`)
    return
  }

  if (failed.length > 0) await deleteRecords(cfg, 'mirrorState', failed.map((r) => r.id))
  if (dupes.length > 0) await deleteRecords(cfg, 'emails', dupes)
  console.log(`\nDeleted ${failed.length} mirror row(s) and ${dupes.length} duplicate email(s).`)
  console.log('Both tables are rebuilt by the workers that own them.')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
