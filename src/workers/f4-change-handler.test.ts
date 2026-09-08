/**
 * The rule that decides what automation may write.
 *
 * Run Plan rule 3: "Every AI write is a proposal in the Review Queue. No silent fills."
 * These tests exist because the code did the opposite for months and it read as
 * obviously correct while it did.
 */

import { strict as assert } from 'node:assert'
import { after, before, describe, it } from 'node:test'
import { setProvider, type DataProvider } from '@/lib/data'
import { MockProvider } from '@/lib/data/mock'
import { applyExtractions, EXTRACTABLE_FIELDS } from './f4-change-handler'
import type { Deal } from '@/lib/types'

let provider: DataProvider
before(() => {
  provider = new MockProvider()
  setProvider(provider)
})
after(() => setProvider(null))

async function deal(over: Partial<Deal> = {}) {
  return provider.createDeal({ name: 'Fidelity — Summit', stage: 'qualified', ...over } as never)
}

describe('applyExtractions', () => {
  it('proposes a fill instead of writing it', async () => {
    // The old behaviour wrote this straight to the record. A model that reads "we're
    // thinking about the 15th" and fills an empty Event Date has put a confident-looking
    // date on a deal nobody agreed, and the next person cannot tell it from Liezel's.
    const d = await deal({ eventDate: null })
    const result = await applyExtractions({
      deal: d,
      extractions: [{ field: 'eventDate', value: '2026-11-15' }],
    })

    assert.equal(result.proposals.length, 1)
    assert.equal(result.fills, 1)
    assert.deepEqual(result.silentWrites, [])
    assert.equal((await provider.getDeal(d.id))!.eventDate, null, 'the record is untouched')
  })

  it('proposes an overwrite, as it always did', async () => {
    const d = await deal({ eventDate: '2026-11-15' })
    const result = await applyExtractions({
      deal: d,
      extractions: [{ field: 'eventDate', value: '2026-12-01' }],
    })
    assert.equal(result.proposals.length, 1)
    assert.equal(result.fills, 0)
    assert.equal(result.proposals[0]!.oldValue, '2026-11-15')
    assert.equal((await provider.getDeal(d.id))!.eventDate, '2026-11-15')
  })

  it('writes nothing to the deal, whatever the extraction', async () => {
    // The whole rule in one assertion: no path through this function updates a deal.
    const d = await deal({ eventDate: null, location: 'Boston', negotiatedFee: null })
    await applyExtractions({
      deal: d,
      extractions: [
        { field: 'eventDate', value: '2026-11-15' },
        { field: 'location', value: 'Chicago' },
        { field: 'negotiatedFee', value: 42_000 },
      ],
    })
    const after = (await provider.getDeal(d.id))!
    assert.equal(after.eventDate, null)
    assert.equal(after.location, 'Boston')
    assert.equal(after.negotiatedFee, null)
  })

  it('ignores an extraction that agrees with the record', async () => {
    const d = await deal({ location: 'Boston' })
    const result = await applyExtractions({
      deal: d,
      extractions: [{ field: 'location', value: 'Boston' }],
    })
    assert.equal(result.proposals.length, 0)
  })

  it('does not raise the same proposal twice', async () => {
    // A thread read again on the next sweep must not fill the queue with duplicates.
    // A queue where every row appears three times is a queue Liezel stops trusting.
    const d = await deal({ eventDate: null })
    const first = await applyExtractions({
      deal: d,
      extractions: [{ field: 'eventDate', value: '2026-11-15' }],
    })
    const second = await applyExtractions({
      deal: d,
      extractions: [{ field: 'eventDate', value: '2026-11-15' }],
    })
    assert.equal(first.proposals.length, 1)
    assert.equal(second.proposals.length, 0)
  })

  it('refuses a field automation may not touch', async () => {
    const d = await deal()
    const result = await applyExtractions({
      deal: d,
      extractions: [{ field: 'stage' as never, value: 'closed-won' }],
    })
    assert.equal(result.proposals.length, 0)
    assert.equal(EXTRACTABLE_FIELDS.includes('stage' as never), false, 'stage is not extractable')
  })

  it('never lets automation touch money it was not asked about', async () => {
    // negotiatedFee is extractable because a thread quotes a fee; contractStatus and
    // paymentStatus are lookups from the money tables and must never be proposed at all.
    for (const field of ['contractStatus', 'paymentStatus', 'historical', 'kitToken']) {
      assert.equal(EXTRACTABLE_FIELDS.includes(field as never), false, field)
    }
  })
})
