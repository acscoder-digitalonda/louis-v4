import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  DEFAULT_LOOKBACK_DAYS,
  backfillQuery,
  dedupe,
  dedupeKey,
  queryFor,
  resolveAccounts,
} from './accounts'
import type { MailAccount } from '../types'
import { TABLES } from '@/lib/airtable/schema'
import { isFreeMailDomain } from '@/lib/enrichment'
import { speaker } from '~/speaker.config'

const account = (over: Partial<MailAccount> = {}): MailAccount => ({
  id: 'a1',
  address: 'liezel@bennemtin.com',
  label: 'Liezel',
  scope: 'Watched label',
  watchedLabel: 'louis',
  lookbackDays: 2,
  active: true,
  ...over,
})

const message = (over: Partial<Parameters<typeof dedupeKey>[0]> = {}) => ({
  id: 'gmail-id-1',
  threadId: 't1',
  from: 'jenna@goodmanspeakers.com',
  date: '2026-09-08T10:00:00Z',
  ...over,
})

describe('resolveAccounts', () => {
  it('reads the table when it has rows', () => {
    const out = resolveAccounts([account(), account({ id: 'a2', address: 'ben@bennemtin.com' })])
    assert.equal(out.length, 2)
    assert.equal(out[0]!.address, 'liezel@bennemtin.com')
  })

  it('keeps the table order, because the first copy of a message wins', () => {
    const out = resolveAccounts([
      account({ address: 'ben@bennemtin.com' }),
      account({ id: 'a2', address: 'liezel@bennemtin.com' }),
    ])
    assert.equal(out[0]!.address, 'ben@bennemtin.com')
  })

  it('skips an inactive account', () => {
    assert.deepEqual(resolveAccounts([account({ active: false })]), [])
  })

  it('decodes the scope Airtable stores', () => {
    assert.equal(resolveAccounts([account({ scope: 'Full mailbox' })])[0]!.scope, 'full')
    assert.equal(resolveAccounts([account({ scope: 'Watched label' })])[0]!.scope, 'label')
  })

  it('falls back to the environment, and only to watched-label', () => {
    // An unconfigured install reading every message in somebody's mailbox is a surprise
    // nobody asked for.
    const out = resolveAccounts([], { addresses: 'a@x.com, b@x.com', label: 'inbox-louis' })
    assert.equal(out.length, 2)
    for (const a of out) {
      assert.equal(a.scope, 'label')
      assert.equal(a.watchedLabel, 'inbox-louis')
      assert.equal(a.lookbackDays, DEFAULT_LOOKBACK_DAYS)
    }
  })

  it('sweeps nothing when nothing is configured anywhere', () => {
    assert.deepEqual(resolveAccounts([], {}), [])
  })
})

describe('queryFor', () => {
  it('scopes to the label when that is the setting', () => {
    const q = queryFor(resolveAccounts([account()])[0]!)
    assert.match(q, /label:louis/)
    assert.match(q, /newer_than:2d/)
  })

  it('drops the label filter on a full mailbox', () => {
    const q = queryFor(resolveAccounts([account({ scope: 'Full mailbox' })])[0]!)
    assert.equal(/label:/.test(q), false)
  })

  it('always excludes chat, spam and trash', () => {
    // A sweep that reads spam eventually classifies a phishing mail as an inquiry and
    // puts a fake company in the pipeline.
    for (const scope of ['Full mailbox', 'Watched label']) {
      const q = queryFor(resolveAccounts([account({ scope })])[0]!)
      for (const excluded of ['-in:chats', '-in:spam', '-in:trash']) {
        assert.ok(q.includes(excluded), `${scope} / ${excluded}`)
      }
    }
  })

  it('uses a relative window so a missed week is still caught', () => {
    // An absolute date computed at deploy time goes stale silently.
    assert.match(queryFor(resolveAccounts([account({ lookbackDays: 30 })])[0]!), /newer_than:30d/)
  })

  it('takes an absolute date only for a deliberate backfill', () => {
    const q = backfillQuery(resolveAccounts([account()])[0]!, '2019-01-01')
    assert.match(q, /after:2019\/01\/01/)
    assert.equal(/newer_than/.test(q), false)
  })
})

