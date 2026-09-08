import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { buildDigest, renderDigest } from './digest'
import type { CoachingSession, Deal, Fulfillment } from './types'

const TODAY = '2026-09-07'

const deal = (over: Partial<Deal> = {}) =>
  ({
    id: 'rec1',
    name: 'Acme keynote',
    client: { id: 'cli1', name: 'Acme' },
    stage: 'qualified',
    muted: false,
    muteUntil: null,
    nextActionDate: null,
    followUpCount: 0,
    historical: false,
    decisionDate: null,
    eventDate: null,
    holdDate: null,
    questionnaireReceived: false,
    logisticsComplete: false,
    dealType: 'keynote',
    lastModified: `${TODAY}T00:00:00.000Z`,
    ...over,
  }) as unknown as Deal

const kinds = (items: { kind: string }[]) => items.map((i) => i.kind)

describe('buildDigest — whose list it is', () => {
  it('gives the office the first two chases and Ben the third', () => {
    const early = deal({ id: 'a', nextActionDate: TODAY, followUpCount: 1 })
    const escalated = deal({ id: 'b', nextActionDate: TODAY, followUpCount: 2 })

    const ops = buildDigest('ops', { deals: [early, escalated], today: TODAY })
    const owner = buildDigest('owner', { deals: [early, escalated], today: TODAY })

    assert.deepEqual(
      ops.items.filter((i) => i.kind === 'chase').map((i) => i.dealId),
      ['a'],
    )
    assert.deepEqual(
      owner.items.filter((i) => i.kind === 'chase').map((i) => i.dealId),
      ['b'],
    )
  })

  it('keeps office work out of Ben’s list even when the chase is his', () => {
    // He is chasing this deal, and he still does not want a questionnaire reminder.
    // The moment his list contains admin, he stops reading it.
    const d = deal({
      nextActionDate: TODAY,
      followUpCount: 2,
      stage: 'pre-event',
      eventDate: '2026-09-14',
    })
    const owner = buildDigest('owner', { deals: [d], today: TODAY })
    assert.deepEqual(kinds(owner.items), ['chase'])

    const ops = buildDigest('ops', { deals: [d], today: TODAY })
    assert.ok(kinds(ops.items).includes('questionnaire'))
    assert.ok(!kinds(ops.items).includes('chase'), 'the chase escalated away from ops')
  })
})

describe('buildDigest — what stays out', () => {
  it('counts muted deals instead of listing them', () => {
    const d = deal({ nextActionDate: TODAY, muted: true, muteUntil: '2026-12-01' })
    const digest = buildDigest('ops', { deals: [d], today: TODAY })
    assert.deepEqual(digest.items, [])
    assert.equal(digest.muted, 1, 'muted is the entire point of mute, but the count still shows')
  })

  it('skips closed and imported deals', () => {
    const closed = deal({ id: 'a', stage: 'closed-lost', nextActionDate: TODAY })
    const history = deal({ id: 'b', historical: true, nextActionDate: TODAY })
    const digest = buildDigest('ops', { deals: [closed, history], today: TODAY })
    assert.deepEqual(digest.items, [])
    assert.equal(digest.muted, 0)
  })

  it('does not chase a questionnaire on a deal that has not been won', () => {
    // Fourteen days from an event that nobody has signed for. There is no questionnaire.
    const d = deal({ stage: 'inquiry', eventDate: '2026-09-14' })
    assert.deepEqual(kinds(buildDigest('ops', { deals: [d], today: TODAY }).items), [])
  })

  it('ignores an event date that has already passed', () => {
    const d = deal({ stage: 'pre-event', eventDate: '2026-09-01' })
    assert.deepEqual(kinds(buildDigest('ops', { deals: [d], today: TODAY }).items), [])
  })
})

