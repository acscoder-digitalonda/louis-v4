#!/usr/bin/env tsx
/**
 * Reverses one batch as a unit — the promise the go-live runbook makes about every
 * phase it writes ("Any batch can be reversed as a unit").
 *
 *   npm run revert:batch                              list the batches
 *   npm run revert:batch -- import-history-2026-09    dry run
 *   npm run revert:batch -- import-history-2026-09 --apply
 *
 * ── What it can and cannot undo ────────────────────────────────────────────
 *
 * **Creations are fully reversible.** Every record a batch created carries its batch ID,
 * either on the record itself (`Deals.Import Batch`, `Deal Proposals.Batch ID`) or in the
 * Audit Log entry that recorded the write. Those are deleted.
 *
 * **Changes in place depend on how they were logged.** `recordChanges` diffs before
 * against after, so each field lands with the value it replaced and can be put back.
 * `recordEvent` writes `oldValue: null` — it records *that* something was written, never
 * what it held before, and nothing can recover that.
 *
 * The first inbox batch was written with `recordEvent`, so its 37 enrichments are stuck.
 * The worker now uses `recordChanges`, so later batches reverse completely. This script
 * reports the two groups separately rather than blurring them: a rollback that silently
 * leaves changes behind is worse than one that says exactly where it stopped.
 *
 * ── The safety that matters ────────────────────────────────────────────────
 *
 * A batch is refused if any proposal in it has already been accepted. Deleting an
 * accepted proposal would leave a real Deal in the pipeline pointing at nothing, which is
 * a worse state than the one being rolled back.
 */

import { db } from '../src/lib/data'
import { deleteRecords, readConfig } from '../src/lib/airtable/rest'
import { TABLES, type TableKey } from '../src/lib/airtable/schema'

/** Audit `field` values that mean "this batch brought this record into existence". */
const CREATION_EVENTS = new Set([
  'Imported',
  'Proposed from inbox',
  'Created from seed',
  'Accepted from seed',
])

