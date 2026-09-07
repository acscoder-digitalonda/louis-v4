import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  FULFILLMENT_FLOW,
  digestFor,
  fulfillmentFor,
  isOpen,
  leadDays,
  needsFulfillment,
  nudgesFor,
  shipBy,
  stepIndex,
} from './fulfillment'
import type { Fulfillment, FulfillmentStatus } from './types'

const TODAY = '2026-09-07'

const rec = (over: Partial<Fulfillment> = {}) =>
  ({
    id: 'f1',
    lineItemId: 'li1',
    dealId: 'd1',
    status: 'Mentioned' as FulfillmentStatus,
    quantity: 500,
    shipBy: null,
    carrier: null,
    tracking: null,
    warehouseNotes: null,
    slackThread: null,
    notes: null,
    ...over,
  }) as Fulfillment

describe('the status flow', () => {
  it('runs from Mentioned to Dropship Complete without gaps', () => {
    assert.equal(FULFILLMENT_FLOW[0], 'Mentioned')
    assert.equal(new Set(FULFILLMENT_FLOW).size, FULFILLMENT_FLOW.length, 'no duplicates')
    assert.ok(stepIndex('Ordered') < stepIndex('Shipped'))
  })

  it('treats everything before Delivered as open work', () => {
    // A record that closes early is a record nobody chases, which is how 2,000 journals
    // get remembered four weeks out instead of five.
    for (const s of ['Mentioned', 'Interested', 'Ordered', 'Shipped'] as const) {
      assert.equal(isOpen(rec({ status: s })), true, s)
    }
    for (const s of ['Delivered', 'Dropship Complete'] as const) {
      assert.equal(isOpen(rec({ status: s })), false, s)
    }
  })
})

describe('needsFulfillment', () => {
  it('is only for physical products', () => {
    assert.equal(needsFulfillment({ physical: true }), true)
    assert.equal(needsFulfillment({ physical: false }), false, 'a workshop ships nothing')
  })
})

describe('leadDays and shipBy', () => {
  it('gives a bigger run more time', () => {
    assert.equal(leadDays(100), 30)
    assert.equal(leadDays(500), 35)
    assert.equal(leadDays(2_000), 45)
  })

  it('defaults to a month when the quantity is unknown', () => {
    for (const q of [null, 0, -5]) assert.equal(leadDays(q), 30, String(q))
  })

  it('counts back from the event date', () => {
    assert.equal(shipBy({ eventDate: '2026-12-01' }, 2_000), '2026-10-17')
    assert.equal(shipBy({ eventDate: '2026-12-01' }, 100), '2026-11-01')
  })

  it('has no answer without an event date', () => {
    assert.equal(shipBy({ eventDate: null }, 500), null)
  })
})

describe('nudgesFor', () => {
  it('raises a red when an order exists and the warehouse has not been told', () => {
    // The one that loses runs: the order is real, and nobody is making anything.
    const n = nudgesFor(rec({ status: 'Ordered' }), TODAY)
    assert.ok(n.some((x) => x.kind === 'ordered-not-notified' && x.severity === 'red'))
  })

  it('escalates as the ship-by date closes in', () => {
    const amber = nudgesFor(rec({ status: 'Interested', shipBy: '2026-09-19' }), TODAY)
    assert.equal(amber.find((x) => x.kind === 'ship-by-close')?.severity, 'amber')
    const red = nudgesFor(rec({ status: 'Interested', shipBy: '2026-09-11' }), TODAY)
    assert.equal(red.find((x) => x.kind === 'ship-by-close')?.severity, 'red')
  })

  it('says how late it is once the ship-by has passed', () => {
    const n = nudgesFor(rec({ status: 'Ordered', shipBy: '2026-09-01' }), TODAY)
    assert.match(n.find((x) => x.kind === 'ship-by-close')!.message, /6 days ago/)
  })

  it('returns every applicable nudge, not just the first', () => {
    // "Ship-by is in nine days" and "the warehouse was never told" are both true, and
    // the second is the reason for the first.
    const n = nudgesFor(rec({ status: 'Ordered', shipBy: '2026-09-16' }), TODAY)
    assert.equal(n.length, 2)
  })

  it('stops nudging once it has shipped', () => {
    assert.deepEqual(nudgesFor(rec({ status: 'Shipped', shipBy: '2026-09-01' }), TODAY), [])
  })

  it('says nothing about a closed record', () => {
    assert.deepEqual(nudgesFor(rec({ status: 'Delivered', shipBy: '2026-01-01' }), TODAY), [])
  })

  it('chases a promo that got no answer either way', () => {
    assert.ok(nudgesFor(rec({ status: 'Promo Sent' }), TODAY).some((x) => x.kind === 'promo-no-order'))
  })
})

describe('digestFor', () => {
  it('puts the reds first, then the nearest ship-by', () => {
    const out = digestFor(
      [
        rec({ id: 'later', status: 'Quote Sent', shipBy: '2026-12-01' }),
        rec({ id: 'soon', status: 'Promo Sent', shipBy: '2026-09-20' }),
        rec({ id: 'red', status: 'Ordered', shipBy: '2026-11-01' }),
      ],
      TODAY,
    )
    assert.equal(out[0]!.record.id, 'red')
  })

  it('leaves out anything with nothing wrong', () => {
    const out = digestFor([rec({ status: 'Delivered' }), rec({ status: 'Mentioned' })], TODAY)
    assert.equal(out.length, 0)
  })
})

describe('fulfillmentFor', () => {
  const product = (physical: boolean) => ({ physical })
  const line = { id: 'li1', dealId: 'd1', quantity: 2_000 }

  it('opens a record for a physical line item', () => {
    const out = fulfillmentFor(line, product(true), { eventDate: '2026-12-01' })
    assert.ok(out)
    assert.equal(out.status, 'Mentioned', 'it starts at the beginning of the flow')
    assert.equal(out.quantity, 2_000)
    assert.equal(out.shipBy, '2026-10-17', '45 days for a run this size')
    assert.equal(out.lineItemId, 'li1')
  })

  it('opens nothing for a workshop', () => {
    // A record with no shipment is a row on a board that never closes.
    assert.equal(fulfillmentFor(line, product(false), { eventDate: '2026-12-01' }), null)
  })

  it('still opens a record when the event has no date yet', () => {
    // The order is real even if the date is not. A missing ship-by is a gap the digest
    // can chase; a missing record is one nobody knows about.
    const out = fulfillmentFor(line, product(true), { eventDate: null })
    assert.ok(out)
    assert.equal(out.shipBy, null)
  })
})
