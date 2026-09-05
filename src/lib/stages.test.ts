import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { ALL_STAGES, BOARD_STAGES, STAGE_PACKETS, guardStage, isSkip, stageIndex } from './stages'
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
    assert.equal(BOARD_STAGES.includes('dormant' as never), false)
    assert.ok(ALL_STAGES.includes('dormant'))
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

  it('lets every other stage through', () => {
    for (const s of ALL_STAGES) {
      if (s === 'pre-event') continue
      assert.equal(guardStage(deal(), s), null, s)
    }
  })
})

describe('isSkip', () => {
  it('is false for a step forward and for going back', () => {
    assert.equal(isSkip('inquiry', 'sales'), false)
    assert.equal(isSkip('delivered', 'sales'), false)
  })

  it('is true when a stage is jumped', () => {
    assert.ok(isSkip('inquiry', 'closed-won'))
    assert.ok(isSkip('sales', 'delivered'))
  })

  it('never treats parking or reviving as a skip', () => {
    // Dormant sits last in the array, so an index comparison would call every park
    // a skip and make the UI ask for confirmation on the most ordinary action there is.
    for (const s of BOARD_STAGES) {
      assert.equal(isSkip(s, 'dormant'), false, `${s} -> dormant`)
      assert.equal(isSkip('dormant', s), false, `dormant -> ${s}`)
    }
  })
})

describe('stageIndex', () => {
  it('orders the board the way the pipeline reads', () => {
    const order = BOARD_STAGES.map(stageIndex)
    assert.deepEqual(order, [...order].sort((a, b) => a - b))
  })
})
