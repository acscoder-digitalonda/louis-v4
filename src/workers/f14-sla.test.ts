/**
 * The reply clock, swept on the in-memory provider.
 *
 * `now` is passed in rather than read from the machine, because half of what this worker
 * does is decide that the hour has not started yet — a test that depended on when it ran
 * would pass all afternoon and fail at midnight.
 */

import { strict as assert } from 'node:assert'
import { after, before, beforeEach, describe, it } from 'node:test'
import { setProvider, type DataProvider } from '@/lib/data'
import { MockProvider } from '@/lib/data/mock'
import { MARKER, run } from './f14-sla'
import type { Deal } from '@/lib/types'

// Quiet hours are 21:00–07:00 Los Angeles: in September that is 04:00–14:00 UTC.
const WORKING = new Date('2026-09-08T17:00:00Z') // 10am local
const NIGHT = new Date('2026-09-08T08:00:00Z') // 1am local

let provider: DataProvider

before(() => {
  provider = new MockProvider()
  setProvider(provider)
})
after(() => setProvider(null))

/** A fresh inquiry, arrived at a given moment. */
async function inquiry(createdAt: string, over: Partial<Deal> = {}): Promise<Deal> {
  return provider.createDeal({
    name: `SLA test ${createdAt}`,
    stage: 'inquiry',
    createdAt,
    ...over,
  })
}

/** Clears every deal the mock seed ships with, so counts mean what they say. */
beforeEach(async () => {
  for (const d of await provider.listDeals({ stage: 'inquiry' })) {
    await provider.updateDeal(d.id, { stage: 'qualified' })
  }
})

describe('f14-sla', () => {
  it('does nothing at all at night', async () => {
    await inquiry('2026-09-08T06:00:00.000Z')
    const report = await run(NIGHT)
    assert.equal(report.skippedQuiet, true)
    assert.equal(report.watched, 0, 'not even a read: the clock it watches is not running')
  })

  it('leaves an inquiry alone inside the hour', async () => {
    await inquiry('2026-09-08T16:30:00.000Z')
    const report = await run(WORKING)
    assert.equal(report.watched, 1)
    assert.equal(report.breached, 0)
  })

  it('raises one alert once the hour is up', async () => {
    const deal = await inquiry('2026-09-08T15:00:00.000Z')
    const first = await run(WORKING)
    assert.equal(first.breached, 1)
    assert.equal(first.alerted, 1)

    const tasks = await provider.listTasks({ dealId: deal.id })
    assert.ok(tasks.some((t) => t.title.startsWith(MARKER)), 'the marker is written')
  })

  it('does not alert twice on the same deal', async () => {
    // An alert repeated hourly for the rest of the week is an alert people mute.
    await inquiry('2026-09-08T15:00:00.000Z')
    await run(WORKING)
    const second = await run(WORKING)
    assert.equal(second.breached, 1, 'still breached')
    assert.equal(second.alerted, 0, 'but already said')
  })

  it('stops watching once a reply has gone', async () => {
    const deal = await inquiry('2026-09-08T15:00:00.000Z')
    await provider.createDraft({
      dealId: deal.id,
      type: 'follow-up',
      subject: 'Re: your enquiry',
      body: 'Yes, that date is open.',
      status: 'sent',
      toEmail: 'client@example.com',
      approver: 'liezel@example.com',
      sentAt: '2026-09-08T15:20:00.000Z',
      threadId: null,
      checkerVerdict: null,
      revisions: [],
      createdAt: '2026-09-08T15:10:00.000Z',
    })
    const report = await run(WORKING)
    assert.equal(report.watched, 1)
    assert.equal(report.breached, 0)
  })

  it('ignores an inquiry that has been sitting for days', async () => {
    // Three days at Inquiry is a follow-up problem, and the digest already owns it.
    await inquiry('2026-09-04T15:00:00.000Z')
    const report = await run(WORKING)
    assert.equal(report.watched, 0)
  })
})
