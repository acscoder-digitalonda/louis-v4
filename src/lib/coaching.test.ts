import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  DEFAULT_GAP_DAYS,
  SESSIONS_PER_TRACK,
  billingLegs,
  isCoaching,
  ledger,
  plannedSessions,
  templateAfter,
} from './coaching'
import type { CoachingSession, Deal } from './types'

const TODAY = '2026-09-08'

const session = (n: number, over: Partial<CoachingSession> = {}): CoachingSession => ({
  id: `s${n}`,
  dealId: 'd1',
  sessionNumber: n,
  scheduledFor: null,
  held: false,
  notes: null,
  ...over,
})

describe('isCoaching', () => {
  it('covers both coaching types and nothing else', () => {
    assert.ok(isCoaching('speaker-coaching'))
    assert.ok(isCoaching('executive-coaching'))
    assert.equal(isCoaching('keynote'), false)
    assert.equal(isCoaching(null), false)
  })
})

describe('plannedSessions', () => {
  it('opens three, spaced from the kick-off', () => {
    const out = plannedSessions({ id: 'd1', kickoffDate: '2026-10-01', eventDate: null } as Deal)
    assert.equal(out.length, SESSIONS_PER_TRACK)
    assert.deepEqual(out.map((s) => s.scheduledFor), ['2026-10-01', '2026-10-15', '2026-10-29'])
    assert.deepEqual(out.map((s) => s.sessionNumber), [1, 2, 3])
  })

  it('opens them unscheduled when no date has been agreed', () => {
    // An empty date is honest — nobody has agreed a time. Inventing three would make the
    // deal look arranged when it is not, and the ledger would stop chasing.
    const out = plannedSessions({ id: 'd1', kickoffDate: null, eventDate: null } as Deal)
    assert.equal(out.length, 3)
    for (const s of out) assert.equal(s.scheduledFor, null)
  })

  it('takes the gap as a parameter, because nobody specified it', () => {
    const out = plannedSessions({ id: 'd1', kickoffDate: '2026-10-01', eventDate: null } as Deal, 7)
    assert.equal(out[1]!.scheduledFor, '2026-10-08')
    assert.equal(DEFAULT_GAP_DAYS, 14, 'the default is written down in one place')
  })

  it('starts them all unheld', () => {
    for (const s of plannedSessions({ id: 'd1', kickoffDate: '2026-10-01' } as Deal)) {
      assert.equal(s.held, false)
    }
  })
})

describe('ledger', () => {
  it('names the next session and when', () => {
    const state = ledger([session(1, { scheduledFor: '2026-09-15' }), session(2), session(3)], TODAY)
    assert.equal(state.next?.sessionNumber, 1)
    assert.match(state.nextAction, /Session 1 in 7 days/)
    assert.equal(state.complete, false)
  })

  it('counts what has been delivered', () => {
    const state = ledger(
      [session(1, { held: true }), session(2, { held: true }), session(3, { scheduledFor: '2026-09-20' })],
      TODAY,
    )
    assert.equal(state.held, 2)
    assert.equal(state.next?.sessionNumber, 3)
  })

  it('turns to the next track once all three are delivered', () => {
    const state = ledger([1, 2, 3].map((n) => session(n, { held: true })), TODAY)
    assert.ok(state.complete)
    assert.ok(state.sellNextTrack)
    assert.match(state.nextAction, /next track/i)
  })

  it('says a session needs a date rather than going quiet', () => {
    const state = ledger([session(1), session(2), session(3)], TODAY)
    assert.match(state.nextAction, /no date. Book it/)
  })

  it('calls a track stalled when a date has come and gone unmarked', () => {
    // A session whose date passed without being marked held is the quiet failure this
    // whole module exists to catch.
    const state = ledger([session(1, { scheduledFor: '2026-08-20' }), session(2)], TODAY)
    assert.ok(state.stalled)
    assert.match(state.nextAction, /19 days ago/)
  })

  it('is not stalled a day after a session', () => {
    const state = ledger([session(1, { scheduledFor: '2026-09-05' })], TODAY)
    assert.equal(state.stalled, false, 'three days late is a nudge, not an alarm')
  })

  it('calls an unbooked session stalled once it has waited three weeks', () => {
    const fresh = ledger([session(1)], TODAY, '2026-09-01')
    const old = ledger([session(1)], TODAY, '2026-08-01')
    assert.equal(fresh.stalled, false)
    assert.equal(old.stalled, true)
  })

  it('notices a coaching deal with no ledger at all', () => {
    // The deal was won and nobody opened it. Silence here is a client who paid for three
    // sessions and had none.
    const state = ledger([], TODAY)
    assert.ok(state.stalled)
    assert.match(state.nextAction, /No sessions/)
  })

  it('always has something to say', () => {
    for (const sessions of [
      [],
      [session(1)],
      [session(1, { scheduledFor: '2026-09-20' })],
      [session(1, { held: true }), session(2)],
      [1, 2, 3].map((n) => session(n, { held: true })),
    ]) {
      assert.ok(ledger(sessions, TODAY).nextAction.length > 10)
    }
  })
})

describe('templateAfter', () => {
  it('offers the next track at the end and the follow-up in between', () => {
    assert.equal(templateAfter(ledger([1, 2, 3].map((n) => session(n, { held: true })), TODAY)), 'E22d')
    assert.equal(templateAfter(ledger([session(1, { held: true }), session(2)], TODAY)), 'E22c')
  })

  it('has nothing to say before the first session', () => {
    assert.equal(templateAfter(ledger([session(1), session(2)], TODAY)), null)
  })
})

describe('billingLegs', () => {
  it('splits fifty-fifty, on signing and on delivery', () => {
    const legs = billingLegs(15_000)
    assert.deepEqual(legs.map((l) => l.amount), [7_500, 7_500])
    assert.deepEqual(legs.map((l) => l.due), ['signing', 'delivery'])
  })

  it('never loses a penny to rounding', () => {
    for (const amount of [15_000, 15_001, 9_999, 1]) {
      assert.equal(billingLegs(amount).reduce((n, l) => n + l.amount, 0), amount, String(amount))
    }
  })
})
