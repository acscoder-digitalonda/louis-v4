/**
 * F4 — EMAIL-CHANGE HANDLER. The rule that decides what automation may write.
 *
 * **Every extraction becomes a proposal.** Filling a blank and overwriting a value are
 * both proposals, both visible in the Review Queue, both accepted or dismissed by a
 * person. Nothing a model extracts reaches a live record on its own.
 *
 * ── Why this changed, and what it cost to keep the old way ─────────────────
 *
 * v3 had an asymmetry that reads as obviously correct: filling a blank cannot destroy
 * information, so fill it silently and only propose an overwrite. The Run Plan's rule 3
 * overrides it — *"Every AI write is a proposal in the Review Queue. No silent fills
 * (this tightens the earlier F4 rule)"* — and SpeakerOS puts it more plainly: nothing an
 * agent writes reaches a live record without review.
 *
 * The argument for the tightening is not about destroying data. It is that a silent fill
 * is **invisible**, and an invisible wrong answer is worse than a visible one: a model
 * that reads "we're thinking about the 15th" and fills an empty Event Date has put a
 * confident-looking date on a deal nobody agreed, and the next person to look has no way
 * to tell it from a date Liezel typed. The inbox sweep produced exactly this class of
 * confident nonsense on its first run — sixteen matches, three of them real.
 *
 * The cost is that Liezel accepts more rows. That is the trade the rule makes, and it is
 * the right way round: an extra click is cheaper than an unnoticed wrong date.
 */

import { db } from '@/lib/data'
import { notify } from '@/lib/notify'
import { fieldLabel } from '@/lib/audit'
import { invalidateSearchCache } from '@/lib/search'
import type { Deal, FieldProposal } from '@/lib/types'

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
  /**
   * Kept in the shape, always empty, and named so anyone reading a caller sees the rule
   * rather than an absence. Removing the key would make "no silent writes happened" and
   * "this version does not do silent writes" look identical at the call site.
   */
  silentWrites: never[]
  proposals: FieldProposal[]
  /** Proposals that fill a blank, as opposed to changing an existing value. */
  fills: number
}

export async function applyExtractions(params: {
  deal: Deal
  extractions: Extraction[]
  sourceEmailId?: string | null
}): Promise<ApplyResult> {
  const provider = db()
  const result: ApplyResult = { silentWrites: [], proposals: [], fills: 0 }

  // A re-read of the same thread must not raise the same proposal twice. Liezel working
  // through a queue where every row appears three times is a queue she stops trusting.
  const open = await provider.listProposals('proposed')

  for (const extraction of params.extractions) {
    if (!EXTRACTABLE_FIELDS.includes(extraction.field)) continue

    const current = params.deal[extraction.field]
    const currentStr = current === null || current === undefined ? null : String(current)
    const nextStr = String(extraction.value)
    if (currentStr === nextStr) continue

    const duplicate = open.some(
      (p) =>
        p.dealId === params.deal.id && p.field === extraction.field && p.newValue === nextStr,
    )
    if (duplicate) continue

    const isFill = currentStr === null || currentStr === ''
    if (isFill) result.fills += 1

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

  if (result.proposals.length > 0) {
    await notify({
      type: 'review-item',
      title: `${result.proposals.length} field change(s) proposed — ${params.deal.name}`,
      body: result.proposals
        .map((p) => `${p.fieldLabel}: ${p.oldValue ?? '(empty)'} → ${p.newValue}`)
        .join('\n'),
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
