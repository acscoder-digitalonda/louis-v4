import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { checkCapacity, weekStart } from './capacity'
import type { Deal } from './types'

const deal = (id: string, eventDate: string | null, over: Partial<Deal> = {}) =>
  ({
    id,
    name: `Deal ${id}`,
    client: { id: `c${id}`, name: `Client ${id}` },
    stage: 'closed-won',
    dealType: 'keynote',
    historical: false,
    eventDate,
    ...over,
  }) as unknown as Deal

describe('weekStart', () => {
  it('anchors on Monday', () => {
    assert.equal(weekStart('2026-09-09'), '2026-09-07', 'Wednesday belongs to Monday')
    assert.equal(weekStart('2026-09-07'), '2026-09-07', 'Monday is its own start')
  })

  it('keeps Sunday in the week that started six days earlier', () => {
    // The off-by-one that would split a weekend pair across two weeks.
    assert.equal(weekStart('2026-09-13'), '2026-09-07')
  })
})

describe('checkCapacity', () => {
  it('says so plainly when the week is empty', () => {
    const check = checkCapacity('2026-09-09', [])
    assert.equal(check.atCap, false)
    assert.equal(check.verdict, 'Nothing else that week.')
  })

  it('names what sits within a day', () => {
    const check = checkCapacity('2026-09-09', [deal('a', '2026-09-10')])
    assert.equal(check.adjacent.length, 1)
    assert.match(check.verdict, /Client a \(09-10\) is within a day/)
  })

  it('counts a same-week keynote that is not adjacent', () => {
    const check = checkCapacity('2026-09-07', [deal('a', '2026-09-11')])
    assert.equal(check.adjacent.length, 0)
    assert.match(check.verdict, /1 other keynote that week, none adjacent/)
  })

  it('flags the fourth booking without refusing it', () => {
    // The run plan is explicit: no capacity guards. This advises.
    const week = [deal('a', '2026-09-08'), deal('b', '2026-09-09'), deal('c', '2026-09-10')]
    const check = checkCapacity('2026-09-11', week)
    assert.equal(check.atCap, true)
    assert.match(check.verdict, /already has 3 keynotes/)
    assert.match(check.verdict, /Nothing is blocked/)
  })

  it('never counts a deal against itself', () => {
    const self = deal('me', '2026-09-09')
    assert.equal(checkCapacity('2026-09-09', [self], 'me').week.length, 0)
    assert.equal(checkCapacity('2026-09-09', [self]).week.length, 1)
  })

  it('ignores what is not a committed keynote', () => {
    const noise = [
      deal('a', '2026-09-09', { stage: 'closed-lost' }),
      deal('b', '2026-09-09', { historical: true }),
      deal('c', '2026-09-09', { dealType: 'speaker-coaching' }),
      deal('d', '2026-09-09', { stage: 'inquiry' }),
      deal('e', null),
    ]
    assert.equal(checkCapacity('2026-09-09', noise).week.length, 0)
  })

  it('counts a hold, because a hold is what the check is for', () => {
    // Liezel runs this before granting one. A week of holds is a full week.
    const held = deal('a', '2026-09-09', { stage: 'qualified' })
    assert.equal(checkCapacity('2026-09-10', [held]).week.length, 1)
  })
})
