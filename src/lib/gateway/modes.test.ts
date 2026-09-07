import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { MODES, MODE_DEFINITIONS, isMode, relativeCost, tierFor, tierMap } from './modes'
import { TASK_TIERS, type TaskKind } from './tiers'

const ALL = Object.keys(TASK_TIERS) as TaskKind[]

describe('the mode dial', () => {
  it('leaves Steady exactly as the shipped map', () => {
    // Steady is not a mode with opinions; it is the absence of one.
    assert.deepEqual(tierMap('steady'), TASK_TIERS)
  })

  it('covers every task in every mode', () => {
    // Falling through to the shipped map means adding a task kind cannot leave a hole.
    for (const mode of MODES) {
      for (const task of ALL) assert.ok(tierMap(mode)[task], `${mode}/${task}`)
    }
  })

  it('puts the best model on reading and writing in Launch', () => {
    for (const task of ['extract', 'research', 'draft'] as TaskKind[]) {
      assert.equal(tierFor(task, 'launch'), 'opus', task)
    }
  })

  it('keeps classification cheap even in Launch', () => {
    // A yes/no on 45 threads. The expensive model is no better at it, so the money
    // would buy nothing.
    assert.equal(tierFor('classify', 'launch'), 'haiku')
  })

  it('drops every task a tier in Economy, and never below the floor', () => {
    for (const task of ALL) {
      const steady = TASK_TIERS[task]
      const economy = tierFor(task, 'economy')
      if (steady === 'haiku') assert.equal(economy, 'haiku', `${task} cannot go lower`)
      else assert.notEqual(economy, steady, task)
    }
  })

  it('orders the modes by cost the way their names claim', () => {
    assert.ok(relativeCost('launch') > 1, 'Launch costs more than Steady')
    assert.equal(relativeCost('steady'), 1)
    assert.ok(relativeCost('economy') < 1, 'Economy costs less')
  })

  it('changes which model runs, never which task runs', () => {
    // Turning the dial down makes drafts plainer. It must not silently disable a check.
    for (const mode of MODES) {
      assert.deepEqual(Object.keys(tierMap(mode)).sort(), ALL.slice().sort(), mode)
    }
  })

  it('describes every mode in a line a person can act on', () => {
    for (const mode of MODES) {
      assert.ok(MODE_DEFINITIONS[mode].summary.length > 30, mode)
      assert.ok(MODE_DEFINITIONS[mode].label.length > 0, mode)
    }
  })

  it('treats an unknown setting as Steady rather than throwing', () => {
    // An install that predates the dial has no mode, and must keep behaving as it did.
    for (const v of [undefined, null, '', 'turbo', 42]) assert.equal(isMode(v), false, String(v))
    assert.ok(isMode('economy'))
  })
})
