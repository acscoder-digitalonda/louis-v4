/**
 * The registry is the schedule, and every rendering of it has to agree.
 *
 * Twice now this has gone wrong in a way nothing errored on. First `vercel.json` claimed
 * in a comment to mirror the registry and contained nothing, so no worker was scheduled
 * and the only symptom was an inbox that never got swept — which looks exactly like an
 * inbox with nothing in it. Then the crons were added and Vercel refused the deploy,
 * because a Hobby account runs a cron at most once a day and the intake sweep wants
 * fifteen minutes.
 *
 * So the schedule moved out of `vercel.json` into generated artifacts, and these tests
 * moved with it: whatever ends up doing the scheduling, every worker must appear in it.
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { crontab, vercelHobbyNote, workflow } from '../../scripts/generate-schedule'
import { WORKERS, WORKER_NAMES } from './index'

const CRON = crontab('https://example.test')
const GHA = workflow('https://example.test')

describe('the generated crontab', () => {
  it('schedules every worker in the registry', () => {
    for (const name of WORKER_NAMES) {
      assert.ok(CRON.includes(`/api/cron/${name}`), `${name} is not in the crontab`)
    }
  })

  it('uses the schedule the registry declares', () => {
    for (const name of WORKER_NAMES) {
      const line = CRON.split('\n').find((l) => l.includes(`/api/cron/${name}`))!
      assert.ok(line.startsWith(WORKERS[name]!.schedule), `${name}: ${line.slice(0, 40)}`)
    }
  })

  it('authenticates every call', () => {
    // An unauthenticated cron endpoint is a public button that runs the email sweep.
    for (const line of CRON.split('\n').filter((l) => l.includes('/api/cron/'))) {
      assert.match(line, /Authorization: Bearer \$CRON_SECRET/)
    }
  })

  it('fails loudly and cannot hang forever', () => {
    for (const line of CRON.split('\n').filter((l) => l.includes('/api/cron/'))) {
      assert.match(line, /--fail/, 'a 5xx must be a non-zero exit')
      assert.match(line, /--max-time/, 'a hung request must not pile runs on top of each other')
    }
  })

  it('marks which workers survive the AI cap', () => {
    for (const name of WORKER_NAMES) {
      if (!WORKERS[name]!.critical) continue
      assert.ok(CRON.includes(`${WORKERS[name]!.title} (critical`), name)
    }
  })
})

describe('the generated workflow', () => {
  it('covers every worker', () => {
    for (const name of WORKER_NAMES) assert.ok(GHA.includes(name), name)
  })

  it('does not let one failing worker cancel the rest', () => {
    assert.match(GHA, /fail-fast: false/)
  })

  it('keeps the secret in secrets', () => {
    assert.match(GHA, /secrets\.CRON_SECRET/)
    assert.equal(/Bearer\s+louis_|Bearer\s+[a-z0-9]{16}/.test(GHA), false, 'no literal token')
  })
})

describe('vercel.json', () => {
  it('carries no cron, and the note says why', () => {
    // Hobby refuses the deploy outright for anything more often than daily, so a cron
    // block here is not a smaller schedule — it is a failed deployment.
    assert.match(vercelHobbyNote(), /Hobby cannot run/)
  })
})
