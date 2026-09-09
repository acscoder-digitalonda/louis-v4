/**
 * The public form must not be able to page the admins.
 *
 * Source-level, like the encoder and auto-send tests, because the fault is an ordering: a
 * validation failure reached the failure notifier before the ZodError check, so an empty
 * POST from anyone on the internet emailed a stack trace to every admin. It did, during a
 * route sweep. A bot doing the same a thousand times would have been a thousand emails.
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const src = readFileSync(new URL('./form/route.ts', import.meta.url), 'utf8')

describe('the form route', () => {
  it('answers a validation failure before it can notify anyone', () => {
    const zod = src.indexOf("err.name === 'ZodError'")
    const notify = src.indexOf('notifyWorkerFailure(')
    assert.ok(zod > 0 && notify > 0, 'both branches must exist')
    assert.ok(zod < notify, 'the ZodError return must come before the failure notifier')
  })
})
