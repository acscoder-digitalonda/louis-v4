import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { closedLostReasonCodec, dealTypeCodec, stageCodec } from './airtable-codec'
import { classifyReleaseReason } from '@/workers/c3-sheets-seed'
import { speaker } from '~/speaker.config'

describe('stageCodec', () => {
  it('round-trips every stage the config defines', () => {
    for (const s of speaker.stages) {
      assert.equal(stageCodec.fromAirtable(stageCodec.toAirtable(s.key), 'inquiry'), s.key, s.key)
    }
  })

  it('reads the v3 vocabulary still stored on records', () => {
    // Without these, `fromAirtable` falls back to its default and every un-migrated
    // Sales deal silently reports as an Inquiry — 150 rows in the live base at the time
    // this was written, and no error anywhere.
    assert.equal(stageCodec.fromAirtable('Sales', 'inquiry'), 'qualified')
    assert.equal(stageCodec.fromAirtable('Dormant', 'inquiry'), 'closed-lost')
  })

  it('does not promote a v3 hold to Firm Offer', () => {
    // Nothing in a v3 record proves a priced offer went out. Guessing would move the
    // forecast from 50 to 95 on deals nobody has quoted.
    assert.notEqual(stageCodec.fromAirtable('Sales', 'inquiry'), 'firm-offer')
  })

  it('always writes the current label, never a legacy one', () => {
    const written = speaker.stages.map((s) => stageCodec.toAirtable(s.key))
    assert.equal(written.includes('Sales'), false)
    assert.equal(written.includes('Dormant'), false)
  })

  it('accepts the domain key as well as the label', () => {
    // The typecast bug wrote domain keys into the select; those records must still read.
    assert.equal(stageCodec.fromAirtable('pre-event', 'inquiry'), 'pre-event')
  })
})

describe('optional selects', () => {
  it('reads an empty value as null, not as the first choice', () => {
    // A deal with no Rate Region must not silently read as Domestic: that would price it.
    for (const v of ['', '   ', null, undefined, 42]) {
      assert.equal(dealTypeCodec.fromAirtableOrNull(v), null, String(v))
    }
  })

  it('reads a value it does not recognise as null rather than guessing', () => {
    assert.equal(closedLostReasonCodec.fromAirtableOrNull('Mercury retrograde'), null)
  })
})

describe('classifyReleaseReason', () => {
  it('reads the phrasings Liezel actually used', () => {
    assert.equal(classifyReleaseReason('Out of Budget.'), 'budget')
    assert.equal(classifyReleaseReason('Different speaker.'), 'chose-another-speaker')
    assert.equal(classifyReleaseReason('They decided to go with no speaker.'), 'no-speaker')
    assert.equal(classifyReleaseReason('Date Availability.'), 'date-unavailable')
    assert.equal(classifyReleaseReason('Busy on dates.'), 'date-unavailable')
  })

  it('sends anything it cannot place to other, not to a guess', () => {
    // A wrongly segmented campaign emails the wrong pitch to a real person.
    for (const r of ['Focus on farm bill + election year?', 'In Europe.', 'Different route.']) {
      assert.equal(classifyReleaseReason(r), 'other', r)
    }
  })

  it('returns null for no reason at all, which is different from other', () => {
    for (const r of ['', '   ', null, undefined]) assert.equal(classifyReleaseReason(r), null)
  })
})
