import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { DEFAULT_QUIET_HOURS, NON_BATCHABLE, decideDelivery, hourIn, isQuiet, nextDeliveryAt } from './quiet-hours'
import type { QuietHours } from './quiet-hours'

const LA: QuietHours = { from: 21, to: 7, timezone: 'America/Los_Angeles', enabled: true }
// 2026-09-08T05:00Z is 22:00 the previous day in Los Angeles.
const night = new Date('2026-09-08T05:00:00Z')
const day = new Date('2026-09-08T19:00:00Z') // noon in LA

describe('hourIn', () => {
  it('reads the hour in the right zone', () => {
    assert.equal(hourIn('America/Los_Angeles', night), 22)
    assert.equal(hourIn('UTC', night), 5)
  })

  it('falls back to UTC rather than silencing everything', () => {
    // An unknown zone must be wrong loudly, not quietly.
    assert.equal(hourIn('Mars/Olympus', night), 5)
  })
})

describe('isQuiet', () => {
  it('handles a window that wraps past midnight', () => {
    // 21:00 to 07:00 is the normal case, not the edge case.
    assert.equal(isQuiet(LA, night), true, '22:00 LA')
    assert.equal(isQuiet(LA, day), false, '12:00 LA')
  })

  it('handles a window inside one day', () => {
    const lunch: QuietHours = { from: 12, to: 13, timezone: 'UTC', enabled: true }
    assert.equal(isQuiet(lunch, new Date('2026-09-08T12:30:00Z')), true)
    assert.equal(isQuiet(lunch, new Date('2026-09-08T14:00:00Z')), false)
  })

  it('is never quiet when switched off', () => {
    assert.equal(isQuiet({ ...LA, enabled: false }, night), false)
  })

  it('ships with an evening-to-morning default', () => {
    assert.ok(DEFAULT_QUIET_HOURS.from > DEFAULT_QUIET_HOURS.to, 'wraps past midnight')
    assert.equal(DEFAULT_QUIET_HOURS.enabled, true)
  })
})

describe('decideDelivery', () => {
  it('wakes people for the four things that cost money if they wait', () => {
    for (const type of NON_BATCHABLE) {
      assert.equal(decideDelivery(type, 'both', LA, night).delivery, 'now', type)
    }
  })

  it('holds good news until morning', () => {
    // A confirmed payment is lovely and keeps until breakfast.
    for (const type of ['payment-confirmed', 'contract-signed', 'review-item'] as const) {
      assert.equal(decideDelivery(type, 'both', LA, night).delivery, 'digest', type)
    }
  })

  it('delivers everything during working hours', () => {
    assert.equal(decideDelivery('payment-confirmed', 'both', LA, day).delivery, 'now')
  })

  it('respects off, even for an alert', () => {
    // Turning something off is a decision a person made; overriding it teaches them the
    // switch is a lie.
    assert.equal(decideDelivery('red-alert', 'off', LA, day).delivery, 'suppressed')
  })

  it('explains itself in every branch', () => {
    // A system that quietly holds something back is indistinguishable from one that lost
    // it, and the only way anyone finds out is the thing it held.
    for (const [type, channel] of [
      ['red-alert', 'both'],
      ['payment-confirmed', 'both'],
      ['review-item', 'off'],
    ] as const) {
      assert.ok(decideDelivery(type, channel, LA, night).reason.length > 10, `${type}/${channel}`)
    }
  })
})

describe('nextDeliveryAt', () => {
  it('is now when nothing is being held', () => {
    assert.equal(nextDeliveryAt(LA, day).getTime(), day.getTime())
  })

  it('is the end of quiet hours, not an arbitrary morning', () => {
    // Somebody who sets quiet hours to end at six wants it at six.
    const out = nextDeliveryAt(LA, night)
    assert.equal(hourIn(LA.timezone, out), LA.to)
    assert.ok(out.getTime() > night.getTime())
  })

  it('terminates even on a window that never opens', () => {
    const always: QuietHours = { from: 0, to: 24, timezone: 'UTC', enabled: true }
    assert.ok(nextDeliveryAt(always, night) instanceof Date)
  })
})
