import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { blankish, parseFee, parseInquirySteps, parseReleasedInquiries, parseSheetDate } from './c3-sheets-seed'

describe('parseFee', () => {
  it('reads every shape Liezel actually types', () => {
    assert.equal(parseFee('20k'), 20000)
    assert.equal(parseFee('27.5k'), 27500)
    assert.equal(parseFee('$40k'), 40000)
    assert.equal(parseFee('26,900'), 26900)
    assert.equal(parseFee(' $ 37,500.00 '), 37500)
    assert.equal(parseFee('3000 net'), 3000)
  })

  it('returns null rather than guessing', () => {
    // This feeds a money field. A wrong number is worse than a missing one.
    for (const v of ['', 'n/a', '-', 'TBD', '?']) assert.equal(parseFee(v), null, `${v}`)
  })

  it('rejects a number too small to be a keynote fee', () => {
    // Audience sizes drift into the fee column. 350 is people in the room, not dollars.
    assert.equal(parseFee('350'), null)
    assert.equal(parseFee('1000'), 1000, 'but a thousand is plausible and kept')
  })
})

describe('parseSheetDate', () => {
  it('takes the day and month from the cell and the year from the tab', () => {
    assert.equal(parseSheetDate('1/5/26', 2026), '2026-01-05')
    assert.equal(parseSheetDate('3/2', 2026), '2026-03-02', 'no year in the cell')
  })

  it('trusts the tab over a mistyped year', () => {
    // The 2026 tab contains "4/16/25" for an April 2026 booking.
    assert.equal(parseSheetDate('4/16/25', 2026), '2026-04-16')
  })

  it('takes the first date of a range', () => {
    assert.equal(parseSheetDate('1/9/25 - 1/8', 2026), '2026-01-09')
  })

  it('returns null on anything that is not a date', () => {
    for (const v of ['', 'n/a', 'Spring', '13/45']) assert.equal(parseSheetDate(v, 2026), null, `${v}`)
  })
})

describe('blankish', () => {
  it('knows the several ways a cell says nothing', () => {
    for (const v of ['', '  ', 'n/a', 'N/A', 'na', '-', '?']) assert.ok(blankish(v), `${v}`)
    assert.equal(blankish('0'), false)
    assert.equal(blankish('Goodman'), false)
  })
})

describe('parseInquirySteps', () => {
  // The tracker is a printed page, not a table: month rows repeat the column labels and
  // act as section headings, and the client sits in the column the month is written in.
  const rows = [
    ['thank you! I think'],
    ['', 'V', 'JANUARY', '', 'Location', '#', 'Date', 'Audience', '$', 'Bureaus', 'Agent'],
    ['1', '', 'Hanover', '', 'Boston', '300', '1/14/26', 'Insurance', '20625', 'Goodman', 'Jenna'],
    ['', '1', 'Meta', '', 'Virtual', '70', '2/24/26', '', '6000', 'A-Speakers', 'Esteban'],
    ['', '', 'FEBRUARY', '', 'Location', '#', 'Date', 'Audience', '$', 'Bureaus', 'Agent'],
    ['1', '', 'Vertex', '', 'Hollywood, FL', '400', '2/3/26', '', '40k', 'Harry Walker', 'Molly C.'],
    ['1', '', 'Nowhere', '', '', '', '', '', '', '', ''],
  ]

  it('skips month headings without losing the rows under them', () => {
    const out = parseInquirySteps(rows, '2026')
    assert.equal(out.length, 3, 'three bookings, two month rows and one empty row dropped')
    assert.deepEqual(out.map((b) => b.client), ['Hanover', 'Meta', 'Vertex'])
  })

  it('pulls fee, bureau and agent — the fields the inbox sweep could not find', () => {
    const [hanover] = parseInquirySteps(rows, '2026')
    assert.equal(hanover!.fee, 20625)
    assert.equal(hanover!.agent, 'Jenna')
    assert.equal(hanover!.eventDate, '2026-01-14')
    assert.equal(hanover!.audienceSize, 300)
    assert.ok(hanover!.bureau, 'Goodman should normalise to a bureau, not vanish')
  })

  it('marks a virtual booking from either signal', () => {
    const [, meta] = parseInquirySteps(rows, '2026')
    assert.equal(meta!.virtual, true)
  })

  it('drops a row with neither a location nor a date', () => {
    assert.equal(parseInquirySteps(rows, '2026').some((b) => b.client === 'Nowhere'), false)
  })
})

describe('parseReleasedInquiries', () => {
  it('finds the header wherever it sits and keeps the reason', () => {
    // The reason column is the whole point: it is what makes the twelve-month
    // re-engagement segment possible.
    const out = parseReleasedInquiries([
      ['2024 released'],
      ['Company', 'Client Name', 'Email', 'City', 'Date', 'Reason', 'Other Dates'],
      ['Covetrus', 'Ryan MacBride', 'ryan@covetrus.com', 'Atlanta', 'July 30', 'In Europe', 'Feb 2025'],
      ['', '', '', '', '', '', ''],
    ])
    assert.equal(out.length, 1)
    assert.equal(out[0]!.company, 'Covetrus')
    assert.equal(out[0]!.reason, 'In Europe')
    assert.equal(out[0]!.email, 'ryan@covetrus.com')
  })

  it('returns nothing rather than guessing when there is no header', () => {
    assert.deepEqual(parseReleasedInquiries([['some', 'other', 'sheet']]), [])
  })
})
