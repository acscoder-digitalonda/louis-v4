import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { extractDeals, type CalendarDeal } from './c1-calendar-seed'
import {
  externalAddresses,
  groupUnplaced,
  humanParticipants,
  isObviousNoise,
  isRelay,
  placeThread,
  stageForIntent,
  type Classification,
  type ThreadOutcome,
} from './c2-inbox-seed'
import type { GmailThread } from '@/lib/google/gmail'

const thread = (from: string, subject = '', body = '', to: string[] = []): GmailThread => ({
  id: `t-${from}`,
  mailbox: 'b@bennemtin.com',
  messages: [
    { id: 'm1', threadId: 't', from, to, cc: [], subject, date: '2026-09-01T00:00:00Z', snippet: '', body, labelIds: [] },
  ],
})

const holds = (titles: [string, string][]): CalendarDeal[] =>
  extractDeals(
    titles.map(([summary, date], i) => ({ id: `e${i}`, summary, start: { date } })),
    '2026-09-05',
  )

const cls = (client: string | null): Classification => ({ intent: 'inquiry', client, confidence: 1 })

describe('isRelay / humanParticipants', () => {
  it('knows the intake mailers are robots, not contacts', () => {
    // These forward a real inquiry from a real client, so the thread matters — but the
    // sending address must never become the contact or the proposal title.
    assert.ok(isRelay('noreply.ondasmtp@gmail.com'))
    assert.ok(isRelay('digitalonda.mailer@gmail.com'))
    assert.ok(isRelay('no-reply@fathom.video'))
    assert.equal(isRelay('djudge@janney.com'), false)
  })

  it('drops relays from the people on a thread but not from its addresses', () => {
    const t = thread('noreply.ondasmtp@gmail.com', '', '', ['jane@acme.com'])
    assert.deepEqual(humanParticipants(t), ['jane@acme.com'])
    assert.equal(externalAddresses(t).length, 2)
  })
})

describe('isObviousNoise', () => {
  it('rejects system senders before they cost a model call', () => {
    assert.ok(isObviousNoise(thread('quickbooks@notification.intuit.com')))
    assert.ok(isObviousNoise(thread('no-reply@fathom.video')))
  })

  it('keeps a real person', () => {
    assert.equal(isObviousNoise(thread('djudge@janney.com')), false)
  })
})

describe('placeThread', () => {
  it('matches when the domain and the thread agree on the client', () => {
    const deals = holds([['MORELAND-AUSTIN-SAM', '2026-09-23']])
    const { deal } = placeThread(thread('ahurliman@moreland.com'), cls('Moreland'), deals)
    assert.equal(deal?.client, 'MORELAND')
  })

  it('will not place five separate leads on one ROTARY hold', () => {
    // Five different people each met Ben at *a* Rotary event, all on personal gmail.
    // Name-only matching put all ten of their threads on the single ROTARY hold, where
    // they would have overwritten each other.
    const deals = holds([['ROTARY-PASADENA-GLENN', '2026-10-15']])
    for (const who of ['lksmurdoch@gmail.com', 'judithrotary@gmail.com', 'abqlaura@gmail.com']) {
      const { deal } = placeThread(thread(who), cls('Rotary'), deals)
      assert.equal(deal, null, `${who} should not have been placed`)
    }
  })

  it('will not let a location in the client name match a stranger’s domain', () => {
    // pasadena.edu is a community college with no connection to YPO Pasadena. The old
    // rule matched the place, not the client.
    const deals = holds([['YPO PASADENA-PASADENA-VANESSA', '2026-10-20']])
    const { deal } = placeThread(thread('sxdufresne@pasadena.edu'), cls(null), deals)
    assert.equal(deal, null)
  })

  it('will not let a generic word carry a match', () => {
    const deals = holds([['EVENT CONNECTIONS-PUERTO RICO-MAY', '2026-10-27']])
    const { deal } = placeThread(thread('someone@unrelated.com', 'Re: your event'), cls(null), deals)
    assert.equal(deal, null)
  })

  it('resolves a TBD hold only when the contact and the place both agree', () => {
    const deals = holds([['TBD-FT. LAUDERDALE-MICHELLE', '2026-11-18']])
    const extracted = {
      client: 'Atlantic | Pacific Companies',
      contactName: 'Michelle Fording',
      location: 'Fort Lauderdale, Florida',
    }
    const hit = placeThread(thread('mfording@apcompanies.com'), cls(null), deals, extracted)
    assert.equal(hit.deal?.clientUnknown, true)
    assert.match(hit.reason, /Resolves the "TBD" hold/)

    // Same first name, wrong city — a University of Texas Health Houston thread was
    // landing on the MIAMI hold because "miami" appeared somewhere in the body.
    const wrongCity = placeThread(
      thread('lisa@uth.edu'),
      cls(null),
      holds([['TBD-MIAMI-LISA', '2026-10-29']]),
      { client: 'University of Texas Health Houston', contactName: 'Lisa Reed', location: 'Houston, TX' },
    )
    assert.equal(wrongCity.deal, null)

    // And a thread that names no client at all resolves nothing.
    const noClient = placeThread(thread('andi@x.com'), cls(null), holds([['TBD-ORLANDO-ANDI', '2027-05-16']]), {
      client: null,
      contactName: 'Andi Smith',
      location: 'Orlando, FL',
    })
    assert.equal(noClient.deal, null)
  })
})