/** Children before parents, so nothing is left pointing at a deleted record. */
const DELETE_ORDER: TableKey[] = [
  'dealProposals',
  'dateConflicts',
  'deals',
  'contacts',
  'clients',
]

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const batchId = args.find((a) => !a.startsWith('--'))

  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  const provider = db()
  const audit = await provider.listAudit(undefined, 20_000)
  const batched = audit.filter((a) => a.batchId)

  if (!batchId) {
    const counts = new Map<string, number>()
    for (const a of batched) counts.set(a.batchId!, (counts.get(a.batchId!) ?? 0) + 1)
    console.info('Batches in the audit log:\n')
    for (const [id, n] of [...counts].sort((a, b) => b[1] - a[1])) {
      console.info(`  ${id.padEnd(30)} ${String(n).padStart(5)} audit row(s)`)
    }
    console.info('\nPass one to see what reversing it would do.')
    return
  }

  const rows = batched.filter((a) => a.batchId === batchId)
  if (rows.length === 0) {
    console.error(`No audit rows for batch "${batchId}".`)
    process.exitCode = 1
    return
  }

  // What the batch created, grouped by table.
  const created = new Map<TableKey, Set<string>>()
  /** Field-level changes the audit captured well enough to put back. */
  const restorable: { table: TableKey; recordId: string; key: string; oldValue: string | null }[] = []
  /** Field-level changes it did not. */
  const lost: { entity: string; recordId: string; detail: string | null }[] = []

  for (const a of rows) {
    if (CREATION_EVENTS.has(a.field)) {
      const table = a.entity as TableKey
      const set = created.get(table) ?? new Set<string>()
      set.add(a.entityId)
      created.set(table, set)
      continue
    }

    // A diffed write records the field's label and the value it replaced; an event-only
    // write records neither. Only the first can be put back.
    const table = a.entity as TableKey
    const spec = TABLES[table]
    const field = spec?.fields.find((f) => f.name === a.field)
    if (field && !field.computed) {
      restorable.push({ table, recordId: a.entityId, key: field.key, oldValue: a.oldValue })
    } else {
      lost.push({ entity: a.entity, recordId: a.entityId, detail: a.newValue })
    }
  }

  console.info(`Batch ${batchId}`)
  console.info(`Mode: ${apply ? 'APPLY — records will be deleted' : 'dry run'}\n`)

  console.info('Created by this batch (reversible):')
  let total = 0
  for (const table of DELETE_ORDER) {
    const ids = created.get(table)
    if (!ids?.size) continue
    console.info(`  ${table.padEnd(16)} ${String(ids.size).padStart(5)}`)
    total += ids.size
  }
  if (total === 0) console.info('  (nothing)')

  if (restorable.length > 0) {
    console.info(`\nChanged in place, and the old value was captured (reversible): ${restorable.length}`)
    const byField = new Map<string, number>()
    for (const r of restorable) byField.set(`${r.table}.${r.key}`, (byField.get(`${r.table}.${r.key}`) ?? 0) + 1)
    for (const [f, n] of byField) console.info(`    ${f.padEnd(28)} ${n}`)
  }

  if (lost.length > 0) {
    console.info(`\nChanged in place, old value NOT captured (cannot be reversed): ${lost.length}`)
    console.info('  The audit recorded that these were written, but not what they held')
    console.info('  before. Those values stay as they are. Records affected:')
    const byEntity = new Map<string, number>()
    for (const e of lost) byEntity.set(e.entity, (byEntity.get(e.entity) ?? 0) + 1)
    for (const [ent, n] of byEntity) console.info(`    ${ent.padEnd(16)} ${n}`)
  }

  // Safety: never orphan an accepted proposal.
  const proposalIds = created.get('dealProposals')
  if (proposalIds?.size) {
    const proposals = await provider.listDealProposals()
    const resolved = proposals.filter(
      (p) => proposalIds.has(p.id) && p.status !== 'proposed',
    )
    if (resolved.length > 0) {
      console.info('')
      console.error(
        `Refusing: ${resolved.length} proposal(s) in this batch have already been ` +
          `resolved (${[...new Set(resolved.map((p) => p.status))].join(', ')}).`,
      )
      console.error('Deleting them would leave accepted deals pointing at nothing.')
      console.error('Dismiss or unwind those individually first.')
      process.exitCode = 1
      return
    }
  }

  if (!apply) {
    console.info(
      `\nDry run. ${total} record(s) would be deleted` +
        (restorable.length ? `, ${restorable.length} field(s) put back` : '') +
        '. Re-run with --apply.',
    )
    return
  }

  let deleted = 0
  for (const table of DELETE_ORDER) {
    const ids = created.get(table)
    if (!ids?.size) continue
    const n = await deleteRecords(cfg, table, [...ids])
    deleted += n
    console.info(`  deleted ${String(n).padStart(5)} from ${table}`)
  }

  // Field restores run after deletions: a field on a record the batch also created is
  // gone with the record, and putting it back first would just be a wasted write.
  const deletedIds = new Set([...created.values()].flatMap((s) => [...s]))
  let restored = 0
  for (const r of restorable) {
    if (deletedIds.has(r.recordId)) continue
    try {
      if (r.table === 'dealProposals') {
        await provider.updateDealProposal(r.recordId, { [r.key]: r.oldValue } as never)
      } else if (r.table === 'deals') {
        await provider.updateDeal(r.recordId, { [r.key]: r.oldValue } as never)
      } else {
        continue
      }
      restored += 1
    } catch (err) {
      console.warn(`  ! ${r.table}.${r.key} on ${r.recordId}: ${err instanceof Error ? err.message : err}`)
    }
  }

  console.info(`\nReversed ${deleted} of ${total} record(s) for batch ${batchId}.`)
  if (restored > 0) console.info(`Put back ${restored} field value(s).`)
  if (lost.length > 0) {
    console.info(`${lost.length} in-place change(s) remain — see the list above.`)
  }
  console.info('The audit rows are left in place: they are the record that this happened.')
}

main().catch((err) => {
  console.error('[revert:batch] failed', err)
  process.exitCode = 1
})
