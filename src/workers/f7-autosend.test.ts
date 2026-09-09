/**
 * The auto-send must send.
 *
 * A source-level assertion, like the encoder test, because the bug it guards against is
 * a one-word substitution the type system cannot see: `createGmailDraft` and `sendMail`
 * take the same input, and the first one creates a draft in somebody's Gmail and returns
 * happily. That is what the auto-send branch did, before recording the draft as sent and
 * writing "Auto-sent" to the audit log. The acknowledgement the website promises within
 * minutes sat in a Drafts folder, and every screen said it had gone.
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const src = readFileSync(new URL('./f7-drafts.ts', import.meta.url), 'utf8')

describe('the auto-send branch', () => {
  const start = src.indexOf('if (req.autoSend && recipient) {')
  const end = src.indexOf('} else {', start)
  const branch = src.slice(start, end)

  it('exists where the test expects it', () => {
    assert.ok(start > 0 && end > start, 'the autoSend branch moved — update the test')
  })

  it('sends, and does not merely draft', () => {
    assert.match(branch, /\bsendMail\(/, 'the auto-send must call sendMail')
    assert.doesNotMatch(branch, /\bcreateGmailDraft\(/, 'a Gmail draft is not a send')
  })

  it('records sent only after sending', () => {
    assert.ok(branch.indexOf('sendMail(') < branch.indexOf("status: 'sent'"), 'sent is claimed before the send')
  })
})
