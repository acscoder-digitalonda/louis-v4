import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { extractDeals, findDateConflicts, isBookingTitle, matchClient, parseTitle } from './c1-calendar-seed'
import type { CalendarEvent } from './c1-calendar-seed'
import type { Client } from '@/lib/types'

const ev = (id: string, summary: string, date: string): CalendarEvent => ({
  id,
  summary,
  start: { date },
})

describe('parseTitle', () => {
  it('splits CLIENT-LOCATION-CONTACT', () => {
    const p = parseTitle('ABBVIE-ORLANDO-JENNA')
    assert.equal(p.client, 'ABBVIE')
    assert.equal(p.location, 'ORLANDO')
    assert.equal(p.contact, 'JENNA')
  })

  it('reads the (n) suffix as the hold order', () => {
    assert.equal(parseTitle('TBD-CHARLOTTE, NC-MARILY (3)').order, 3)
    assert.equal(parseTitle('ABBVIE-ORLANDO-JENNA').order, 1, 'no suffix means first choice')
  })

  it('strips an unclosed *marker* — it used to leak into the client name', () => {
    // "JANNEY *EVENING- GLASTONBURY" gave client "JANNEY *EVENING", which then failed
    // every match against the imported company list.
    const p = parseTitle('JANNEY *EVENING- GLASTONBURY, CT - BOB')
    assert.equal(p.client, 'JANNEY')
    assert.equal(p.location, 'GLASTONBURY, CT')
    assert.deepEqual(p.notes, ['EVENING'])
  })

  it('never lets a marker swallow the fields after it', () => {
    // A greedy pair rule matched from "*STAY IN MIAMI" all the way to "*MEALS", eating
    // the location and the contact in between.
    const p = parseTitle('*BRING PASSPORT*WAKEFERN *STAY IN MIAMI-ARUBA-BILL *MEALS ON MASTER')
    assert.equal(p.client, 'WAKEFERN')
    assert.equal(p.location, 'ARUBA')
    assert.equal(p.contact, 'BILL')
  })
})

describe('isBookingTitle', () => {
  it('accepts the caps hyphenated shape', () => {
    assert.ok(isBookingTitle('ACUITY/ TILT GROUP-SHEBOYGAN, WI-LAUREN'))
  })

  it('rejects Ben’s own life', () => {
    for (const t of ['Jay Spence’s B-Day', 'Liezel PTO', 'S.216 T1 TAX RETURN FILING DEADLINE']) {
      assert.equal(isBookingTitle(t), false, `${t} should not read as a booking`)
    }
  })

  it('rejects lower-case prose that happens to contain a hyphen', () => {
    assert.equal(isBookingTitle('Farm Bureau Promo Vid & Fidelity Virtual Slides'), false)
  })
})

describe('extractDeals', () => {
  it('groups one client’s candidate dates into a single deal', () => {
    // The runbook read (n) as "the nth hold on this date". It is the preference rank
    // among candidate dates for one deal — grouping by date duplicated the queue.
    const deals = extractDeals(
      [
        ev('a', 'TBD-CHARLOTTE, NC-MARILY (3)', '2026-10-06'),
        ev('b', 'TBD-CHARLOTTE, NC-MARILY (2)', '2026-10-07'),
        ev('c', 'TBD-CHARLOTTE, NC-MARILY', '2026-10-08'),
      ],
      '2026-09-05',
    )
    assert.equal(deals.length, 1, 'three dates, one deal')
    assert.equal(deals[0]!.heldDates.length, 3)
    assert.equal(deals[0]!.primaryDate, '2026-10-08', 'lowest (n) is first choice')
  })

  it('marks a deal historical once its last held date has passed', () => {
    const [past] = extractDeals([ev('a', 'ABBVIE-ORLANDO-JENNA', '2026-07-01')], '2026-09-05')
    assert.equal(past!.historical, true)
  })

  it('flags a TBD client and scores it lower', () => {
    const [d] = extractDeals([ev('a', 'TBD-MIAMI-LISA', '2026-10-29')], '2026-09-05')
    assert.equal(d!.clientUnknown, true)
    assert.ok(d!.confidence < 0.8, 'an unnamed client must not be bulk-acceptable')
  })
})

describe('findDateConflicts', () => {
  it('is two different deals on one date, not one deal on many', () => {
    const deals = extractDeals(
      [
        ev('a', 'JANNEY-VIRTUAL-JENNY', '2026-09-16'),
        ev('b', 'JANNEY-VIRTUAL-JENNY', '2026-09-30'),
        ev('c', 'EQUIFAX-ATLANTA-RON', '2026-09-16'),
      ],
      '2026-09-05',
    )
    const conflicts = findDateConflicts(deals, '2026-09-05')
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0]!.date, '2026-09-16')
  })
})

describe('matchClient', () => {
  const clients = [
    { id: '1', name: 'Janney Montgomery Scott' },
    { id: '2', name: 'FIDELITY' },
    { id: '3', name: 'FIDELITY (FIS)' },
    { id: '4', name: 'FIDELITY INVESTMENTS' },
  ] as Client[]

  it('resolves the calendar’s shorthand to the full legal name', () => {
    assert.equal(matchClient('JANNEY', clients).clientId, '1')
  })

  it('prefers an exact name over any number of longer ones', () => {
    // Three companies begin with Fidelity, but one is called exactly that — and it exists
    // because past bookings were filed under that name. An exact hit is the strongest
    // signal available and beats the ambiguity guard.
    assert.equal(matchClient('FIDELITY', clients).clientId, '2')
  })

  it('refuses to pick when a shorthand has several longer candidates', () => {
    // Same word, but now nothing is named exactly that. Choosing would be wrong half the
    // time and invisible once accepted, so the candidates go to the human instead.
    const noExact = clients.filter((c) => c.name !== 'FIDELITY')
    const m = matchClient('FIDELITY', noExact)
    assert.equal(m.clientId, null)
    assert.match(m.reason, /^Ambiguous/)
    assert.ok(m.reason.includes('FIDELITY (FIS)'), 'the reason must name the candidates')
  })

  it('proposes a new company when nothing matches', () => {
    const m = matchClient('PROGRESSIVE', clients)
    assert.equal(m.clientId, null)
    assert.match(m.reason, /No imported company/)
  })
})