describe('dedupeKey', () => {
  it('uses the Message-ID header, which is the same in every mailbox', () => {
    // Gmail ids are per mailbox. Deduping on them makes two records of one email, two
    // classifications, and eventually two deals for one inquiry.
    const inBens = message({ id: 'gmail-ben', headers: [{ name: 'Message-Id', value: '<abc@mail.com>' }] })
    const inLiezels = message({ id: 'gmail-liezel', headers: [{ name: 'message-id', value: '<abc@mail.com>' }] })
    assert.equal(dedupeKey(inBens), dedupeKey(inLiezels))
    assert.notEqual(inBens.id, inLiezels.id)
  })

  it('normalises the angle brackets and the case', () => {
    // A key that differs by punctuation is not a key.
    assert.equal(
      dedupeKey(message({ headers: [{ name: 'Message-ID', value: '<ABC@Mail.com>' }] })),
      dedupeKey(message({ headers: [{ name: 'Message-ID', value: 'abc@mail.com' }] })),
    )
  })

  it('falls back to something stable when a sender omits the header', () => {
    const a = dedupeKey(message({ id: 'gmail-ben' }))
    const b = dedupeKey(message({ id: 'gmail-liezel' }))
    assert.equal(a, b, 'still the same email across two mailboxes')
    assert.notEqual(a, dedupeKey(message({ threadId: 't2' })))
  })
})

describe('dedupe', () => {
  it('drops the second copy of one email', () => {
    const headers = [{ name: 'Message-ID', value: '<same@mail.com>' }]
    const out = dedupe(
      [message({ id: 'ben', headers }), message({ id: 'liezel', headers })],
      new Set(),
    )
    assert.equal(out.fresh.length, 1)
    assert.equal(out.duplicates, 1)
  })

  it('keeps the first copy, so mailbox order decides', () => {
    const headers = [{ name: 'Message-ID', value: '<same@mail.com>' }]
    const out = dedupe([message({ id: 'first', headers }), message({ id: 'second', headers })], new Set())
    assert.equal(out.fresh[0]!.id, 'first')
  })

  it('drops what a previous sweep already recorded', () => {
    const headers = [{ name: 'Message-ID', value: '<old@mail.com>' }]
    const out = dedupe([message({ headers })], new Set(['old@mail.com']))
    assert.equal(out.fresh.length, 0)
    assert.equal(out.duplicates, 1)
  })

  it('keeps two genuinely different emails', () => {
    const out = dedupe(
      [
        message({ headers: [{ name: 'Message-ID', value: '<one@mail.com>' }] }),
        message({ headers: [{ name: 'Message-ID', value: '<two@mail.com>' }] }),
      ],
      new Set(),
    )
    assert.equal(out.fresh.length, 2)
    assert.equal(out.duplicates, 0)
  })
})

describe('the dedupe key has somewhere to live', () => {
  it('is declared on the Emails table, not just on the type', () => {
    // It was on the `Email` type, written by F2 on every create, read by `decodeEmail`,
    // and declared in neither `schema.ts` nor the base. The encoder dropped it without
    // a word, so every sweep re-ingested every message it had already seen — twice in
    // a row on the live base before anyone noticed.
    const emails = TABLES.emails.fields.map((f) => f.key)
    assert.ok(emails.includes('messageId'), 'Emails.messageId must exist to dedupe on')
    assert.ok(emails.includes('mailbox'), 'Emails.mailbox records which copy was read')
  })
})

describe('what may become a company', () => {
  it('refuses mailbox providers and our own domain', () => {
    // The first live sweep created companies called "gmail" and "bennemtin" — one from a
    // prospect on a personal address, the other from our own team forwarding an enquiry
    // inwards. A fake company is worse than a blank one: social proof, repeat-client
    // rollups and every export key on it.
    assert.equal(isFreeMailDomain('gmail.com'), true)
    assert.equal(isFreeMailDomain('outlook.com'), true)
    assert.equal(isFreeMailDomain('bennemtin.com'), false, 'the team domain is not free mail')
    assert.equal(
      'bennemtin.com' === speaker.teamDomain.toLowerCase(),
      true,
      'it is excluded by being ours, which is a separate test',
    )
    assert.equal(isFreeMailDomain('janney.com'), false)
  })
})
