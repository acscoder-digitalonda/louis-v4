import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { ALL_STAGES, BOARD_STAGES, STAGE_PACKETS, guardStage, isLive, isSkip, isTerminal, stageIndex } from './stages'
import type { StageKey } from './types'
import type { Deal } from './types'

const deal = (over: Partial<Deal> = {}) => ({ id: 'd1', name: 'X', ...over }) as Deal

describe('stage packets', () => {
  it('defines a packet for every stage, with the key matching', () => {
    for (const s of ALL_STAGES) {
      assert.ok(STAGE_PACKETS[s], s)
      assert.equal(STAGE_PACKETS[s].stage, s)
    }
  })

  it('keeps dormant off the board but inside the pipeline', () => {
    assert.equal(BOARD_STAGES.includes('closed-lost' as never), false)
    assert.ok(ALL_STAGES.includes('closed-lost'))
  })

  it('auto-sends exactly one draft in the whole system', () => {
    // F1's inquiry acknowledgement. Anything else reaching a client unreviewed is a bug.
    const auto = ALL_STAGES.flatMap((s) =>
      STAGE_PACKETS[s].drafts.filter((d) => d.autoSend).map((d) => `${s}:${d.templateKey}`),
    )
    assert.deepEqual(auto, ['inquiry:ack.inquiry'])
  })

  it('mirrors the sheet from every stage', () => {
    // Liezel's tracker is the one surface that must never fall behind the pipeline.
    for (const s of ALL_STAGES) assert.ok(STAGE_PACKETS[s].mirror.includes('sheet'), s)
  })
})

describe('guardStage', () => {
  it('blocks pre-event until the contract is signed', () => {
    for (const status of ['none', 'out'] as const) {
      const blocked = guardStage(deal({ contractStatus: status }), 'pre-event')
      assert.ok(blocked, status)
      assert.match(blocked, /signed/i)
    }
    assert.equal(guardStage(deal({ contractStatus: 'signed' }), 'pre-event'), null)
  })

  it('blocks pre-event when the contract status is missing, not just wrong', () => {
    // An unset lookup is not a pass. This is the one hard gate in the pipeline.
    assert.ok(guardStage(deal(), 'pre-event'))
  })

  it('blocks Firm Offer without a fee', () => {
    // A firm offer is the number. The competing-hold challenge compares against it, so
    // an offer with nothing in it has nothing to challenge.
    assert.match(guardStage(deal(), 'firm-offer') ?? '', /fee/i)
    assert.equal(guardStage(deal({ listFee: 35000 }), 'firm-offer'), null)
    assert.equal(guardStage(deal({ negotiatedFee: 28000 }), 'firm-offer'), null)
  })

  it('blocks Closed Lost without a reason', () => {
    // The reason is not a note. It is the key the twelve-month campaign segments on, so
    // a deal closed without one is a deal that can never be re-engaged.
    assert.match(guardStage(deal(), 'closed-lost') ?? '', /reason/i)
    assert.equal(guardStage(deal({ closedLostReason: 'budget' }), 'closed-lost'), null)
  })

  it('lets every ungated stage through', () => {
    const gated = new Set(['pre-event', 'firm-offer', 'closed-lost'])
    for (const s of ALL_STAGES) {
      if (gated.has(s)) continue
      assert.equal(guardStage(deal(), s), null, s)
    }
  })

  it('refuses a stage the deal type does not use', () => {
    // Coaching has no held date, so no Firm Offer and no Pre-Event logistics.
    const coaching = deal({ dealType: 'speaker-coaching', listFee: 15000 })
    assert.match(guardStage(coaching, 'firm-offer') ?? '', /not a stage/i)
    assert.match(guardStage(coaching, 'pre-event') ?? '', /not a stage/i)
    assert.equal(guardStage(coaching, 'closed-won'), null)
  })
})

describe('isSkip', () => {
  it('is false for a step forward and for going back', () => {
    assert.equal(isSkip('inquiry', 'qualified'), false)
    assert.equal(isSkip('delivered', 'qualified'), false)
  })

  it('is true when a stage is jumped', () => {
    assert.ok(isSkip('inquiry', 'closed-won'))
    assert.ok(isSkip('qualified', 'delivered'))
  })

  it('never treats parking or reviving as a skip', () => {
    // Dormant sits last in the array, so an index comparison would call every park
    // a skip and make the UI ask for confirmation on the most ordinary action there is.
    for (const s of BOARD_STAGES) {
      assert.equal(isSkip(s, 'closed-lost'), false, `${s} -> dormant`)
      assert.equal(isSkip('closed-lost', s), false, `dormant -> ${s}`)
    }
  })
})

describe('stageIndex', () => {
  it('orders the board the way the pipeline reads', () => {
    const order = BOARD_STAGES.map(stageIndex)
    assert.deepEqual(order, [...order].sort((a, b) => a - b))
  })
})

describe('isLive', () => {
  const deal = (over: Partial<{ stage: StageKey; historical: boolean }> = {}) => ({
    stage: 'delivered' as StageKey,
    historical: false,
    ...over,
  })

  it('excludes imported history even though Delivered is not terminal', () => {
    // The whole reason this function exists. Four separate places wrote
    // `!isTerminal(deal.stage)`, and all four treated 802 imported 2019 bookings as
    // live work: a nightly report of 802 stalled deals, an hourly calendar push that
    // 404'd on every one, and a weighted pipeline counting them at full weight.
    assert.equal(isLive(deal({ historical: true })), false)
    assert.equal(isTerminal('delivered'), false, 'Delivered is genuinely not terminal')
  })

  it('excludes terminal stages', () => {
    assert.equal(isLive(deal({ stage: 'closed-lost' })), false)
    assert.equal(isLive(deal({ stage: 'debriefed' })), false)
  })

  it('keeps a real deal in play', () => {
    assert.equal(isLive(deal({ stage: 'qualified' })), true)
    assert.equal(isLive(deal({ stage: 'delivered' })), true, 'delivered but not imported')
  })

  it('treats a missing historical flag as not historical', () => {
    // Callers pass partial deals; an absent flag must not silently mean "imported".
    assert.equal(isLive({ stage: 'qualified' }), true)
  })
})
