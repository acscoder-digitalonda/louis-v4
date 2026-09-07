import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  CHALLENGE_HOURS,
  detectConflicts,
  existingFor,
  heldDate,
  holdsADate,
  hoursRemaining,
  statusFor,
  windowFor,
} from './conflicts'
import type { DateConflict, Deal } from './types'

const TODAY = '2026-09-07'

let n = 0
const deal = (over: Partial<Deal> = {}) =>
  ({
    id: `d${++n}`,
    name: `Deal ${n}`,
    stage: 'qualified',
    historical: false,
    holdDate: null,
    eventDate: null,
    holdOrder: null,
    rateRegion: 'us-canada',
    client: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  }) as Deal

describe('holdsADate', () => {
  it('is true only for the two stages that hold a date', () => {
    for (const stage of ['qualified', 'firm-offer'] as const) {
      assert.equal(holdsADate(deal({ stage, holdDate: '2026-10-01' })), true, stage)
    }
    for (const stage of ['inquiry', 'closed-won', 'delivered', 'closed-lost'] as const) {
      assert.equal(holdsADate(deal({ stage, holdDate: '2026-10-01' })), false, stage)
    }
  })

  it('never conflicts on imported history', () => {
    // 802 delivered keynotes would otherwise collide with everything upcoming.
    assert.equal(holdsADate(deal({ historical: true, holdDate: '2026-10-01' })), false)
  })

  it('falls back to the event date when there is no hold date', () => {
    assert.equal(heldDate(deal({ eventDate: '2026-10-01' })), '2026-10-01')
    assert.equal(heldDate(deal({ holdDate: '2026-10-02', eventDate: '2026-10-01' })), '2026-10-02')
  })
})

describe('detectConflicts', () => {
  it('finds two deals on the same day', () => {
    const out = detectConflicts(
      [deal({ holdDate: '2026-10-01' }), deal({ holdDate: '2026-10-01' })],
      TODAY,
    )
    assert.equal(out.length, 1)
    assert.equal(out[0]!.deals.length, 2)
  })

  it('leaves a single hold alone', () => {
    assert.equal(detectConflicts([deal({ holdDate: '2026-10-01' })], TODAY).length, 0)
  })

  it('ignores dates that have already passed', () => {
    const out = detectConflicts(
      [deal({ holdDate: '2026-01-01' }), deal({ holdDate: '2026-01-01' })],
      TODAY,
    )
    assert.equal(out.length, 0)
  })

  it('gives the first hold to the lowest hold order', () => {
    // The first hold owns the right of first refusal. Getting this backwards gives the
    // deciding call to the wrong client.
    const second = deal({ holdDate: '2026-10-01', holdOrder: 2, name: 'Second' })
    const first = deal({ holdDate: '2026-10-01', holdOrder: 1, name: 'First' })
    const out = detectConflicts([second, first], TODAY)
    assert.equal(out[0]!.firstHold.name, 'First')
  })

  it('falls back to creation time when hold order is unset', () => {
    // Most seeded deals have no numbering; the calendar event's creation time is what
    // the runbook says to use instead.
    const later = deal({ holdDate: '2026-10-01', createdAt: '2026-09-03T00:00:00.000Z', name: 'Later' })
    const earlier = deal({ holdDate: '2026-10-01', createdAt: '2026-09-01T00:00:00.000Z', name: 'Earlier' })
    assert.equal(detectConflicts([later, earlier], TODAY)[0]!.firstHold.name, 'Earlier')
  })

  it('flags the conflict as challenged once one side reaches Firm Offer', () => {
    const a = deal({ holdDate: '2026-10-01' })
    const b = deal({ holdDate: '2026-10-01', stage: 'firm-offer' })
    assert.equal(detectConflicts([a, b], TODAY)[0]!.challenged, true)
    assert.equal(detectConflicts([a, deal({ holdDate: '2026-10-01' })], TODAY)[0]!.challenged, false)
  })

  it('widens the window for a trip, because one journey covers several days', () => {
    // A Tuesday in Singapore and a Wednesday in London are the same trip.
    const near = [
      deal({ holdDate: '2026-10-01', rateRegion: 'far-international' }),
      deal({ holdDate: '2026-10-03', rateRegion: 'far-international' }),
    ]
    assert.equal(detectConflicts(near, TODAY).length, 1)

    // Domestic: two days apart is two separate bookings, not a conflict.
    const domestic = [
      deal({ holdDate: '2026-10-01', rateRegion: 'us-canada' }),
      deal({ holdDate: '2026-10-03', rateRegion: 'us-canada' }),
    ]
    assert.equal(detectConflicts(domestic, TODAY).length, 0)
  })

  it('uses the wider of the two windows when the bands differ', () => {
    const mixed = [
      deal({ holdDate: '2026-10-01', rateRegion: 'us-canada' }),
      deal({ holdDate: '2026-10-02', rateRegion: 'europe-samerica-japan' }),
    ]
    assert.equal(detectConflicts(mixed, TODAY).length, 1)
  })

  it('names both clients in the label', () => {
    const out = detectConflicts(
      [
        deal({ holdDate: '2026-10-01', client: { id: 'c1', name: 'Fidelity' } }),
        deal({ holdDate: '2026-10-01', client: { id: 'c2', name: 'Janney' } }),
      ],
      TODAY,
    )
    assert.match(out[0]!.label, /Fidelity/)
    assert.match(out[0]!.label, /Janney/)
  })

  it('gives a domestic band a zero-day window', () => {
    assert.equal(windowFor('us-canada'), 0)
    assert.equal(windowFor(null), 0)
    assert.ok(windowFor('far-international') > 0)
  })
})

