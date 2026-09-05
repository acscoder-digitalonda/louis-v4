/**
 * C5 — RECONCILIATION. Turning a Deal Proposal into a real Deal.
 *
 * This is the only door between the Phase C seeds and the live pipeline, and it is
 * always opened by a person. Nothing here runs on a schedule.
 *
 * Accepting does four things, in this order, so a failure never leaves a half-deal:
 *   1. resolve or create the Company (the proposal carries the name the source used)
 *   2. create the Deal, carrying the proposal's batch ID so the whole seed reverses
 *   3. link the proposal to the deal and mark it accepted, with who accepted it
 *   4. write one audit event naming the batch
 *
 * Bulk accept is the same path in a loop rather than a second implementation — the
 * batch session is 99 upcoming deals, and a "fast path" that skipped a step would be
 * exactly the kind of divergence that makes a cutover unrecoverable.
 */

import { db } from '@/lib/data'
import { agentActor, humanActor, recordEvent } from '@/lib/audit'
import { invalidateSearchCache } from '@/lib/search'
import { matchClient } from './c1-calendar-seed'
import type { Deal, DealProposal } from '@/lib/types'

const WORKER = 'C5'

export class ProposalNotFound extends Error {}
export class ProposalAlreadyResolved extends Error {}

/**
 * Accepts one proposal. Returns the deal it created or merged into.
 *
 * @param mergeIntoDealId When set, the proposal enriches an existing deal instead of
 *        creating one — the "merge" verb in the review table, used when Liezel spots
 *        that a calendar hold and an inbox thread are the same booking.
 */
export async function acceptDealProposal(
  proposalId: string,
  approver: string,
  mergeIntoDealId?: string,
): Promise<Deal> {
  const provider = db()
  const proposals = await provider.listDealProposals()
  const proposal = proposals.find((p) => p.id === proposalId)
  if (!proposal) throw new ProposalNotFound(`Deal proposal ${proposalId} not found`)
  if (proposal.status !== 'proposed') {
    throw new ProposalAlreadyResolved(`Proposal ${proposalId} is already ${proposal.status}`)
  }

  const deal = mergeIntoDealId
    ? await mergeInto(mergeIntoDealId, proposal, approver)
    : await createFrom(proposal, approver)

  await provider.updateDealProposal(proposalId, {
    status: mergeIntoDealId ? 'merged' : 'accepted',
    dealId: deal.id,
    resolvedBy: approver,
  })

  invalidateSearchCache()
  return deal
}

async function resolveClientId(proposal: DealProposal): Promise<{ id: string; name: string } | null> {
  const provider = db()
  if (proposal.clientId) {
    const existing = await provider.getClient(proposal.clientId)
    if (existing) return { id: existing.id, name: existing.name }
  }
  if (!proposal.clientName) return null

  // The same matcher the calendar seed uses, not a stricter one of its own. An exact-key
  // match alone would accept "JANNEY" as a new company beside the "Janney Montgomery
  // Scott" that carries seven years of history — a duplicate nobody would notice until
  // the repeat-client count looked wrong.
  const clients = await provider.listClients()
  const match = matchClient(proposal.clientName, clients)
  if (match.clientId) {
    const found = clients.find((c) => c.id === match.clientId)
    if (found) return { id: found.id, name: found.name }
  }

  // Ambiguity is not resolved by picking. Leaving the company unset is recoverable from
  // the deal record; attaching a booking to the wrong Fidelity is not.
  if (match.reason.startsWith('Ambiguous')) {
    await recordEvent({
      table: 'dealProposals',
      recordId: proposal.id,
      what: 'Company left unset',
      detail: match.reason,
      actor: agentActor(WORKER),
      source: proposal.seedSource,
      batchId: proposal.batchId,
    })
    return null
  }

  const created = await provider.createClient({ name: proposal.clientName })
  await recordEvent({
    table: 'clients',
    recordId: created.id,
    what: 'Created from seed',
    detail: `${proposal.seedSource} proposal ${proposal.id}`,
    actor: agentActor(WORKER),
    source: proposal.seedSource,
    batchId: proposal.batchId,
  })
  return { id: created.id, name: created.name }
}

async function createFrom(proposal: DealProposal, approver: string): Promise<Deal> {
  const provider = db()
  const client = await resolveClientId(proposal)

  const deal = await provider.createDeal({
    name: proposal.title,
    stage: proposal.stage,
    source: proposal.lane,
    client,
    eventDate: proposal.eventDate,
    holdDate: proposal.holdDate,
    holdOrder: proposal.holdOrder,
    location: proposal.location,
    negotiatedFee: proposal.negotiatedFee,
    decisionDate: proposal.decisionDate,
    historical: proposal.historical,
    importBatch: proposal.batchId,
    sourceRef: proposal.sourceRef,
    kickoffNotes: proposal.notes,
  })

  await recordEvent({
    table: 'deals',
    recordId: deal.id,
    what: 'Accepted from seed',
    detail: `${proposal.seedSource} proposal ${proposal.id}, accepted by ${approver}`,
    actor: humanActor(approver),
    source: proposal.seedSource,
    batchId: proposal.batchId,
    reversible: true,
  })
  return deal
}

