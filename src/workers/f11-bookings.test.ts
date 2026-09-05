import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  bureauDisplay,
  bureauKey,
  buildBureauNames,
  companyKey,
  eventDateFor,
  namesTwoBureaus,
  normaliseBureau,
  splitEmails,
  type BookingRow,
} from './f11-bookings'

describe('companyKey', () => {
  it('treats case, punctuation and legal suffixes as noise', () => {
    const k = companyKey('Janney Montgomery Scott, Inc.')
    assert.equal(k, companyKey('JANNEY MONTGOMERY SCOTT'))
    assert.equal(k, companyKey('Janney Montgomery Scott LLC'))
  })

  it('does not collapse two different companies', () => {
    assert.notEqual(companyKey('Fidelity Investments'), companyKey('Fidelity National Financial'))
  })
})

describe('splitEmails', () => {
  it('handles the three separators the cell actually uses', () => {
    assert.deepEqual(splitEmails('A@b.com; c@D.com, e@f.com'), ['a@b.com', 'c@d.com', 'e@f.com'])
  })

  it('drops a trailing full stop and anything that is not an address', () => {
    assert.deepEqual(splitEmails('jane@corp.com. not found in sources'), ['jane@corp.com'])
    assert.deepEqual(splitEmails(''), [])
  })
})

describe('bureauDisplay', () => {
  it('drops agent names hung off a dash or parenthesis', () => {
    // These produced a bureau record literally named "Brian Lord, Becky Seal".
    assert.equal(bureauDisplay('Premiere Speakers Bureau (Brian Lord, Becky Seal)'), 'Premiere Speakers Bureau')
    assert.equal(
      bureauDisplay('WSB (Washington Speakers Bureau) - Kirk Myers, Emily Blackman, Allison Lennox'),
      'Washington Speakers Bureau',
    )
  })

  it('reads through an acronym only when the parenthesis spells it out', () => {
    assert.equal(bureauDisplay('WSB (Washington Speakers Bureau)'), 'Washington Speakers Bureau')
    // The reverse shape: the parenthesis is the acronym, so the outside already wins.
    assert.equal(bureauDisplay('Executive Speakers Bureau (ESB)'), 'Executive Speakers Bureau')
    // Not an acronym expansion — a note. Promoting it named a bureau "fee remitted via".
    assert.equal(bureauDisplay('Goodman Speakers (fee remitted via Speak, Inc.)'), 'Goodman Speakers')
    assert.equal(bureauDisplay('Talent Bureau (a division of DSJ Communications Inc.)'), 'Talent Bureau')
  })

  it('takes the trading name out of a d/b/a', () => {
    assert.equal(bureauDisplay('Greater Talent Network, LLC d/b/a UTA Speakers'), 'UTA Speakers')
  })

  it('keeps the punctuation that belongs to the name', () => {
    assert.equal(bureauDisplay('Speak, Inc.'), 'Speak, Inc.')
    assert.equal(bureauDisplay("Speakers' Spotlight"), "Speakers' Spotlight")
  })

  it('returns null for the labels that are not a bureau', () => {
    for (const v of ['Stock', 'direct', 'none found', 'direct (verified email)', 'n/a', '']) {
      assert.equal(bureauDisplay(v), null, v)
    }
  })
})

describe('bureauKey', () => {
  it('folds every spelling of one bureau onto one key', () => {
    const speak = ['Speak, Inc.', 'Speak Inc.', 'Speak Inc', 'SpeakInc', 'Speak, Inc. (SpeakInc)']
    assert.equal(new Set(speak.map(bureauKey)).size, 1, speak.join(' / '))

    const wsb = ['Washington Speakers Bureau', 'Washington Speakers Bureau (WSB)', 'WSB (Washington Speakers Bureau) - Kirk Myers']
    assert.equal(new Set(wsb.map(bureauKey)).size, 1)

    const pro = ['ProSpeakers.com', 'ProSpeakers.com Inc', 'ProSpeakers (Heather MacLean)']
    assert.equal(new Set(pro.map(bureauKey)).size, 1)
  })

  it('keeps the descriptive word when it is most of the name', () => {
    // Stripping "Speakers" from "A-Speakers" leaves "a" — not an identity, and a magnet
    // for the next single-letter label that turns up.
    assert.equal(bureauKey('A-Speakers'), bureauKey('A-Speakers ApS'))
    assert.ok((bureauKey('A-Speakers') ?? '').length > 1)
  })

  it('does not fold two different bureaus together', () => {
    assert.notEqual(bureauKey('Eagles Talent Speakers Bureau'), bureauKey('Talent Bureau'))
    assert.notEqual(bureauKey('Keppler Speakers'), bureauKey('Key Speakers Bureau'))
    assert.notEqual(bureauKey('National Speakers Bureau'), bureauKey('NOPAC Talent'))
  })
})

describe('buildBureauNames', () => {
  it('gives every spelling the one name the file used most', () => {
    const labels = [
      'Speak, Inc.', 'Speak, Inc.', 'Speak, Inc.', 'Speak Inc', 'SpeakInc (Sofia Alsindy)',
    ]
    const names = buildBureauNames(labels)
    for (const l of labels) assert.equal(normaliseBureau(l, names), 'Speak, Inc.', l)
  })

  it('is stable when two spellings tie', () => {
    const a = buildBureauNames(['Key Speakers', 'KEY Speakers Bureau'])
    const b = buildBureauNames(['KEY Speakers Bureau', 'Key Speakers'])
    assert.deepEqual([...a], [...b])
  })

  it('falls back to the row label when there is no map', () => {
    assert.equal(normaliseBureau('Keppler Speakers Bureau'), 'Keppler Speakers Bureau')
  })
})

describe('namesTwoBureaus', () => {
  it('flags a row that credits two agencies', () => {
    assert.ok(namesTwoBureaus('Global Speakers Agency / National Speakers Bureau Inc.'))
    assert.ok(
      namesTwoBureaus('Premiere Speakers Bureau (obo Pink Elephant Corp.) / Executive Speakers Bureau (named in body text)'),
    )
  })

  it('ignores a slash inside a parenthetical note', () => {
    assert.equal(namesTwoBureaus('Harry Walker Agency, LLC (affiliate of Learfield/Endeavor)'), false)
    assert.equal(namesTwoBureaus('Keppler Speakers'), false)
  })
})

describe('eventDateFor', () => {
  const row = (actual: string, date: string) =>
    ({ actual_event_date: actual, date }) as BookingRow

  it('prefers the confirmed date and says so', () => {
    assert.deepEqual(eventDateFor(row('2019-06-11', '2019-01-04')), {
      date: '2019-06-11',
      verified: true,
    })
  })

  it('falls back to the booking date and flags it — 309 rows depend on this', () => {
    // The flag is the whole point: an unverified date must never read as confirmed.
    assert.deepEqual(eventDateFor(row('', '2019-01-04')), { date: '2019-01-04', verified: false })
    assert.deepEqual(eventDateFor(row('not found in sources', '2019-01-04')), {
      date: '2019-01-04',
      verified: false,
    })
  })

  it('reports no date rather than inventing one', () => {
    assert.deepEqual(eventDateFor(row('', '')), { date: null, verified: false })
  })
})
