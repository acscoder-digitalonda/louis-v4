import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { HANDS_OFF, RE_ENGAGEABLE, WINDOW_DAYS, eligibleFrom, monthsBetween, planCampaign } from './reengagement'
import type { ClosedLostReason, Deal } from './types'

const TODAY = '2026-09-07'

let n = 0
const lost = (over: Partial<Deal> = {}) =>
  ({
    id: `d${++n}`,
    name: `Deal ${n}`,
    stage: 'closed-lost',
    closedLostReason: 'budget' as ClosedLostReason,
    historical: false,
    muted: false,
    // Lost twelve months ago to the day.
    lastModified: '2025-09-07T10:00:00.000Z',
    ...over,
  }) as Deal

describe('eligibleFrom', () => {
  it('is twelve months after the deal was lost', () => {
    assert.equal(eligibleFrom({ lastModified: '2025-09-07T10:00:00Z' }), '2026-09-07')
  })

  it('handles a month with fewer days without skipping a year', () => {
    assert.equal(monthsBetween('2025-01-31', '2026-01-31'), 12)
  })
})

describe('planCampaign', () => {
  it('knocks on the anniversary', () => {
    const plan = planCampaign([lost()], TODAY)
    assert.equal(plan.due.length, 1)
    assert.equal(plan.due[0]!.reason, 'budget')
    assert.match(plan.due[0]!.angle, /Budget cycles reset/)
  })

  it('waits until the anniversary', () => {
    // A company that said no in March does not want to hear from us in June.
    const plan = planCampaign([lost({ lastModified: '2026-06-01T00:00:00Z' })], TODAY)
    assert.equal(plan.due.length, 0)
    assert.match(plan.skipped[0]!.why, /Not yet/)
  })

  it('lets an anniversary go by rather than knocking two years late', () => {
    const plan = planCampaign([lost({ lastModified: '2024-01-01T00:00:00Z' })], TODAY)
    assert.equal(plan.due.length, 0)
    assert.match(plan.skipped[0]!.why, new RegExp(`${WINDOW_DAYS}-day window`))
  })

  it('has a window wide enough to catch a real anniversary', () => {
    // A campaign that fires on one exact date misses almost everyone.
    const plan = planCampaign([lost({ lastModified: '2025-08-20T00:00:00Z' })], TODAY)
    assert.equal(plan.due.length, 1)
  })

  it('never campaigns to imported history', () => {
    // 45 released inquiries came in from Liezel's sheet. Some are years old and none of
    // those people opted into anything.
    const plan = planCampaign([lost({ historical: true })], TODAY)
    assert.equal(plan.due.length, 0)
    assert.match(plan.skipped[0]!.why, /history/i)
  })

  it('leaves the three hands-off reasons alone, and says which', () => {
    for (const reason of HANDS_OFF) {
      const plan = planCampaign([lost({ closedLostReason: reason })], TODAY)
      assert.equal(plan.due.length, 0, reason)
      assert.ok(plan.skipped[0]!.why.length > 0, reason)
    }
  })

  it('skips a deal with no reason, because there is no angle to lead with', () => {
    const plan = planCampaign([lost({ closedLostReason: null })], TODAY)
    assert.equal(plan.due.length, 0)
    assert.match(plan.skipped[0]!.why, /no angle/)
  })

  it('respects mute', () => {
    assert.equal(planCampaign([lost({ muted: true })], TODAY).due.length, 0)
  })

  it('ignores deals that are not closed-lost at all', () => {
    for (const stage of ['qualified', 'closed-won', 'delivered'] as const) {
      const plan = planCampaign([lost({ stage })], TODAY)
      assert.equal(plan.due.length + plan.skipped.length, 0, stage)
    }
  })

  it('counts each segment, so the shape is visible before anything sends', () => {
    const plan = planCampaign(
      [lost(), lost(), lost({ closedLostReason: 'date-unavailable' })],
      TODAY,
    )
    assert.deepEqual(plan.segments, { budget: 2, 'date-unavailable': 1 })
  })

  it('explains every exclusion', () => {
    // The difference between a good list and a burned one is entirely in what was left
    // out, so leaving something out has to be as visible as including it.
    const plan = planCampaign(
      [
        lost({ historical: true }),
        lost({ closedLostReason: null }),
        lost({ closedLostReason: 'went-quiet' }),
        lost({ muted: true }),
        lost({ lastModified: '2026-08-01T00:00:00Z' }),
      ],
      TODAY,
    )
    assert.equal(plan.due.length, 0)
    assert.equal(plan.skipped.length, 5)
    for (const s of plan.skipped) assert.ok(s.why.length > 0, s.deal.name)
  })

  it('names a template for every reason it will act on', () => {
    // A campaign that computes a segment with no copy to send is a plan nobody can run.
    for (const [reason, spec] of Object.entries(RE_ENGAGEABLE)) {
      assert.ok(spec.templateKey.startsWith('reengage.'), reason)
      assert.ok(spec.angle.length > 0, reason)
    }
  })

  it('covers every closed-lost reason exactly once, either acted on or held back', () => {
    const all: ClosedLostReason[] = [
      'budget', 'date-unavailable', 'chose-another-speaker',
      'no-speaker', 'postponed', 'went-quiet', 'other',
    ]
    for (const r of all) {
      const acted = r in RE_ENGAGEABLE
      const held = HANDS_OFF.includes(r)
      assert.notEqual(acted, held, `${r} must be exactly one of the two`)
    }
  })
})

describe('junk', () => {
  it('is never re-engaged, and says why', () => {
    // A spam form submission or a marketing reply mis-filed as an inquiry is not a lost
    // deal. Closing it under any other reason would knock on its door in a year.
    const lost = {
      id: 'j1', name: 'Re: Free Resources', stage: 'closed-lost', historical: false,
      closedLostReason: 'junk', lastModified: '2025-09-01T00:00:00.000Z', eventDate: null,
      client: null,
    } as unknown as Deal
    const plan = planCampaign([lost], '2026-09-09')
    assert.equal(plan.due.length, 0)
    assert.equal(plan.skipped.length, 1)
    assert.match(plan.skipped[0]!.why, /junk/i)
  })
})
