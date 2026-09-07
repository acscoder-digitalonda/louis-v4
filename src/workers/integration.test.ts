/**
 * Tier 5 — the end-to-end walk, on the in-memory provider.
 *
 * Jordan's acceptance path, in his order: form inquiry → auto-ack → qualified → firm
 * offer on a held date → a competing hold flagged → closed-won → pre-event → delivered →
 * debriefed → a deal for next year. Then the six-day last-minute deal.
 *
 * It is one test rather than twelve because the thing under test is the *sequence*. Each
 * stage already has unit tests; what nothing covered until now is whether a deal can get
 * from one end to the other without a guard, a packet or an engine contradicting another.
 */

import { strict as assert } from 'node:assert'
import { after, before, describe, it } from 'node:test'
import { setProvider, type DataProvider } from '@/lib/data'
import { MockProvider } from '@/lib/data/mock'
import { setProviderRunner } from '@/lib/gateway'
import { changeStage, firePacket, StageBlocked } from './f5-stage-engine'
import { run as runTimers } from './f6-timers'
import { detectConflicts } from '@/lib/conflicts'
import { forecastWeight } from '@/lib/forecast'
import type { StageKey } from '@/lib/types'

const ACTOR = { kind: 'human' as const, email: 'liezel@bennemtin.com' }
const iso = (days: number) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10)

let provider: DataProvider

before(() => {
  provider = new MockProvider()
  setProvider(provider)
  setProviderRunner(async (_b, call) => ({
    text: call.json ? '{"ok":true}' : 'Draft body.',
    tokensIn: 10,
    tokensOut: 10,
    estimated: true,
  }))
})
after(() => {
  setProvider(null)
  setProviderRunner(null)
})

describe('a keynote from inquiry to next year', () => {
  it('walks the whole path without a contradiction', async () => {
    const client = await provider.createClient({ name: 'Meridian Health', industry: 'Healthcare & Pharma' })

    // 1 — the inquiry arrives and is acknowledged.
    let deal = await provider.createDeal({
      name: 'Meridian Health — Leadership Forum',
      stage: 'inquiry',
      source: 'direct',
      dealType: 'keynote',
      secondaryType: 'in-person',
      rateRegion: 'us-canada',
      client: { id: client.id, name: client.name },
    })
    const inquiry = await firePacket(deal, { source: 'integration' })
    assert.ok(inquiry.draftsRequested.length > 0, 'the auto-ack is drafted')
    assert.equal(forecastWeight(deal), 25, 'an inquiry that reached a human is worth something')

    // 2 — qualified: a date is held.
    deal = await provider.updateDeal(deal.id, { holdDate: iso(120), eventDate: iso(120) })
    ;({ deal } = await changeStage({ deal, to: 'qualified', actor: ACTOR }))
    assert.equal(forecastWeight(deal), 50)

    // 3 — firm offer needs a number, and says so.
    await assert.rejects(
      () => changeStage({ deal, to: 'firm-offer', actor: ACTOR }),
      StageBlocked,
      'a firm offer with nothing in it is not an offer',
    )
    deal = await provider.updateDeal(deal.id, { negotiatedFee: 42_000, decisionDate: iso(20) })
    ;({ deal } = await changeStage({ deal, to: 'firm-offer', actor: ACTOR }))
    assert.equal(forecastWeight(deal), 95)

    // 4 — a second client wants the same day. Detected, never resolved.
    const rival = await provider.createDeal({
      name: 'Ardent Mutual — Annual Meeting',
      stage: 'qualified',
      source: 'bureau',
      dealType: 'keynote',
      rateRegion: 'us-canada',
      holdDate: iso(120),
      eventDate: iso(120),
    })
    const clashes = detectConflicts(await provider.listDeals(), iso(0))
    const ours = clashes.find((c) => c.deals.some((d) => d.id === deal.id))
    assert.ok(ours, 'the clash is found')
    assert.equal(ours.deals.length, 2)
    assert.ok(ours.challenged, 'one side has a firm offer out, so the clock is running')
    assert.equal(
      (await provider.getDeal(rival.id))!.stage,
      'qualified',
      'nothing was released automatically',
    )

    // 5 — closed-won, then the contract gate.
    ;({ deal } = await changeStage({ deal, to: 'closed-won', actor: ACTOR }))
    assert.equal(forecastWeight(deal), 100)
    await assert.rejects(
      () => changeStage({ deal, to: 'pre-event', actor: ACTOR }),
      StageBlocked,
      'pre-event is gated on the money lookup',
    )

    // 6 — signed, so delivery can begin.
    deal = await provider.updateDeal(deal.id, { contractStatus: 'signed' })
    for (const to of ['pre-event', 'delivered', 'debriefed'] as StageKey[]) {
      ;({ deal } = await changeStage({ deal, to, actor: ACTOR }))
      assert.equal(deal.stage, to)
    }

    // 7 — the repeat. A new deal against the same company, not a shell on the old one.
    const next = await provider.createDeal({
      name: 'Meridian Health — Leadership Forum 2027',
      stage: 'inquiry',
      source: 'direct',
      dealType: 'keynote',
      client: { id: client.id, name: client.name },
    })
    const companyDeals = (await provider.listDeals()).filter((d) => d.client?.id === client.id)
    assert.equal(companyDeals.length, 2, 'two deals, one company — that is what a repeat is')
    assert.notEqual(next.id, deal.id)

    // 8 — the trail. Every stage change is attributed to the person who made it.
    const audit = await provider.listAudit(deal.id, 100)
    const stageMoves = audit.filter((e) => e.field === 'Stage')
    assert.ok(stageMoves.length >= 6, `${stageMoves.length} stage changes recorded`)
    for (const e of stageMoves) assert.equal(e.actor, ACTOR.email)
  })
})

