import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  addBusinessDays,
  afterChase,
  clearOnClose,
  isMuted,
  nextActionDate,
  nextActionOwner,
  shouldChase,
} from './followup'
import type { Deal } from './types'

const TODAY = '2026-09-07' // a Monday

const deal = (over: Partial<Deal> = {}) =>
  ({
    stage: 'qualified',
    muted: false,
    muteUntil: null,
    nextActionDate: null,
    followUpCount: 0,
    historical: false,
    decisionDate: null,
    ...over,
  }) as Deal

describe('addBusinessDays', () => {
  it('skips the weekend', () => {
    // Thursday + 3 business days is Tuesday, not Sunday. A chase that lands on Sunday
    // is a chase nobody reads.
    assert.equal(addBusinessDays('2026-09-03', 3), '2026-09-08')
    assert.equal(addBusinessDays('2026-09-07', 1), '2026-09-08')
  })

  it('steps off a weekend start date', () => {
    assert.equal(addBusinessDays('2026-09-05', 1), '2026-09-07', 'Saturday + 1 is Monday')
  })

  it('returns the same day for zero', () => {
    assert.equal(addBusinessDays('2026-09-07', 0), '2026-09-07')
  })
})

describe('nextActionOwner', () => {
  it('gives the first two touches to the office and the third to Ben', () => {
    // A second nudge from the office is a nudge. A note from the speaker is a moment.
    assert.equal(nextActionOwner(0), 'ops')
    assert.equal(nextActionOwner(1), 'ops')
    assert.equal(nextActionOwner(2), 'owner')
    assert.equal(nextActionOwner(9), 'owner')
  })
})

describe('isMuted', () => {
  it('holds while the mute is in force', () => {
    assert.equal(isMuted(deal({ muted: true, muteUntil: '2026-09-30' }), TODAY), true)
  })

  it('stops applying on its own once it expires', () => {
    // Nobody has to remember to un-mute. A mute that needed un-muting would be a deal
    // quietly abandoned.
    assert.equal(isMuted(deal({ muted: true, muteUntil: '2026-09-06' }), TODAY), false)
  })

  it('lasts forever when no end date is given', () => {
    assert.equal(isMuted(deal({ muted: true, muteUntil: null }), TODAY), true)
  })

  it('is false when the flag is off, whatever the date says', () => {
    assert.equal(isMuted(deal({ muted: false, muteUntil: '2027-01-01' }), TODAY), false)
  })
})

describe('nextActionDate', () => {
  it('is three business days after the last activity', () => {
    assert.equal(nextActionDate(deal(), '2026-09-07', TODAY), '2026-09-10')
  })

  it('waits out a decision date the client actually gave us', () => {
    // Chasing inside the window they named is noise, and it is the noise that loses deals.
    assert.equal(
      nextActionDate(deal({ decisionDate: '2026-09-25' }), '2026-09-07', TODAY),
      '2026-09-28',
      'the business day after the decision date',
    )
  })

  it('resumes the normal rhythm once the decision date has passed', () => {
    assert.equal(
      nextActionDate(deal({ decisionDate: '2026-09-01' }), '2026-09-07', TODAY),
      '2026-09-10',
    )
  })

  it('is due today when the computed date is already behind us', () => {
    // The no-limits rule: a chase never lands in the past and reads as overdue.
    assert.equal(nextActionDate(deal(), '2026-08-01', TODAY), TODAY)
  })

  it('is null on a closed deal', () => {
    for (const stage of ['closed-lost', 'debriefed'] as const) {
      assert.equal(nextActionDate(deal({ stage }), '2026-09-07', TODAY), null, stage)
    }
  })
})

describe('shouldChase', () => {
  it('chases when the date has arrived', () => {
    const d = shouldChase(deal({ nextActionDate: TODAY }), TODAY)
    assert.equal(d.due, true)
    assert.equal(d.owner, 'ops')
  })

  it('escalates to Ben on the third touch, and says so', () => {
    const d = shouldChase(deal({ nextActionDate: TODAY, followUpCount: 2 }), TODAY)
    assert.equal(d.owner, 'owner')
    assert.match(d.reason, /escalated/)
  })

  it('never chases imported history', () => {
    // 802 deals delivered years ago. One chase run over them would email 700 companies.
    const d = shouldChase(deal({ nextActionDate: TODAY, historical: true }), TODAY)
    assert.equal(d.due, false)
    assert.match(d.reason, /history/i)
  })

  it('never chases a closed deal', () => {
    assert.equal(shouldChase(deal({ nextActionDate: TODAY, stage: 'closed-lost' }), TODAY).due, false)
  })

  it('respects a live mute and names the end date', () => {
    const d = shouldChase(deal({ nextActionDate: TODAY, muted: true, muteUntil: '2026-09-30' }), TODAY)
    assert.equal(d.due, false)
    assert.match(d.reason, /2026-09-30/)
  })

  it('chases again once the mute has run out', () => {
    const d = shouldChase(deal({ nextActionDate: TODAY, muted: true, muteUntil: '2026-09-06' }), TODAY)
    assert.equal(d.due, true)
  })

  it('gives a reason even when nothing is due', () => {
    // An engine that silently decides not to chase is indistinguishable from a broken one.
    for (const d of [
      deal(),
      deal({ nextActionDate: '2026-12-01' }),
      deal({ nextActionDate: TODAY, muted: true }),
      deal({ nextActionDate: TODAY, historical: true }),
    ]) {
      assert.ok(shouldChase(d, TODAY).reason.length > 0)
    }
  })
})

describe('afterChase', () => {
  it('counts the touch and arms the next one', () => {
    const out = afterChase(deal({ followUpCount: 1 }), TODAY)
    assert.equal(out.followUpCount, 2)
    assert.equal(out.nextActionDate, '2026-09-10')
  })

  it('is what tips ownership to Ben', () => {
    const out = afterChase(deal({ followUpCount: 1 }), TODAY)
    assert.equal(nextActionOwner(out.followUpCount), 'owner')
  })
})

describe('clearOnClose', () => {
  it('resets the whole chase state', () => {
    // A reopened deal starts the cadence again rather than resuming mid-escalation.
    assert.deepEqual(clearOnClose(), {
      nextActionDate: null,
      followUpCount: 0,
      muted: false,
      muteUntil: null,
    })
  })
})