/** Only fills blanks. A seed never overwrites something a human already put there. */
async function mergeInto(dealId: string, proposal: DealProposal, approver: string): Promise<Deal> {
  const provider = db()
  const existing = await provider.getDeal(dealId)
  if (!existing) throw new ProposalNotFound(`Deal ${dealId} not found`)

  const patch: Partial<Deal> = {}
  if (!existing.eventDate && proposal.eventDate) patch.eventDate = proposal.eventDate
  if (!existing.holdDate && proposal.holdDate) patch.holdDate = proposal.holdDate
  if (existing.holdOrder === null && proposal.holdOrder !== null) patch.holdOrder = proposal.holdOrder
  if (!existing.location && proposal.location) patch.location = proposal.location
  if (existing.negotiatedFee === null && proposal.negotiatedFee !== null) {
    patch.negotiatedFee = proposal.negotiatedFee
  }
  if (!existing.decisionDate && proposal.decisionDate) patch.decisionDate = proposal.decisionDate
  if (!existing.sourceRef && proposal.sourceRef) patch.sourceRef = proposal.sourceRef

  const deal = Object.keys(patch).length > 0 ? await provider.updateDeal(dealId, patch) : existing

  await recordEvent({
    table: 'deals',
    recordId: deal.id,
    what: 'Merged from seed',
    detail:
      `${proposal.seedSource} proposal ${proposal.id} merged by ${approver}; ` +
      `filled ${Object.keys(patch).length || 'no'} blank field(s)`,
    actor: humanActor(approver),
    source: proposal.seedSource,
    batchId: proposal.batchId,
    reversible: true,
  })
  return deal
}

export async function dismissDealProposal(proposalId: string, approver: string): Promise<void> {
  const provider = db()
  const proposal = (await provider.listDealProposals()).find((p) => p.id === proposalId)
  if (!proposal) throw new ProposalNotFound(`Deal proposal ${proposalId} not found`)

  await provider.updateDealProposal(proposalId, { status: 'dismissed', resolvedBy: approver })
  await recordEvent({
    table: 'dealProposals',
    recordId: proposalId,
    what: 'Dismissed',
    detail: `${proposal.seedSource} proposal dismissed by ${approver}`,
    actor: humanActor(approver),
    source: proposal.seedSource,
    batchId: proposal.batchId,
  })
}

/**
 * Accepts the first proposal and folds the rest into the deal it creates.
 *
 * Seeding from the calendar, both mailboxes and Liezel's tracker means one booking can
 * arrive three times — Janney turns up four times in the current queue. Accepting each
 * separately would put four deals in the pipeline for one event, and nothing downstream
 * would ever notice.
 *
 * The first id is the one whose values win, so the caller passes them in the order the
 * person chose. The rest only fill blanks, which is what `mergeInto` already does: an
 * inbox thread can supply the fee a calendar hold never had, and cannot overwrite the
 * date the calendar was surer about.
 */
export async function acceptAndMerge(
  ids: string[],
  approver: string,
): Promise<{ deal: Deal; merged: string[]; failed: { id: string; error: string }[] }> {
  const [primary, ...rest] = ids
  if (!primary) throw new ProposalNotFound('No proposal given to accept')

  const deal = await acceptDealProposal(primary, approver)
  const merged: string[] = []
  const failed: { id: string; error: string }[] = []

  for (const id of rest) {
    try {
      await acceptDealProposal(id, approver, deal.id)
      merged.push(id)
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  console.info(`[${WORKER}] merged ${merged.length} proposal(s) into ${deal.id}`)
  return { deal, merged, failed }
}

export interface BulkResult {
  accepted: string[]
  failed: { id: string; error: string }[]
}

/**
 * Bulk accept. Keeps going past a failure and reports both lists, because stopping the
 * session on row 40 of 99 to debug one bad row is worse than finishing and fixing it.
 */
export async function acceptMany(ids: string[], approver: string): Promise<BulkResult> {
  const result: BulkResult = { accepted: [], failed: [] }
  for (const id of ids) {
    try {
      await acceptDealProposal(id, approver)
      result.accepted.push(id)
    } catch (err) {
      result.failed.push({ id, error: err instanceof Error ? err.message : String(err) })
    }
  }
  console.info(
    `[${WORKER}] bulk accept: ${result.accepted.length} accepted, ${result.failed.length} failed`,
  )
  return result
}