describe('groupUnplaced', () => {
  const outcome = (id: string, client: string | null, email: string, at: string): ThreadOutcome => ({
    threadId: id,
    mailbox: 'b@bennemtin.com',
    intent: 'inquiry',
    matched: null,
    matchReason: '',
    participants: [email],
    lastMessageAt: at,
    extraction: {
      client, eventDate: null, location: null, negotiatedFee: null, decisionDate: null,
      lane: null, bureauName: null, contractStatus: null, invoiceStatus: null,
      contactName: null, contactEmail: email, notes: null, confidence: 0.5,
    },
  })

  it('folds several threads about one prospect into a single proposal', () => {
    // Ben follows up after every keynote, so one prospect spans several threads. One row
    // each would hand the session the same person three times with no way to tell.
    const groups = groupUnplaced([
      outcome('a', 'Sun Life', 'jill@sunlife.com', '2026-09-01T00:00:00Z'),
      outcome('b', 'Sun Life', 'jill@sunlife.com', '2026-09-03T00:00:00Z'),
      outcome('c', 'YPO Rocky Mountain', 'dawn@ypo.org', '2026-09-02T00:00:00Z'),
    ])
    assert.equal(new Set([...groups.values()]).size, 2)
    const sunLife = groups.get(groups.keys().next().value!)!
    assert.equal(sunLife.members.length, 2)
    assert.equal(sunLife.lead.threadId, 'b', 'the most recent thread leads')
  })

  it('never groups on a relay address alone', () => {
    // The website form relays every inquiry from one robot. Grouping on the sender would
    // collapse unrelated clients into a single proposal.
    const groups = groupUnplaced([
      outcome('a', null, 'noreply.ondasmtp@gmail.com', '2026-09-01T00:00:00Z'),
      outcome('b', null, 'noreply.ondasmtp@gmail.com', '2026-09-02T00:00:00Z'),
    ])
    assert.equal(new Set([...groups.values()]).size, 2, 'two unnamed threads stay apart')
  })
})

describe('stageForIntent', () => {
  it('puts contract and invoice threads past the close', () => {
    assert.equal(stageForIntent('contract'), 'closed-won')
    assert.equal(stageForIntent('invoice'), 'closed-won')
    assert.equal(stageForIntent('logistics'), 'pre-event')
    assert.equal(stageForIntent('inquiry'), 'inquiry')
  })
})
