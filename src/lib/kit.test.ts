import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { issueKitToken, kitReadiness, kitRecipient, publicKit, questionnaireUrlFor } from './kit'
import type { Deal } from './types'

const deal = (over: Partial<Deal> = {}) =>
  ({
    id: 'recDEAL1',
    name: 'Fidelity — Leadership Summit',
    stage: 'closed-won',
    source: 'direct',
    contractStatus: 'signed',
    paymentStatus: 'invoiced',
    client: { id: 'c1', name: 'Fidelity' },
    eventDate: '2026-10-15',
    location: 'Boston',
    stageTime: '45 minutes',
    avCheckTime: '8:30am ET',
    eventTimezone: 'America/New_York',
    kickoffDate: '2026-09-15',
    audienceProfile: '300 senior leaders',
    desiredOutcomes: 'One thing they will actually do',
    // Everything below must never reach the page.
    negotiatedFee: 42_000,
    listFee: 37_500,
    pricingNote: 'Held firm at 42k, they had budget',
    kickoffNotes: 'Contact is nervous about Q&A',
    postKeynoteNotes: 'internal',
    travelNotes: 'Hotel booked on the company card',
    ...over,
  }) as Deal

describe('the token', () => {
  it('is long enough not to be guessed', () => {
    // Not a secret in the password sense — it is emailed and forwarded — but it is the
    // only thing between a URL and the page.
    const t = issueKitToken()
    assert.ok(t.length >= 32, `${t.length} characters`)
    assert.notEqual(issueKitToken(), issueKitToken())
  })

  it('is URL safe', () => {
    for (let i = 0; i < 20; i += 1) assert.match(issueKitToken(), /^[A-Za-z0-9_-]+$/)
  })
})

describe('kitReadiness', () => {
  it('waits for the whole sequence', () => {
    // Closed Won, then contract signed, then invoice shared, then the kit. Sending it
    // early says "delighted this is happening" to somebody who has not signed anything.
    assert.equal(kitReadiness(deal()).ready, true)
    assert.equal(kitReadiness(deal({ stage: 'firm-offer' })).ready, false)
    assert.equal(kitReadiness(deal({ contractStatus: 'out' })).ready, false)
    assert.equal(kitReadiness(deal({ paymentStatus: 'unbilled' })).ready, false)
  })

  it('names what it is waiting for, in order', () => {
    const r = kitReadiness(deal({ stage: 'qualified', contractStatus: 'none', paymentStatus: 'unbilled' }))
    assert.deepEqual(r.waitingFor, [
      'the deal to reach Closed-Won',
      'the contract to be signed',
      'the deposit invoice to go out',
    ])
  })

  it('stays ready once the deal has moved past Closed-Won', () => {
    for (const stage of ['pre-event', 'delivered', 'debriefed'] as const) {
      assert.equal(kitReadiness(deal({ stage })).ready, true, stage)
    }
  })

  it('treats the invoice going out as the trigger, not the money arriving', () => {
    for (const paymentStatus of ['invoiced', 'partial', 'paid'] as const) {
      assert.equal(kitReadiness(deal({ paymentStatus })).ready, true, paymentStatus)
    }
  })
})

describe('kitRecipient', () => {
  it('stops at the agent on a bureau deal', () => {
    // Automation stops at the agent. Going round them is how a speaker loses a bureau.
    assert.equal(kitRecipient(deal({ source: 'bureau' })), 'agent')
    assert.equal(kitRecipient(deal()), 'client')
  })
})

describe('publicKit', () => {
  it('shows the client what they told us', () => {
    const kit = publicKit(deal())
    assert.equal(kit.audienceProfile, '300 senior leaders')
    assert.equal(kit.eventName, 'Fidelity — Leadership Summit')
    assert.equal(kit.location, 'Boston')
  })

  it('never carries money, however it is spelled', () => {
    // The page is public. This asserts on the shape rather than searching for a number,
    // so a fee arriving under a new name still fails.
    const kit = publicKit(deal()) as unknown as Record<string, unknown>
    for (const key of Object.keys(kit)) {
      assert.equal(
        /fee|amount|price|cost|stipend|invoice|payment/i.test(key),
        false,
        `${key} looks like money and this page is public`,
      )
    }
  })

  it('never carries an internal note', () => {
    const serialised = JSON.stringify(publicKit(deal()))
    for (const secret of [
      'Held firm at 42k',
      'nervous about Q&A',
      'company card',
      '42000',
      '37500',
    ]) {
      assert.equal(serialised.includes(secret), false, `leaked: ${secret}`)
    }
  })

  it('is an allowlist, so a new field is private by default', () => {
    // If this were a redaction, every field added to Deal next month would be public
    // until somebody noticed. Adding a key here has to be a decision.
    const withSecret = deal({ pricingNote: 'top secret' } as Partial<Deal>)
    assert.equal(JSON.stringify(publicKit(withSecret)).includes('top secret'), false)
  })

  it('tells a bureau client who to reply to', () => {
    assert.equal(publicKit(deal({ source: 'bureau' })).throughAgent, true)
  })
})

describe('questionnaireUrlFor', () => {
  it('pre-fills what the client has already told us twice', () => {
    // A questionnaire that opens by asking the company name reads as nobody listening.
    process.env.QUESTIONNAIRE_URL = 'https://airtable.com/shrABC'
    const url = questionnaireUrlFor(deal())!
    assert.match(url, /prefill_Company=Fidelity/)
    assert.match(url, /prefill_Deal=recDEAL1/)
    assert.match(url, /hide_Deal=true/, 'the deal id cannot be repointed by hand')
  })

  it('appends correctly to a base that already has a query', () => {
    process.env.QUESTIONNAIRE_URL = 'https://airtable.com/shrABC?x=1'
    assert.match(questionnaireUrlFor(deal())!, /\?x=1&prefill_Deal=/)
  })

  it('is null when no form is configured, rather than a broken link', () => {
    delete process.env.QUESTIONNAIRE_URL
    assert.equal(questionnaireUrlFor(deal()), null)
  })
})
