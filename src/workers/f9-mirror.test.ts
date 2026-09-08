import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { calendarEventId, nextDay } from './f9-mirror'
import { setProvider } from '@/lib/data'
import { MockProvider } from '@/lib/data/mock'

/**
 * These two functions cost a whole debugging session between them. F9 had never once
 * run against a real calendar, and when it finally did it failed twice before it worked.
 * Both failures are encoded here so they cannot come back quietly.
 */
describe('calendarEventId', () => {
  it('only ever emits base32hex, which is all Google accepts', () => {
    // Airtable IDs are base62 and routinely contain w, x, y, z — outside base32hex.
    // Lowercasing and hoping produced "Invalid resource id value" on exactly the records
    // that happened to contain those letters, which is the worst kind of intermittent.
    for (const id of ['recWXYZabc123', 'recZZZZZZZZZZZZZZZ', 'rec1LkHBgeumjAsiF', 'recvvvvv']) {
      assert.match(calendarEventId(id), /^[a-v0-9]{5,1024}$/, `${id} produced an invalid event id`)
    }
  })

  it('is stable, so a re-push updates rather than duplicates', () => {
    assert.equal(calendarEventId('recABC'), calendarEventId('recABC'))
  })

  it('gives different deals different ids', () => {
    assert.notEqual(calendarEventId('recABC'), calendarEventId('recABD'))
  })
})

describe('nextDay', () => {
  it('returns the exclusive end date an all-day event needs', () => {
    // start === end is a zero-length event; Google rejects it.
    assert.equal(nextDay('2026-09-08'), '2026-09-09')
  })

  it('rolls over month and year boundaries', () => {
    assert.equal(nextDay('2026-09-30'), '2026-10-01')
    assert.equal(nextDay('2026-12-31'), '2027-01-01')
    assert.equal(nextDay('2028-02-28'), '2028-02-29', 'leap year')
  })
})

describe('the run heartbeat', () => {
  it('survives a round trip through settings', async () => {
    // It did not. `recordRun` wrote `{ mirrorLastRunAt } as never` and `saveSettings`
    // persists sections — theme, ai — dropping anything else without a word. So
    // `lastRunAt()` always read null, `full` was always true, and the sweep re-read all
    // 802 deals every hour: 37 Airtable requests an hour, for ever, to save 37 an hour.
    const provider = new MockProvider()
    setProvider(provider)
    try {
      const stamp = '2026-09-08T15:00:00.000Z'
      await provider.saveSettings({ mirror: { lastRunAt: stamp } })
      assert.equal((await provider.getSettings()).mirror.lastRunAt, stamp)
    } finally {
      setProvider(null)
    }
  })
})
