#!/usr/bin/env tsx
/**
 * Removes the deals created for a manual walkthrough, and everything hanging off them.
 *
 *   npm run cleanup:test                 dry run — lists what would go
 *   npm run cleanup:test -- --apply      delete
 *
 * A test deal is one whose name starts with "TEST " — the walkthrough guide names them
 * that way on purpose, so this can never match a real booking. Removes the deal, its
 * tasks, drafts, coaching sessions, mirror rows, the contact created for it, and the
 * company if nothing else points at it. The audit log keeps its rows: it is append-only
 * by design, and "a test deal was made and removed" is a true thing that happened.
 *
 * Goes through REST rather than the provider because the provider has no delete for
 * deals — real deals are never deleted, only closed.
 */

import { deleteRecords, listRecords, readConfig } from '../src/lib/airtable/rest'
import { fieldRef } from '../src/lib/airtable/fields'

const PREFIX = 'TEST '

async function main() {
  const apply = process.argv.includes('--apply')
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  const name = (t: 'deals' | 'clients' | 'contacts', r: { fields: Record<string, unknown> }) =>
    String(r.fields[fieldRef(t, 'name')] ?? '')
  const links = (r: { fields: Record<string, unknown> }, ref: string) =>
    (r.fields[ref] as string[] | undefined) ?? []

  const deals = (await listRecords(cfg, 'deals')).filter((r) => name('deals', r).startsWith(PREFIX))
  const dealIds = new Set(deals.map((r) => r.id))
  console.log(`${deals.length} test deal(s):`)
  for (const d of deals) console.log(`   ${d.id}  ${name('deals', d).slice(0, 70)}`)
  if (deals.length === 0) return

  const hangingOff = async (table: 'tasks' | 'drafts' | 'coachingSessions' | 'mirrorState', dealField: string) => {
    const rows = await listRecords(cfg, table)
    return rows.filter((r) => {
      const v = r.fields[fieldRef(table, dealField)]
      const ids = Array.isArray(v) ? (v as string[]) : typeof v === 'string' ? [v] : []
      return ids.some((id) => dealIds.has(id)) || (table === 'mirrorState' && [...dealIds].some((id) => String(v ?? '').includes(id)))
    })
  }
  const tasks = await hangingOff('tasks', 'dealId')
  const drafts = await hangingOff('drafts', 'dealId')
  const sessions = await hangingOff('coachingSessions', 'dealId')
  const mirror = await hangingOff('mirrorState', 'entity')

  // Contacts and companies created for the test — by name, and only if every deal they
  // touch is a test deal, so a real contact who happened to be linked is left alone.
  const contacts = (await listRecords(cfg, 'contacts')).filter(
    (r) => name('contacts', r).startsWith(PREFIX) && links(r, fieldRef('contacts', 'dealIds')).every((id) => dealIds.has(id)),
  )
  const clients = (await listRecords(cfg, 'clients')).filter(
    (r) => name('clients', r).startsWith(PREFIX) && links(r, fieldRef('clients', 'dealIds')).every((id) => dealIds.has(id)),
  )

  console.log(`\n   ${tasks.length} task(s) · ${drafts.length} draft(s) · ${sessions.length} coaching session(s) · ${mirror.length} mirror row(s)`)
  console.log(`   ${contacts.length} contact(s): ${contacts.map((c) => name('contacts', c)).join(', ') || '—'}`)
  console.log(`   ${clients.length} company/ies: ${clients.map((c) => name('clients', c)).join(', ') || '—'}`)

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to delete.')
    return
  }

  const del = async (table: Parameters<typeof deleteRecords>[1], rows: { id: string }[]) => {
    if (rows.length) await deleteRecords(cfg, table, rows.map((r) => r.id))
  }
  await del('tasks', tasks)
  await del('drafts', drafts)
  await del('coachingSessions', sessions)
  await del('mirrorState', mirror)
  await del('deals', deals)
  await del('contacts', contacts)
  await del('clients', clients)
  console.log('\nDeleted. The audit log keeps its rows on purpose.')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
