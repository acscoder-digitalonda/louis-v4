import { strict as assert } from 'node:assert'
import { beforeEach, describe, it } from 'node:test'
import { QUIET_HOURS, classifyFailure, resetReportMemory, shouldReport, statusFor } from './backend-health'
import { AirtableError } from './airtable/rest'

const airtable = (status: number, body: string) => new AirtableError(`Airtable ${status}`, status, body)

describe('classifyFailure', () => {
  it('calls a spent monthly quota something a person has to fix', () => {
    // It is a 429, but it does not clear on its own and it blocks reads as well as
    // writes. Treating it as transient would mean nobody is told the app is down.
    const err = airtable(429, '{"errors":[{"error":"PUBLIC_API_BILLING_LIMIT_EXCEEDED"}]}')
    assert.equal(classifyFailure(err), 'needs-a-person')
  })

  it('calls an ordinary rate limit transient', () => {
    assert.equal(classifyFailure(airtable(429, '{"error":"RATE_LIMIT_REACHED"}')), 'transient')
  })

  it('calls a 5xx transient', () => {
    for (const s of [500, 502, 503, 504]) {
      assert.equal(classifyFailure(airtable(s, '')), 'transient', String(s))
    }
  })

  it('calls a dropped connection transient', () => {
    assert.equal(classifyFailure({ code: 'ECONNRESET', message: 'socket hang up' }), 'transient')
    assert.equal(classifyFailure(new Error('fetch failed')), 'transient')
  })

  it('calls a revoked key or a missing base something a person has to fix', () => {
    for (const s of [401, 403, 404]) {
      assert.equal(classifyFailure(airtable(s, '')), 'needs-a-person', String(s))
    }
  })

  it('calls anything else a bug', () => {
    // A worker that throws a TypeError is exactly what the never-silent rule is for.
    assert.equal(classifyFailure(new TypeError('x is not a function')), 'bug')
    assert.equal(classifyFailure('something odd'), 'bug')
  })
})

describe('shouldReport', () => {
  beforeEach(resetReportMemory)

  it('never emails about a transient failure', () => {
    // The next run succeeds and there is nothing for a person to do.
    for (let i = 0; i < 5; i += 1) {
      assert.equal(shouldReport('f2-email-intake', 'transient'), false)
    }
  })

  it('emails about a bug once, then damps the repeats', () => {
    // This test used to assert the opposite — "always emails about a bug" — and that is
    // what it did: a worker throwing on a fifteen-minute schedule sent ninety-six
    // identical emails a day, and the ninety-sixth carried nothing the first did not.
    // The first report still goes immediately; only the repetition is held.
    const t0 = Date.parse('2026-09-08T09:00:00Z')
    assert.equal(shouldReport('f6-timers', 'bug', t0), true)
    assert.equal(shouldReport('f6-timers', 'bug', t0 + 60_000), false)
    assert.equal(shouldReport('f6-timers', 'bug', t0 + (QUIET_HOURS + 1) * 3_600_000), true)
  })

  it('emails once about a standing problem, then holds its tongue', () => {
    // The intake worker runs every fifteen minutes. Without this, one Airtable problem
    // is ninety-six identical emails a day.
    const t0 = Date.parse('2026-09-07T09:00:00Z')
    assert.equal(shouldReport('f2-email-intake', 'needs-a-person', t0), true)
    assert.equal(shouldReport('f2-email-intake', 'needs-a-person', t0 + 15 * 60_000), false)
    assert.equal(shouldReport('f2-email-intake', 'needs-a-person', t0 + 60 * 60_000), false)
  })

  it('speaks again after the quiet window', () => {
    const t0 = Date.parse('2026-09-07T09:00:00Z')
    shouldReport('f2-email-intake', 'needs-a-person', t0)
    const later = t0 + (QUIET_HOURS * 3600 + 1) * 1000
    assert.equal(shouldReport('f2-email-intake', 'needs-a-person', later), true)
  })

  it('keeps each worker separate', () => {
    // Two different workers failing is two pieces of information.
    const t0 = Date.now()
    assert.equal(shouldReport('f2-email-intake', 'needs-a-person', t0), true)
    assert.equal(shouldReport('f9-mirror', 'needs-a-person', t0), true)
  })

  it('never suppresses the first report, which is the one that carries the news', () => {
    assert.equal(shouldReport('f13-qa-sweep', 'needs-a-person'), true)
  })
})

describe('statusFor', () => {
  it('says try-again for a backend problem and our-fault for a bug', () => {
    assert.equal(statusFor('transient'), 503)
    assert.equal(statusFor('needs-a-person'), 503)
    assert.equal(statusFor('bug'), 500)
  })
})
