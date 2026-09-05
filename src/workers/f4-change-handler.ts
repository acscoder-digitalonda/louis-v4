/**
 * F4 — EMAIL-CHANGE HANDLER. The rule that decides what automation may write.
 *
 * Empty field + extracted value  → write it silently, log it, surface it as a
 *                                  "recent auto-update" chip on the deal.
 * Existing field + different value → NEVER silent. It becomes a Proposal
 *                                  (old → new, with the source email) in the Review
 *                                  Queue, plus a notification. Accept writes + audits;
 *                                  dismiss is logged too.
 *
 * The asymmetry is the whole point: filling a blank cannot destroy information, and
 * overwriting a human's value can.
 */

import { db } from '@/lib/data'
import { notify } from '@/lib/notify'
import { agentActor, fieldLabel, recordChanges } from '@/lib/audit'
import { invalidateSearchCache } from '@/lib/search'
import type { Deal, FieldProposal } from '@/lib/types'

const WORKER = 'F4'

/** Deal fields automation is allowed to touch at all. */
export const EXTRACTABLE_FIELDS = [
  'eventDate',
  'location',
  'avCheckTime',
  'stageTime',
  'hotel',
  'travelNotes',
  'audienceProfile',
  'desiredOutcomes',
  'negotiatedFee',
  'decisionDate',
  'holdDate',
  'eventUrl',
] as const

export type ExtractableField = (typeof EXTRACTABLE_FIELDS)[number]

export interface Extraction {
  field: ExtractableField
  value: string | number
  confidence?: number
}

export interface ApplyResult {
  silentWrites: { field: string; value: string }[]
  proposals: FieldProposal[]
}

export async function applyExtractions(params: {
  deal: Deal
  extractions: Extraction[]
  sourceEmailId?: string | null
}): Promise<ApplyResult> {
  const provider = db()
  const result: ApplyResult = { silentWrites: [], proposals: [] }
  const silentPatch: Record<string, unknown> = {}

  for (const extraction of params.extractions) {
    if (!EXTRACTABLE_FIELDS.includes(extraction.field)) continue

    const current = params.deal[extraction.field]
    const currentStr = current === null || current === undefined ? null : String(current)
    const nextStr = String(extraction.value)
    if (currentStr === nextStr) continue

    if (currentStr === null || currentStr === '') {
      silentPatch[extraction.field] = extraction.value
      result.silentWrites.push({ field: extraction.field, value: nextStr })
    } else {
      result.proposals.push(
        await provider.createProposal({
          dealId: params.deal.id,
          field: extraction.field,
          fieldLabel: fieldLabel('deals', extraction.field),
          oldValue: currentStr,
          newValue: nextStr,
          sourceEmailId: params.sourceEmailId ?? null,
          status: 'proposed',
          createdAt: new Date().toISOString(),
          resolvedBy: null,
          confidence: extraction.confidence ?? null,
        }),
      )
    }
  }

  if (Object.keys(silentPatch).length > 0) {
    await provider.updateDeal(params.deal.id, silentPatch)
    await recordChanges({
      table: 'deals',
      recordId: params.deal.id,
      before: params.deal as unknown as Record<string, unknown>,
      after: silentPatch,
      actor: agentActor(WORKER),
      source: params.sourceEmailId ?? null,
    })
  }

  if (result.proposals.length > 0) {
    await notify({
      type: 'review-item',
      title: `${result.proposals.length} field change(s) proposed — ${params.deal.name}`,
      body: result.proposals.map((p) => `${p.fieldLabel}: ${p.oldValue} → ${p.newValue}`).join('\n'),
      link: '/queue',
      roles: ['ops', 'admin'],
    })
  }

  invalidateSearchCache()
  return result
}

/** Review Queue: accept. Writes the value and audits it against the approving human. */
export async function acceptProposal(proposalId: string, approver: string): Promise<void> {
  const provider = db()
  const proposal = await provider.getProposal(proposalId)
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`)
  if (proposal.status !== 'proposed') return

  const deal = await provider.getDeal(proposal.dealId)
  if (!deal) throw new Error(`Deal ${proposal.dealId} not found`)

  const value = coerce(proposal.field, proposal.newValue)
  await provider.updateDeal(deal.id, { [proposal.field]: value } as Partial<Deal>)
  await provider.updateProposal(proposalId, { status: 'accepted', resolvedBy: approver })

  await provider.appendAudit({
    entity: 'deals',
    entityId: deal.id,
    field: proposal.fieldLabel,
    oldValue: proposal.oldValue,
    newValue: proposal.newValue,
    actor: approver,
    actorKind: 'human',
    source: proposal.sourceEmailId,
    batchId: null,
    at: new Date().toISOString(),
    reversible: true,
  })
  invalidateSearchCache()
}

/** Review Queue: dismiss. A rejection is information too, so it is logged. */
export async function dismissProposal(proposalId: string, approver: string): Promise<void> {
  const provider = db()
  const proposal = await provider.getProposal(proposalId)
  if (!proposal || proposal.status !== 'proposed') return

  await provider.updateProposal(proposalId, { status: 'dismissed', resolvedBy: approver })
  await provider.appendAudit({
    entity: 'proposals',
    entityId: proposalId,
    field: `${proposal.fieldLabel} (dismissed)`,
    oldValue: proposal.oldValue,
    newValue: proposal.newValue,
    actor: approver,
    actorKind: 'human',
    source: proposal.sourceEmailId,
    batchId: null,
    at: new Date().toISOString(),
    reversible: false,
  })
}

function coerce(field: string, value: string): string | number {
  if (field === 'negotiatedFee') {
    const n = Number(value.replace(/[^\d.]/g, ''))
    return Number.isFinite(n) ? n : value
  }
  return value
}
