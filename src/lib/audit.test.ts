import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { agentActor, diffFields, display, fieldLabel, humanActor } from './audit'

describe('display', () => {
  it('treats empty, null and undefined as the same absence', () => {
    for (const v of [null, undefined, '']) assert.equal(display(v), null, String(v))
  })

  it('keeps a zero and a false, which are values', () => {
    // `0` for a fee and `false` for a flag are real. Folding them into "empty" would
    // silently drop the change and make it unrevertable.
    assert.equal(display(0), '0')
    assert.equal(display(false), 'false')
  })

  it('renders an object once, stably', () => {
    assert.equal(display({ id: 'r1', name: 'X' }), '{"id":"r1","name":"X"}')
  })
})

describe('diffFields', () => {
  it('records only what actually changed', () => {
    const out = diffFields({ stage: 'sales', fee: 20000 }, { stage: 'closed-won', fee: 20000 })
    assert.deepEqual(out, [{ key: 'stage', oldValue: 'sales', newValue: 'closed-won' }])
  })

  it('ignores a field the patch did not mention', () => {
    // A partial update carries `undefined` for everything it leaves alone. Logging those
    // would fill the audit log with edits nobody made and make a revert restore blanks.
    assert.deepEqual(diffFields({ stage: 'sales', fee: 20000 }, { fee: undefined }), [])
  })

  it('records a clearing, because null is a value and undefined is not', () => {
    assert.deepEqual(diffFields({ holdDate: '2026-03-02' }, { holdDate: null }), [
      { key: 'holdDate', oldValue: '2026-03-02', newValue: null },
    ])
    assert.deepEqual(diffFields({ holdDate: '2026-03-02' }, { holdDate: undefined }), [])
  })

  it('does not log a change of type alone', () => {
    assert.deepEqual(diffFields({ fee: 40000 }, { fee: '40000' }), [])
  })

  it('records a field that did not exist before', () => {
    assert.deepEqual(diffFields({}, { location: 'Boston' }), [
      { key: 'location', oldValue: null, newValue: 'Boston' },
    ])
  })

  it('records every changed field, in the order the patch gave them', () => {
    const out = diffFields(
      { stage: 'sales', fee: null, location: null },
      { stage: 'closed-won', fee: 40000, location: 'Boston' },
    )
    assert.deepEqual(out.map((c) => c.key), ['stage', 'fee', 'location'])
    assert.deepEqual(out[1], { key: 'fee', oldValue: null, newValue: '40000' })
  })
})

describe('actors', () => {
  it('distinguishes a person from a worker', () => {
    assert.deepEqual(humanActor('liezel@bennemtin.com'), {
      kind: 'human',
      email: 'liezel@bennemtin.com',
    })
    assert.deepEqual(agentActor('C2'), { kind: 'agent', worker: 'C2' })
  })
})

describe('fieldLabel', () => {
  it('logs the name a person reads in Airtable, not the code key', () => {
    assert.equal(fieldLabel('deals', 'negotiatedFee'), 'Negotiated Fee')
  })

  it('falls back to the key rather than throwing on an unknown field', () => {
    assert.equal(fieldLabel('deals', 'somethingNew'), 'somethingNew')
  })
})
