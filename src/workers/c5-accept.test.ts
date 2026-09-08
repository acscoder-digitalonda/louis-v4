/**
 * The accept path, and the race the read cache introduced.
 *
 * The C5 reconciliation session is two people working one queue of 245 proposals at the
 * same time. That is the exact shape a stale read breaks.
 */

import { strict as assert } from 'node:assert'
import { after, before, describe, it } from 'node:test'
import { setProvider, type DataProvider } from '@/lib/data'
import { MockProvider } from '@/lib/data/mock'
import { setProviderRunner } from '@/lib/gateway'
import { acceptDealProposal, acceptMany, ProposalAlreadyResolved } from './c5-accept'
import type { DealProposal } from '@/lib/types'

let provider: DataProvider
before(() => {
  provider = new MockProvider()
  setProvider(provider)
  setProviderRunner(async () => ({ text: '{}', tokensIn: 1, tokensOut: 1, estimated: true }))
})
after(() => {
  setProvider(null)
  setProviderRunner(null)
})

async function proposal(over: Partial<DealProposal> = {}) {
  return provider.createDealProposal({
    title: 'Fidelity — keynote',
    seedSource: 'calendar',
    batchId: 'test',
    status: 'proposed',
    confidence: 0.8,
    clientName: 'Fidelity',
    clientId: null,
    contactName: null,
    contactId: null,
    closedLostReason: null,
    stage: 'qualified',
    lane: 'direct',
    eventDate: '2026-11-01',
    holdDate: '2026-11-01',
    holdOrder: 1,
    location: 'Boston',
    negotiatedFee: 40_000,
    decisionDate: null,
    historical: false,
    sourceRef: 'cal:1',
    sources: '',
    notes: null,
    dealId: null,
    resolvedBy: null,
    createdAt: new Date().toISOString(),
    ...over,
  } as never)
}

describe('accepting a proposal', () => {
  it('creates one deal and marks the proposal accepted', async () => {
    const p = await proposal()
    const deal = await acceptDealProposal(p.id, 'liezel@bennemtin.com')
    assert.equal(deal.name, 'Fidelity — keynote')

    const after = (await provider.listDealProposals()).find((x) => x.id === p.id)!
    assert.equal(after.status, 'accepted')
    assert.equal(after.dealId, deal.id)
    assert.equal(after.resolvedBy, 'liezel@bennemtin.com')
  })

  it('refuses the second accept of the same proposal', async () => {
    // The race the fresh read exists for: two people, one queue. Without it both see
    // `proposed` and one proposal becomes two deals, with nothing erroring.
    const p = await proposal()
    await acceptDealProposal(p.id, 'liezel@bennemtin.com')
    await assert.rejects(
      () => acceptDealProposal(p.id, 'ben@bennemtin.com'),
      ProposalAlreadyResolved,
    )
  })

  it('leaves exactly one deal behind after a double accept', async () => {
    const p = await proposal({ title: 'Only once' } as never)
    await acceptDealProposal(p.id, 'liezel@bennemtin.com')
    await acceptDealProposal(p.id, 'ben@bennemtin.com').catch(() => undefined)
    const made = (await provider.listDeals()).filter((d) => d.name === 'Only once')
    assert.equal(made.length, 1)
  })

  it('carries the batch id, so a whole seed reverses as one', async () => {
    const p = await proposal({ batchId: 'seed-calendar-2026-09' } as never)
    const deal = await acceptDealProposal(p.id, 'liezel@bennemtin.com')
    assert.equal(deal.importBatch, 'seed-calendar-2026-09')
  })
})

describe('acceptMany', () => {
  it('keeps going past a failure and reports both lists', async () => {
    // Stopping on row 40 of 99 to debug one bad row is worse than finishing and fixing it.
    const good = await proposal({ title: 'Good one' } as never)
    const already = await proposal({ title: 'Already done' } as never)
    await acceptDealProposal(already.id, 'liezel@bennemtin.com')

    const result = await acceptMany([good.id, already.id, 'recNOPE'], 'liezel@bennemtin.com')
    assert.equal(result.accepted.length, 1)
    assert.equal(result.failed.length, 2)
    for (const f of result.failed) assert.ok(f.error.length > 0)
  })
})
