import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { STAGE_PACKETS, ALL_STAGES } from './stages'
import { TEMPLATES, getTemplate, missingPlaceholders, render, LIBRARY_ID } from './templates'

describe('render', () => {
  it('fills what it has', () => {
    assert.equal(render('Hi {{contactFirstName}},', { contactFirstName: 'Liezel' }), 'Hi Liezel,')
    assert.equal(render('{{ eventName }}', { eventName: 'YPO' }), 'YPO', 'tolerates inner spaces')
    assert.equal(render('{{n}} days', { n: 14 }), '14 days', 'stringifies a number')
  })

  it('leaves a missing value visible rather than blanking it', () => {
    // "We are holding  for ." reads as finished copy and would get approved. The
    // literal {{holdDate}} is the thing a reviewer cannot miss.
    for (const v of [null, undefined, '']) {
      assert.equal(render('holding {{holdDate}}', { holdDate: v }), 'holding {{holdDate}}', String(v))
    }
    assert.equal(render('{{unknownKey}}', {}), '{{unknownKey}}')
  })

  it('does not fill a placeholder with a value from a later pass', () => {
    // A value containing {{...}} must not itself be expanded — that is a template
    // injection through client-supplied text.
    assert.equal(
      render('Hi {{contactFirstName}}', { contactFirstName: '{{fee}}', fee: '40000' }),
      'Hi {{fee}}',
    )
  })

  it('leaves text with no placeholders alone', () => {
    assert.equal(render('Best,\nThe team', { x: '1' }), 'Best,\nThe team')
  })
})

describe('missingPlaceholders', () => {
  it('lists each unfilled key once', () => {
    const out = render('{{a}} {{b}} {{a}}', { b: 'B' })
    assert.deepEqual(missingPlaceholders(out), ['a'])
  })

  it('is empty once everything is filled', () => {
    assert.deepEqual(missingPlaceholders(render('{{a}}', { a: 'x' })), [])
  })
})

describe('the script bank', () => {
  it('has no duplicate keys', () => {
    assert.equal(new Set(TEMPLATES.map((t) => t.key)).size, TEMPLATES.length)
  })

  it('backs every template a stage packet asks for', () => {
    // A packet naming a template that does not exist fails at send time, in front of
    // a client, rather than here.
    for (const s of ALL_STAGES) {
      for (const d of STAGE_PACKETS[s].drafts) {
        assert.ok(getTemplate(d.templateKey), `${s} wants ${d.templateKey}`)
      }
    }
  })

  it('never leaves the speaker name hard-coded', () => {
    // White-label kit §8.3: a new speaker is a new voice, same engine.
    for (const t of TEMPLATES) {
      assert.equal(/\bBen\b|Nemtin/i.test(`${t.subject} ${t.body}`), false, t.key)
    }
  })

  it('carries no em or en dash in anything a client reads', () => {
    // Jordan's acceptance list, §4: "no em/en dashes anywhere in client-facing copy."
    // His own 31 templates comply; this bank is the fallback that ships when the
    // Airtable table is empty, so it has to comply too.
    for (const t of TEMPLATES) {
      const hit = `${t.subject}\n${t.body}`.match(/[\u2013\u2014]/)
      assert.equal(hit, null, `${t.key} contains ${hit?.[0]}`)
    }
  })

  it('gives every template a subject and a body', () => {
    for (const t of TEMPLATES) {
      assert.ok(t.subject.trim().length > 0, t.key)
      assert.ok(t.body.trim().length > 0, t.key)
      assert.ok(t.label.trim().length > 0, t.key)
    }
  })

  it('closes every placeholder it opens', () => {
    for (const t of TEMPLATES) {
      const text = `${t.subject} ${t.body}`
      assert.equal(
        (text.match(/\{\{/g) ?? []).length,
        (text.match(/\}\}/g) ?? []).length,
        `${t.key} has an unbalanced placeholder`,
      )
    }
  })

  it('promises nothing in the one message that sends itself', () => {
    const ack = getTemplate('ack.inquiry')!
    assert.ok(ack.body.includes('{{contactFirstName}}'))
    assert.equal(/\bfee\b|\$|price|quote/i.test(ack.body), false, 'the auto-ack must not quote money')
  })
})

/**
 * The join between the code's template names and Jordan's library ids.
 *
 * The bank test above passed all along, because the shipped bank uses the code's names.
 * The seeded Airtable table uses Jordan's — E01, E06 — and at runtime the table wins. So
 * every draft in the product failed with "Unknown template" while the suite was green:
 * the test was checking the loser. This one checks the thing that actually runs.
 */
describe('the library join', () => {
  const csv = readFileSync(
    new URL('../../Louis-AddOn-Handoff-Package/louis-addon-handoff/seeds/louis-email-templates.csv', import.meta.url),
    'utf8',
  )
  const seeded = new Set(
    csv.split('\n').slice(1).map((l) => l.split(',')[0]?.trim()).filter((id) => /^E\d+[a-z]?$/.test(id ?? '')),
  )

  /** Every template name the code asks for, read from the source so a new one cannot slip by. */
  const asked = new Set<string>()
  for (const file of ['../workers/f6-timers.ts', '../workers/f7-drafts.ts', '../workers/f1-form-intake.ts', '../workers/f2-email-intake.ts', '../workers/f5-stage-engine.ts', './stages.ts', './reengagement.ts', './kit.ts', './coaching.ts']) {
    let src = ''
    try { src = readFileSync(new URL(file, import.meta.url), 'utf8') } catch { continue }
    for (const m of src.matchAll(/templateKey[^'\n]*'([a-z]+\.[a-z.]+)'/g)) asked.add(m[1]!)
    for (const m of src.matchAll(/'([a-z]+\.[a-z.]+)'\s*:\s*'[a-z]+\.[a-z.]+'/g)) { asked.add(m[1]!) }
  }

  it('found the names the code uses', () => {
    assert.ok(asked.has('ack.inquiry') && asked.has('followup.forcing'), `parser broke: ${[...asked].join(', ')}`)
  })

  it('maps every name the code uses to a library id', () => {
    for (const key of asked) {
      assert.ok(LIBRARY_ID[key] ?? getTemplate(key), `${key} resolves nowhere — not in LIBRARY_ID, not in the bank`)
    }
  })

  it('points every library id at a template that was actually seeded', () => {
    assert.ok(seeded.size >= 30, `only ${seeded.size} ids parsed from the CSV`)
    for (const [key, id] of Object.entries(LIBRARY_ID)) {
      assert.ok(seeded.has(id), `${key} → ${id}, but ${id} is not in the seeded library`)
    }
  })

  it('sends the bureau kit to the agent, not the client', () => {
    assert.notEqual(LIBRARY_ID['kit.welcome'], LIBRARY_ID['kit.welcome.agent'])
    assert.equal(LIBRARY_ID['kit.welcome.agent'], 'E11')
  })
})