describe('buildDigest — the items', () => {
  it('raises a hold that has sat three weeks', () => {
    const fresh = deal({ id: 'a', stage: 'qualified', holdDate: '2026-09-01' })
    const stale = deal({ id: 'b', stage: 'qualified', holdDate: '2026-08-10' })
    const digest = buildDigest('ops', { deals: [fresh, stale], today: TODAY })
    assert.deepEqual(
      digest.items.filter((i) => i.kind === 'stale-hold').map((i) => i.dealId),
      ['b'],
    )
  })

  it('names the outstanding logistics rather than saying “not complete”', () => {
    const d = deal({ stage: 'pre-event', eventDate: '2026-09-15', questionnaireReceived: true })
    const digest = buildDigest('ops', {
      deals: [d],
      today: TODAY,
      openLogisticsByDeal: new Map([['rec1', ['AV contact', 'Hotel']]]),
    })
    const item = digest.items.find((i) => i.kind === 'logistics')
    assert.ok(item, 'logistics item exists at T-8')
    assert.match(item.detail, /AV contact, Hotel/)
  })

  it('falls back to a plain sentence when no tasks are open', () => {
    const d = deal({ stage: 'pre-event', eventDate: '2026-09-15', questionnaireReceived: true })
    const item = buildDigest('ops', { deals: [d], today: TODAY }).items.find(
      (i) => i.kind === 'logistics',
    )
    assert.match(item!.detail, /not marked complete/)
  })

  it('surfaces a coaching track that has stopped moving', () => {
    const d = deal({
      dealType: 'speaker-coaching',
      stage: 'closed-won',
      lastModified: '2026-07-01T00:00:00.000Z',
    })
    const sessions: CoachingSession[] = [
      { id: 's1', dealId: 'rec1', sessionNumber: 1, scheduledFor: null, held: true, notes: null },
      { id: 's2', dealId: 'rec1', sessionNumber: 2, scheduledFor: null, held: false, notes: null },
    ]
    const digest = buildDigest('ops', {
      deals: [d],
      today: TODAY,
      sessionsByDeal: new Map([['rec1', sessions]]),
    })
    assert.ok(kinds(digest.items).includes('coaching'))
  })

  it('leaves a journal order alone until it is actually red', () => {
    const amber = { id: 'f1', dealId: 'rec1', status: 'Quote requested', shipBy: '2026-12-01', quantity: 100 } as unknown as Fulfillment
    const red = { id: 'f2', dealId: 'rec1', status: 'Ordered', shipBy: '2026-12-01', quantity: 100 } as unknown as Fulfillment
    const digest = buildDigest('ops', { deals: [], today: TODAY, fulfillment: [amber, red] })
    assert.equal(digest.items.filter((i) => i.kind === 'journal').length, 1)
  })
})

describe('buildDigest — the order', () => {
  it('puts the expensive things first', () => {
    // Somebody reads the top three lines. What sits there is the most consequential
    // decision in this file.
    const clash = deal({ id: 'a' })
    const late = deal({ id: 'b', stage: 'qualified', holdDate: '2026-08-01' })
    const chase = deal({ id: 'c', nextActionDate: TODAY, followUpCount: 0 })
    const digest = buildDigest('ops', {
      deals: [late, chase, clash],
      today: TODAY,
      conflictDealIds: new Set(['a']),
    })
    assert.deepEqual(kinds(digest.items), ['conflict', 'chase', 'stale-hold'])
  })
})

describe('renderDigest', () => {
  it('says so when there is nothing, rather than sending nothing', () => {
    // Silence that means "no work" and silence that means "the worker died" have to
    // look different, or the first teaches people to ignore the second.
    const { subject, body } = renderDigest({ owner: 'ops', items: [], muted: 0 }, 'Liezel')
    assert.match(subject, /Nothing needs you/)
    assert.match(body, /Morning Liezel/)
  })

  it('mentions the muted count so nobody thinks the list is everything', () => {
    const { body } = renderDigest({ owner: 'ops', items: [], muted: 3 }, 'Liezel')
    assert.match(body, /3 deal\(s\) are muted/)
  })

  it('leads with the count and lists every item', () => {
    const digest = buildDigest('ops', {
      deals: [deal({ id: 'a', nextActionDate: TODAY }), deal({ id: 'b', stage: 'qualified', holdDate: '2026-08-01' })],
      today: TODAY,
    })
    const { subject, body } = renderDigest(digest, 'Liezel')
    assert.equal(subject, '2 things today')
    assert.equal(body.split('\n').filter((l) => l.includes('—')).length, 2)
  })

  it('says “1 thing”, not “1 things”', () => {
    const one = buildDigest('ops', { deals: [deal({ nextActionDate: TODAY })], today: TODAY })
    assert.equal(renderDigest(one, 'Ben').subject, '1 thing today')
  })
})
