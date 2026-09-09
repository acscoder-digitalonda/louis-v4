import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { encodeHeader } from './mailer'

describe('encodeHeader', () => {
  it('leaves plain ASCII exactly as it was', () => {
    assert.equal(encodeHeader('Speaking Inquiry'), 'Speaking Inquiry')
  })

  it('wraps anything else in an RFC 2047 envelope', () => {
    // The product's subjects are full of em dashes. Sent raw, every mail client showed
    // "No reply yet Ã¢Â€Â" Book Ben" — the UTF-8 bytes read back as Latin-1.
    const out = encodeHeader('No reply yet — Book Ben')
    assert.match(out, /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/)
    const decoded = Buffer.from(out.slice('=?UTF-8?B?'.length, -2), 'base64').toString('utf8')
    assert.equal(decoded, 'No reply yet — Book Ben')
  })

  it('handles Vietnamese, since the office writes it', () => {
    const s = 'Xác nhận lịch — tuần tới'
    const out = encodeHeader(s)
    assert.equal(Buffer.from(out.slice(10, -2), 'base64').toString('utf8'), s)
  })
})
