/**
 * Repairs the `agency` field on contacts imported by F11.
 *
 * The first import wrote the bureau *match key* into the field people read, so the base
 * carries "keppler", "harry walker" and "a" where it should carry the bureau's name, and
 * carries Speak, Inc. twice — once as "speak" and once as "Speak, Inc." — because the
 * override map returned a name while the rule returned a key and the two never met.
 *
 * The fix is in `f11-bookings.ts`; this re-derives the field from the same CSV the import
 * read, so the repair and a fresh import produce the same values.
 *
 * Dry run unless --commit. Only ever touches contacts whose current value is one this
 * file explains — a value typed by a person is left alone.
 */

import { readFileSync } from 'node:fs'
import { db } from '../src/lib/data'
import { agentActor, recordChanges } from '../src/lib/audit'
import { parseCsv } from '../src/workers/f11-import'
import {
  bureauKey,
  buildBureauNames,
  normaliseBureau,
  splitEmails,
  type BookingRow,
} from '../src/workers/f11-bookings'

const BATCH_ID = 'repair-bureau-names-2026-09'
const CSV = 'fixtures/seed-2026-09/bookings-master.csv'

async function main() {
  const commit = process.argv.includes('--commit')
  const rows = parseCsv(readFileSync(CSV, 'utf8')) as unknown as BookingRow[]
  const names = buildBureauNames(rows.map((r) => r.agreement_type ?? ''))

  // email → the bureau name the fixed code would write today
  const wanted = new Map<string, string>()
  for (const row of rows) {
    if (row.direct_booking?.trim().toLowerCase() !== 'no') continue
    const name = normaliseBureau(row.agreement_type ?? '', names)
    if (!name) continue
    for (const email of splitEmails(row.contact_emails)) {
      if (!wanted.has(email)) wanted.set(email, name)
    }
  }

  // Every key the old code could have written, so we can tell "wrong" from "typed by hand".
  const oldValues = new Set<string>()
  for (const row of rows) oldValues.add(bureauKey(row.agreement_type ?? '') ?? '')
  oldValues.delete('')

  const contacts = await db().listContacts()
  const changes: { id: string; name: string; from: string; to: string }[] = []
  const unexplained: string[] = []

  for (const c of contacts) {
    const current = c.agency
    if (!current || !c.email) continue
    const target = wanted.get(c.email.toLowerCase())
    if (!target) {
      if (current !== current.trim() || oldValues.has(current)) unexplained.push(`${c.email} — "${current}"`)
      continue
    }
    if (current === target) continue
    // A value this file cannot account for was put there by a person. Leave it.
    if (!oldValues.has(current) && !/^[a-z0-9 ]+$/.test(current)) {
      unexplained.push(`${c.email} — "${current}" (kept)`)
      continue
    }
    changes.push({ id: c.id, name: c.name, from: current, to: target })
  }

  const distinctBefore = new Set(changes.map((c) => c.from))
  const distinctAfter = new Set(changes.map((c) => c.to))
  console.log(`${changes.length} contact(s) to repair`)
  console.log(`  ${distinctBefore.size} wrong value(s) -> ${distinctAfter.size} bureau name(s)`)
  for (const from of [...distinctBefore].sort()) {
    const to = new Set(changes.filter((c) => c.from === from).map((c) => c.to))
    console.log(`  ${String(changes.filter((c) => c.from === from).length).padStart(3)}  ${from}  ->  ${[...to].join(' | ')}`)
  }
  if (unexplained.length > 0) {
    console.log(`\n${unexplained.length} left alone:`)
    for (const u of unexplained.slice(0, 20)) console.log(`  ${u}`)
  }

  if (!commit) {
    console.log('\nDry run. Re-run with --commit to write.')
    return
  }

  let done = 0
  for (const ch of changes) {
    await db().updateContact(ch.id, { agency: ch.to })
    await recordChanges({
      table: 'contacts',
      recordId: ch.id,
      before: { agency: ch.from },
      after: { agency: ch.to },
      actor: agentActor('F11'),
      source: 'Import (bookings master 2026-09)',
      batchId: BATCH_ID,
    })
    done += 1
    if (done % 50 === 0) console.log(`  ${done}/${changes.length}`)
  }
  console.log(`Repaired ${done} contact(s). Batch ${BATCH_ID} — reversible with revert:batch.`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
