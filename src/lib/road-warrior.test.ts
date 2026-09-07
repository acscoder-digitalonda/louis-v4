import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { BRIEF_FIELDS, buildBrief, departureDate, isDueToday, shouldResend } from './road-warrior'
import type { Deal, Task } from './types'

const deal = (over: Partial<Deal> = {}) =>
  ({
    id: 'd1',
    name: 'Fidelity — Leadership Summit',
    eventDate: '2026-10-15',
    travelDepartureDate: null,
    outboundFlight: null,
    returnFlight: null,
    hotel: null,
    travelNotes: null,
    location: 'Boston',
    eventTimezone: 'America/New_York',
    avCheckTime: '8:30am ET',
    stageTime: '10:00am ET, 45 minutes',
    client: { id: 'c1', name: 'Fidelity' },
    audienceProfile: '300 senior leaders',
    desiredOutcomes: 'Leave with one thing they will actually do',
    ...over,
  }) as Deal

describe('departureDate', () => {
  it('uses the explicit field when somebody filled it in', () => {
    assert.equal(departureDate(deal({ travelDepartureDate: '2026-10-13' })), '2026-10-13')
  })

  it('falls back to the day before the event', () => {
    // Most deals will never have the field set. A brief that only fires for the tidy
    // ones is a brief nobody relies on.
    assert.equal(departureDate(deal()), '2026-10-14')
  })

  it('has no answer without an event date', () => {
    assert.equal(departureDate(deal({ eventDate: null })), null)
  })
})

describe('isDueToday', () => {
  it('fires the day before travel', () => {
    assert.equal(isDueToday(deal(), '2026-10-13'), true, 'T-1 from 14 Oct departure')
    assert.equal(isDueToday(deal(), '2026-10-14'), false, 'the day itself is too late')
    assert.equal(isDueToday(deal(), '2026-10-01'), false)
  })

  it('follows the explicit departure date when there is one', () => {
    assert.equal(isDueToday(deal({ travelDepartureDate: '2026-10-11' }), '2026-10-10'), true)
  })
})

describe('buildBrief', () => {
  it('puts every fact in the body, not behind a link', () => {
    // It is read in an airport. A link needs signal, a login and a working screen.
    const b = buildBrief(deal({ hotel: 'Langham, 250 Franklin St', outboundFlight: 'DL 1204 07:15' }))
    assert.match(b.text, /Langham/)
    assert.match(b.text, /DL 1204/)
    assert.match(b.text, /8:30am ET/)
    assert.equal(/https?:\/\//.test(b.text), false, 'nothing is behind a tap')
  })

  it('prints what is missing rather than leaving it blank', () => {
    // A blank hotel line reads as "no hotel needed". "Hotel: not recorded" tells Ben to
    // phone Liezel before he is in a taxi.
    const b = buildBrief(deal())
    assert.match(b.text, /Hotel: not recorded/)
    assert.ok(b.gaps.includes('Hotel'))
  })

  it('leads with the gaps so they are read first', () => {
    const b = buildBrief(deal())
    const gapLine = b.text.split('\n').findIndex((l) => l.startsWith('Not on file:'))
    const travelLine = b.text.split('\n').findIndex((l) => l === 'TRAVEL')
    assert.ok(gapLine >= 0 && gapLine < travelLine)
  })

  it('names a missing onsite contact as a gap of its own', () => {
    // Arriving at a venue with nobody's number is the most recoverable problem on the
    // list, and only before you leave.
    const b = buildBrief(deal())
    assert.ok(b.gaps.some((g) => /onsite contact/i.test(g)))
  })

  it('lists the people to call when there are any', () => {
    const b = buildBrief(deal(), {
      contacts: [{ name: 'Dana Whitfield', phone: '+1 617 555 0134', email: null, type: 'onsite' }],
    })
    assert.match(b.text, /Dana Whitfield: \+1 617 555 0134/)
    assert.equal(b.gaps.some((g) => /onsite/i.test(g)), false)
  })

  it('marks a re-send so the newest is obviously the newest', () => {
    const b = buildBrief(deal(), { updated: true })
    assert.match(b.text, /^UPDATED/)
    assert.match(b.title, /Updated brief/)
  })

  it('carries open tasks, capped so the page stays readable', () => {
    const tasks = Array.from({ length: 10 }, (_, i) => ({ title: `Task ${i}`, done: false }) as Task)
    const b = buildBrief(deal(), { tasks })
    assert.equal(b.sections.find((s) => s.heading === 'Still open')!.lines.length, 6)
  })
})

describe('shouldResend', () => {
  it('re-sends when something the brief prints has changed', () => {
    assert.ok(shouldResend(['hotel']))
    assert.ok(shouldResend(['avCheckTime', 'audienceProfile']))
  })

  it('stays quiet for a change the brief does not show', () => {
    // Re-sending because somebody edited the audience profile teaches Ben to stop
    // opening it, which costs more than the stale line would.
    assert.equal(shouldResend(['audienceProfile']), false)
    assert.equal(shouldResend(['negotiatedFee', 'kickoffNotes']), false)
    assert.equal(shouldResend([]), false)
  })

  it('watches only fields that exist on a deal', () => {
    const dummy = deal()
    for (const f of BRIEF_FIELDS) assert.ok(f in dummy, String(f))
  })
})
