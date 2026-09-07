#!/usr/bin/env tsx
/**
 * WP0.2 migration — moves stored records off the v3 stage vocabulary.
 *
 *   npm run migrate:stages             dry run — prints every change
 *   npm run migrate:stages -- --apply  write it
 *
 * ── Why this is safe to run late, and why it should not be ─────────────────
 *
 * The app already reads the old labels: `stageCodec` carries `Sales → qualified` and
 * `Dormant → closed-lost` as read aliases, so nothing is broken while the stored values
 * are stale. This migration is what makes the stored value agree with what the app says,
 * so that a person reading Airtable directly sees the same pipeline the app does.
 *
 * The reason to run it *now* rather than after the C5 session is cost. A proposal is a
 * row with no children: changing its stage is one field write. Once accepted it is a deal
 * with tasks, drafts, timers, an audit trail and a calendar event hanging off it, and the
 * same change means re-firing packets and re-rendering the calendar.
 *
 * ── The two mappings, and why they are not symmetrical ─────────────────────
 *
 * `Dormant → Closed Lost` is mechanical, and it gains something: every released inquiry
 * carries `Reason: …` in its notes, so the migration also fills Closed Lost Reason, which
 * is the key WP1.7's twelve-month campaign segments on. Nothing is invented — a reason
 * the classifier cannot place becomes `Other`, not a guess.
 *
 * `Sales → Qualified` is a decision, and the conservative one. SpeakerOS splits selling
 * into Qualified (a hold is out, 50%) and Firm Offer (a priced offer is out, 95%). A v3
 * record does not record which, so promoting on a guess would move the forecast from 50
 * to 95 on deals nobody has quoted. Everything lands at Qualified. Rows that *do* carry a
 * fee are listed at the end so a person can promote them deliberately — that is a
 * judgement about whether an offer went out, and it is Ben's, not this script's.
 *
 * Reversible as a batch: every write is logged with the batch id below.
 */

import { db } from '../src/lib/data'
import { agentActor, recordChanges } from '../src/lib/audit'
import { classifyReleaseReason } from '../src/workers/c3-sheets-seed'
import { fieldRef } from '../src/lib/airtable/fields'
import { listRecords, readConfig } from '../src/lib/airtable/rest'
import { stageCodec } from '../src/lib/data/airtable-codec'
import { stageByKey } from '../speaker.config'
import type { ClosedLostReason, DealProposal, StageKey } from '../src/lib/types'

const BATCH_ID = 'migrate-stages-v2-2026-09'
const WORKER = 'WP0.2'

interface Change {
  id: string
  title: string
  /** The label actually stored in Airtable right now, not the decoded value. */
  fromLabel: string
  to: StageKey
  reason: ClosedLostReason | null
  reasonText: string | null
  fee: number | null
}

/** The reason a released inquiry was lost, as C3 wrote it into the notes. */
function reasonFromNotes(notes: string | null): string | null {
  return notes?.match(/Reason:\s*(.+?)(?:\n|$)/)?.[1]?.trim() ?? null
}

async function main() {
  const apply = process.argv.includes('--apply')
  const provider = db()
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }
  const proposals = await provider.listDealProposals()

  // The raw label, straight off the record. The decoded `stage` cannot be used to detect
  // the work: `stageCodec` maps `Sales` to `qualified` on read, so comparing decoded to
  // decoded reports "nothing to do" on exactly the 105 rows that need writing. The whole
  // point of this script is the gap between what is stored and what is read.
  const rawStage = new Map<string, string>()
  for (const r of await listRecords(cfg, 'dealProposals')) {
    const v = r.fields[fieldRef('dealProposals', 'stage')]
    if (typeof v === 'string') rawStage.set(r.id, v)
  }

  const changes: Change[] = []
  for (const p of proposals) {
    const target = p.stage
    const stored = rawStage.get(p.id) ?? ''
    const canonical = stageCodec.toAirtable(target)

    const reasonText = target === 'closed-lost' ? reasonFromNotes(p.notes) : null
    const reason = target === 'closed-lost' ? classifyReleaseReason(reasonText) : null

    const stageMoves = stored !== canonical
    const reasonMoves = Boolean(reason) && p.closedLostReason !== reason
    if (!stageMoves && !reasonMoves) continue

    changes.push({
      id: p.id,
      title: p.title,
      fromLabel: stored || '(empty)',
      to: target,
      reason,
      reasonText,
      fee: p.negotiatedFee,
    })
  }

  report(proposals, changes)

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.')
    return
  }

  let done = 0
  for (const c of changes) {
    // Always write the stage: that is what creates the new select option (typecast) and
    // what moves the stored value off `Sales`.
    const patch: Partial<DealProposal> = { stage: c.to }
    if (c.reason) patch.closedLostReason = c.reason

    await provider.updateDealProposal(c.id, patch)
    await recordChanges({
      table: 'dealProposals',
      recordId: c.id,
      before: { stage: c.fromLabel, closedLostReason: null },
      after: { stage: stageCodec.toAirtable(c.to), closedLostReason: c.reason },
      actor: agentActor(WORKER),
      source: 'WP0.2 stage engine v2',
      batchId: BATCH_ID,
    })
    done += 1
    if (done % 50 === 0) console.log(`  ${done}/${changes.length}`)
  }

  console.log(`\nMigrated ${done} proposal(s). Batch ${BATCH_ID} — reversible with revert:batch.`)
  console.log('The Qualified / Firm Offer / Closed Lost options now exist on the Stage')
  console.log('select; Sales and Dormant can be pruned with `npm run repair:stages`.')
}

function report(all: DealProposal[], changes: Change[]) {
  const label = (s: StageKey) => stageByKey.get(s)?.label ?? s
  console.log(`${all.length} proposal(s); ${changes.length} to migrate.\n`)

  const byMove = new Map<string, Change[]>()
  for (const c of changes) {
    const k = `${c.fromLabel} -> ${label(c.to)}`
    byMove.set(k, [...(byMove.get(k) ?? []), c])
  }
  for (const [move, list] of [...byMove].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(list.length).padStart(4)}  ${move}`)
  }

  const lost = changes.filter((c) => c.to === 'closed-lost')
  if (lost.length > 0) {
    console.log(`\nClosed Lost Reason, parsed from the notes of ${lost.length} released inquiry/ies:`)
    const buckets = new Map<string, number>()
    for (const c of lost) buckets.set(c.reason ?? '(none found)', (buckets.get(c.reason ?? '(none found)') ?? 0) + 1)
    for (const [r, n] of [...buckets].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(4)}  ${r}`)
    }
  }

  // The judgement this script refuses to make on anyone's behalf.
  const priced = changes.filter((c) => c.to === 'qualified' && c.fee !== null)
  if (priced.length > 0) {
    console.log(
      `\n${priced.length} of these carry a fee. They land at Qualified (50%) like the rest.`,
    )
    console.log('If an offer actually went out, promote to Firm Offer (95%) by hand:')
    for (const c of priced.slice(0, 15)) {
      console.log(`  · ${c.title} — ${c.fee?.toLocaleString()}`)
    }
    if (priced.length > 15) console.log(`  … and ${priced.length - 15} more`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
