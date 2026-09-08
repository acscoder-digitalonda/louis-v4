import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { inWindow, repliedAt, slaState, workingMinutes } from './sla'
import { DEFAULT_QUIET_HOURS } from './quiet-hours'
import type { Draft } from './types'

// Quiet hours are 21:00–07:00 Los Angeles, which in September is UTC-7:
// quiet runs 04:00–14:00 UTC.
const at = (iso: string) => new Date(iso)

const draft = (over: Partial<Draft> = {}) =>
  ({
    id: 'd1',
    dealId: 'rec1',
    type: 'follow-up',
    status: 'sent',
    sentAt: null,
    createdAt: '2026-09-08T16:00:00.000Z',
    ...over,
  }) as unknown as Draft

describe('workingMinutes', () => {
  it('counts a plain hour inside the working day', () => {
    assert.equal(workingMinutes(at('2026-09-08T16:00:00Z'), at('2026-09-08T17:00:00Z')), 60)
  })

  it('counts nothing across the night', () => {
    // 05:00 to 06:00 UTC is the middle of the night in Los Angeles. Nobody failed.
    assert.equal(workingMinutes(at('2026-09-08T05:00:00Z'), at('2026-09-08T06:00:00Z')), 0)
  })

  it('resumes when the day starts', () => {
    // 03:30 UTC (20:30 local, still working) to 14:30 UTC (07:30 local).
    // Half an hour before quiet, half an hour after.
    assert.equal(workingMinutes(at('2026-09-08T03:30:00Z'), at('2026-09-08T14:30:00Z')), 60)
  })

  it('returns zero for a backwards or empty interval', () => {
    assert.equal(workingMinutes(at('2026-09-08T17:00:00Z'), at('2026-09-08T16:00:00Z')), 0)
    assert.equal(workingMinutes(at('2026-09-08T16:00:00Z'), at('2026-09-08T16:00:00Z')), 0)
  })

  it('stops walking once the answer cannot change', () => {
    // A deal left open for a year must not cost eight thousand iterations to answer
    // "yes, more than an hour".
    const long = workingMinutes(at('2026-01-01T16:00:00Z'), at('2026-09-08T16:00:00Z'), DEFAULT_QUIET_HOURS, 61)
    assert.ok(long >= 61 && long < 200)
  })
})

describe('repliedAt', () => {
  it('takes the earliest send', () => {
    const drafts = [
      draft({ id: 'a', sentAt: '2026-09-08T17:00:00.000Z' }),
      draft({ id: 'b', sentAt: '2026-09-08T16:20:00.000Z' }),
    ]
    assert.equal(repliedAt(drafts, 'rec1'), '2026-09-08T16:20:00.000Z')
  })

  it('ignores a draft that was written but never sent', () => {
    // Writing a reply is the office working. The client cannot see it.
    assert.equal(repliedAt([draft({ status: 'approved', sentAt: null })], 'rec1'), null)
    assert.equal(repliedAt([draft({ status: 'proposed', sentAt: null })], 'rec1'), null)
  })

  it('ignores another deal’s reply', () => {
    assert.equal(repliedAt([draft({ dealId: 'other', sentAt: '2026-09-08T16:20:00Z' })], 'rec1'), null)
  })
})

describe('slaState', () => {
  const deal = { id: 'rec1', createdAt: '2026-09-08T16:00:00.000Z' }

  it('counts down inside the hour', () => {
    const s = slaState(deal, [], at('2026-09-08T16:20:00Z'))
    assert.equal(s.breached, false)
    assert.equal(Math.round(s.remaining), 40)
    assert.match(s.label, /Reply due in 40 min/)
  })

  it('breaches once the working hour is up', () => {
    const s = slaState(deal, [], at('2026-09-08T17:30:00Z'))
    assert.equal(s.breached, true)
    assert.match(s.label, /the hour is up/)
  })

  it('does not breach overnight', () => {
    // Arrived at 21:00 local; it is now 03:00 local. Six hours on the wall clock,
    // no working minutes. Claiming a breach here is lying about a failure.
    const night = { id: 'rec1', createdAt: '2026-09-09T04:30:00.000Z' }
    const s = slaState(night, [], at('2026-09-09T10:00:00Z'))
    assert.equal(s.breached, false)
    assert.match(s.label, /once the day starts/)
  })

  it('is never breached once a reply has gone', () => {
    const late = [draft({ sentAt: '2026-09-08T19:00:00.000Z' })]
    const s = slaState(deal, late, at('2026-09-09T16:00:00Z'))
    assert.equal(s.breached, false)
    assert.match(s.label, /Replied after 180 min/)
  })

  it('records a reply that made it', () => {
    const s = slaState(deal, [draft({ sentAt: '2026-09-08T16:35:00.000Z' })], at('2026-09-08T18:00:00Z'))
    assert.equal(s.label, 'Replied in 35 min.')
  })
})

describe('inWindow', () => {
  const now = at('2026-09-08T16:00:00Z')

  it('takes a fresh inquiry', () => {
    assert.equal(inWindow({ stage: 'inquiry', createdAt: '2026-09-08T15:00:00.000Z' }, now), true)
  })

  it('leaves a three-day-old inquiry to the digest', () => {
    assert.equal(inWindow({ stage: 'inquiry', createdAt: '2026-09-05T15:00:00.000Z' }, now), false)
  })

  it('ignores a deal that has moved on', () => {
    assert.equal(inWindow({ stage: 'qualified', createdAt: '2026-09-08T15:00:00.000Z' }, now), false)
  })
})