describe('existingFor', () => {
  const a = deal({ id: 'da', holdDate: '2026-10-01' })
  const b = deal({ id: 'db', holdDate: '2026-10-01' })
  const conflict = detectConflicts([a, b], TODAY)[0]!
  const record = (over: Partial<DateConflict> = {}) =>
    ({ id: 'x', dealIds: ['da', 'db'], status: 'open', ...over }) as DateConflict

  it('finds an open record covering the same deals', () => {
    assert.ok(existingFor(conflict, [record()]))
  })

  it('ignores one that has been resolved, so a fresh clash is raised again', () => {
    assert.equal(existingFor(conflict, [record({ status: 'resolved' })]), null)
  })

  it('does not match a record covering a different set', () => {
    assert.equal(existingFor(conflict, [record({ dealIds: ['da', 'dz'] })]), null)
    assert.equal(existingFor(conflict, [record({ dealIds: ['da'] })]), null)
  })

  it('treats both-feasible as still standing', () => {
    // Two gigs in one day, already decided. Raising it again every night is noise.
    assert.ok(existingFor(conflict, [record({ status: 'both-feasible' })]))
  })
})

describe('the 24-hour challenge', () => {
  it('counts down from twenty-four hours', () => {
    const now = new Date('2026-09-07T12:00:00Z')
    assert.equal(hoursRemaining({ createdAt: '2026-09-07T12:00:00Z' }, now), CHALLENGE_HOURS)
    assert.equal(hoursRemaining({ createdAt: '2026-09-07T00:00:00Z' }, now), 12)
  })

  it('floors at zero and never goes negative', () => {
    // Display only. Nothing happens at zero — a timer that acted on expiry would be the
    // auto-release Decisions Log §3 forbids.
    const now = new Date('2026-09-09T12:00:00Z')
    assert.equal(hoursRemaining({ createdAt: '2026-09-07T12:00:00Z' }, now), 0)
  })

  it('returns zero rather than NaN for an unparseable timestamp', () => {
    assert.equal(hoursRemaining({ createdAt: 'never' }), 0)
  })
})

describe('statusFor', () => {
  it('keeps both-feasible as its own answer', () => {
    // It is a real outcome, not a resolution, and it is what dismisses the drafted
    // challenge email without anyone remembering to.
    assert.equal(statusFor('Both feasible'), 'both-feasible')
  })

  it('resolves everything else', () => {
    for (const r of ['First hold contracted', 'First hold released', 'Second hold released'] as const) {
      assert.equal(statusFor(r), 'resolved', r)
    }
  })
})
