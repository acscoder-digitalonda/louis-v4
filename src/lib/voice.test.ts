import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { checkVoice, hasClosing, passesAcceptance, summarise } from './voice'
import { TEMPLATES } from './templates'

const has = (subject: string, body: string, rule: string) =>
  checkVoice(subject, body).some((i) => i.rule === rule)

describe('the rules Jordan calls acceptance', () => {
  it('flags an em or en dash', () => {
    // §4: "no em/en dashes anywhere in client-facing copy." The clearest single tell
    // that a machine wrote the sentence.
    assert.ok(has('Hello', 'We are holding the date — let me know.', 'dash'))
    assert.ok(has('Proposal – for you', 'Body.', 'dash'))
    assert.equal(has('Hello', 'We are holding the date, so let me know.', 'dash'), false)
  })

  it('flags an exclamation mark', () => {
    assert.ok(has('Hi', 'Great news! The date is free.', 'exclamation'))
  })

  it('flags an opener that says nothing', () => {
    assert.ok(has('Hi', 'I hope this finds you well. About the date, can you confirm?', 'opener'))
    assert.ok(has('Hi', 'I wanted to reach out about the keynote. Shall I send times?', 'opener'))
  })

  it('does not flag an opener that gets straight to it', () => {
    assert.equal(
      has('Hi', 'We are holding 16 September for you. Can you confirm by Friday?', 'opener'),
      false,
    )
  })

  it('is what passesAcceptance measures, and nothing softer', () => {
    // A long sentence is a matter of taste. A dash is not.
    const soft = checkVoice('Hi', 'It is a long note. '.repeat(20) + 'Let me know.')
    assert.ok(passesAcceptance(soft), 'advisory issues do not fail acceptance')
    assert.equal(passesAcceptance(checkVoice('Hi — there', 'Let me know.')), false)
  })
})

describe('the advisory rules', () => {
  it('notices an uncontracted phrase, and gives one example rather than ten', () => {
    const issues = checkVoice('Hi', 'It is fine. We are ready. You are set. Let me know.')
    const contraction = issues.filter((i) => i.rule === 'contraction')
    assert.equal(contraction.length, 1)
    assert.match(contraction[0]!.message, /it's/)
  })

  it('notices marketing language', () => {
    assert.ok(has('Hi', 'We are excited to work with you. Let me know.', 'superlative'))
    assert.ok(has('Hi', 'It was an amazing session. Let me know.', 'superlative'))
  })

  it('notices an email too long to read on a phone', () => {
    assert.ok(has('Hi', `${'word '.repeat(240)}Let me know.`, 'length'))
  })

  it('notices a sentence that runs on', () => {
    assert.ok(has('Hi', `${'and then '.repeat(20)}we finished. Let me know.`, 'sentence-length'))
  })
})

describe('hasClosing', () => {
  it('accepts a question', () => {
    assert.ok(hasClosing('We are holding the date. Can you confirm by Friday?'))
  })

  it('accepts an explicit next step, which is not a question', () => {
    // "I will send times on Monday" is a perfectly good close.
    assert.ok(hasClosing('Thanks for the call. I will send times on Monday.'))
    assert.ok(hasClosing('Here it is again: the questionnaire link.'))
  })

  it('rejects a note that just stops', () => {
    assert.equal(hasClosing('Thanks for the call. It was good to meet you.'), false)
  })

  it('only reads the end, so a question in the middle does not count', () => {
    const body = 'Can you confirm? ' + 'Filler sentence here. '.repeat(8) + 'Thanks.'
    assert.equal(hasClosing(body), false)
  })
})

describe('summarise', () => {
  it('says so plainly when nothing is wrong', () => {
    assert.equal(summarise([]), 'Reads clean.')
  })

  it('marks the must-fix issues differently from the advisory ones', () => {
    const out = summarise(checkVoice('Hi — there', 'It is fine.'))
    assert.match(out, /^!/m, 'a must-fix leads with !')
    assert.match(out, /^·/m, 'an advisory leads with ·')
  })
})

describe('the shipped template bank', () => {
  it('passes its own acceptance rules', () => {
    // The bank that ships when the Airtable table is empty has to clear the bar the
    // checker holds every generated draft to.
    for (const t of TEMPLATES) {
      const issues = checkVoice(t.subject, t.body)
      const must = issues.filter((i) => i.severity === 'must')
      assert.deepEqual(must, [], `${t.key}: ${summarise(must)}`)
    }
  })

  it('ends every template with a question or a next step', () => {
    for (const t of TEMPLATES) {
      assert.ok(hasClosing(t.body), `${t.key} ends without handing anything to the reader`)
    }
  })
})