describe('a deal that arrives six days out', () => {
  it('compresses instead of breaking', async () => {
    // Run Plan rule 4, the acceptance criterion verbatim: "a deal created at Closed-Won
    // with an event in 6 days fires every due packet in order without error."
    const today = iso(0)
    let deal = await provider.createDeal({
      name: 'Last-minute — Regional Summit',
      stage: 'closed-won',
      source: 'direct',
      dealType: 'keynote',
      eventDate: iso(6),
      negotiatedFee: 30_000,
      contractStatus: 'signed',
    })

    await firePacket(deal, { source: 'integration' })
    for (const to of ['pre-event', 'delivered'] as StageKey[]) {
      const out = await changeStage({ deal, to, actor: ACTOR })
      deal = out.deal
      assert.equal(out.packet.blocked, null, `${to} was blocked`)
    }

    const tasks = await provider.listTasks({ dealId: deal.id })
    assert.ok(tasks.length > 0)
    for (const t of tasks) {
      if (t.dueDate) assert.ok(t.dueDate >= today, `${t.title} is due ${t.dueDate}, before today`)
    }
  })
})

describe('the daily sweep over the whole base', () => {
  it('runs every engine and reports each one', async () => {
    const report = await runTimers()
    for (const key of [
      'softCheckIns', 'forcingEmails', 'staleHolds', 'questionnaireChases',
      'redAlerts', 'journalNudges', 'chasesDue', 'escalated',
      'conflictsRaised', 'fulfillmentAlerts', 'reEngagementsDue', 'briefsSent',
    ] as const) {
      assert.equal(typeof report[key], 'number', key)
    }
  })

  it('leaves the imported history alone', async () => {
    // 802 keynotes delivered between 2019 and 2026. One sweep that touched them would
    // email seven hundred companies.
    const before = (await provider.listTasks()).length
    await provider.createDeal({
      name: 'Delivered in 2019',
      stage: 'delivered',
      eventDate: '2019-06-11',
      historical: true,
    })
    await runTimers()
    const raised = (await provider.listTasks()).filter((t) => t.title.includes('Delivered in 2019'))
    assert.equal(raised.length, 0)
    assert.ok((await provider.listTasks()).length >= before)
  })
})
