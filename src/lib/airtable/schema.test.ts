/**
 * Schema invariants.
 *
 * The bug these exist for is real and already happened: an import wrote the domain key
 * `pre-event` where Airtable's select wanted the label `Pre-Event`, and because writes
 * use `typecast: true`, Airtable *created the wrong option* instead of rejecting it.
 * The field ended up holding both spellings and `scripts/repair-stage-choices.ts` had to
 * clean it up. Nothing in the type system connects a codec to a select's choice list, so
 * a test has to.
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { PRESERVED_TABLES, PURGEABLE_TABLES, TABLES, TABLE_KEYS } from './schema'
import {
  closedLostReasonCodec,
  dealStatusCodec,
  dealTypeCodec,
  rateRegionCodec,
  secondaryTypeCodec,
  stageCodec,
} from '../data/airtable-codec'
import { speaker } from '~/speaker.config'

function choices(table: keyof typeof TABLES, key: string): string[] {
  const field = TABLES[table].fields.find((f) => f.key === key)
  assert.ok(field, `${String(table)}.${key} exists`)
  assert.ok(field.choices, `${String(table)}.${key} has choices`)
  return field.choices
}

describe('select choices match their codec', () => {
  const cases: [keyof typeof TABLES, string, { toAirtable(v: never): string }, readonly string[]][] = [
    ['deals', 'stage', stageCodec, speaker.stages.map((s) => s.key)],
    ['deals', 'dealType', dealTypeCodec, ['keynote', 'speaker-coaching', 'executive-coaching']],
    ['deals', 'secondaryType', secondaryTypeCodec, ['in-person', 'virtual']],
    ['deals', 'dealStatus', dealStatusCodec, ['cold', 'warm', 'hot']],
    ['deals', 'rateRegion', rateRegionCodec, ['us-canada', 'near-international', 'europe-samerica-japan', 'far-international']],
    ['deals', 'closedLostReason', closedLostReasonCodec, [
      'budget', 'date-unavailable', 'chose-another-speaker',
      'no-speaker', 'postponed', 'went-quiet', 'other', 'junk',
    ]],
  ]

  for (const [table, key, codec, domainKeys] of cases) {
    it(`${String(table)}.${key}`, () => {
      const listed = choices(table, key)
      const encoded = domainKeys.map((k) => codec.toAirtable(k as never))
      assert.deepEqual(
        encoded,
        listed,
        `every domain value must appear in the select, in order — otherwise typecast invents an option`,
      )
    })
  }

  it('covers every stage the speaker config defines', () => {
    // A stage added to the config but not to the schema is a stage the app can set and
    // Airtable will silently create as a new option.
    assert.equal(choices('deals', 'stage').length, speaker.stages.length)
  })
})

describe('rate bands', () => {
  it('names regions the way Decisions Log §4 groups them', () => {
    // Bands are geographic groupings, not countries: "US / non-remote Canada" is one
    // band, and remote Canada sits in the next one up because the trip is the cost.
    assert.equal(rateRegionCodec.toAirtable('us-canada'), 'US / non-remote Canada')
    assert.match(rateRegionCodec.toAirtable('near-international'), /remote Canada/)
  })

  it('does not treat virtual as a region', () => {
    // Virtual is a Secondary Deal Type. A virtual talk costs the same wherever the
    // client is, because nobody travels — so its rate card row matches any region.
    for (const k of ['us-canada', 'near-international', 'europe-samerica-japan', 'far-international'] as const) {
      assert.equal(/virtual/i.test(rateRegionCodec.toAirtable(k)), false, k)
    }
  })
})

describe('the table registry', () => {
  it('keys every table by its own key', () => {
    for (const k of TABLE_KEYS) assert.equal(TABLES[k].key, k, k)
  })

  it('gives every field a name and a type', () => {
    for (const k of TABLE_KEYS) {
      for (const f of TABLES[k].fields) {
        assert.ok(f.key && f.name && f.type, `${k}.${f.key}`)
      }
    }
  })

  it('has no duplicate field key inside a table', () => {
    for (const k of TABLE_KEYS) {
      const keys = TABLES[k].fields.map((f) => f.key)
      assert.equal(new Set(keys).size, keys.length, k)
    }
  })

  it('points every link at a table that exists', () => {
    for (const k of TABLE_KEYS) {
      for (const f of TABLES[k].fields) {
        if (f.link) assert.ok(TABLES[f.link], `${k}.${f.key} -> ${f.link}`)
      }
    }
  })

  it('marks every formula, rollup and lookup computed', () => {
    // The app renders computed fields read-only and the encoder must never write them;
    // an unmarked one would be offered as editable and then rejected by Airtable.
    for (const k of TABLE_KEYS) {
      for (const f of TABLES[k].fields) {
        if (['formula', 'rollup', 'lookup', 'createdTime', 'lastModifiedTime'].includes(f.type)) {
          assert.equal(f.computed, true, `${k}.${f.key} is a ${f.type}`)
        }
      }
    }
  })

  it('splits every table into preserved or purgeable, never both, never neither', () => {
    for (const k of TABLE_KEYS) {
      const preserved = PRESERVED_TABLES.includes(k)
      const purgeable = PURGEABLE_TABLES.includes(k)
      assert.notEqual(preserved, purgeable, `${k} must be exactly one`)
    }
  })

  it('never purges what a person configured', () => {
    // A purge that emptied the rate card or the bureau list would take a day to rebuild
    // by hand and nobody would notice until a price came out wrong.
    for (const k of ['rateCards', 'products', 'templates', 'testimonials', 'bureauCompanies', 'users', 'settings'] as const) {
      assert.ok(PRESERVED_TABLES.includes(k), k)
    }
  })
})
