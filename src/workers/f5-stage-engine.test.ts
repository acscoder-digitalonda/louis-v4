/**
 * The engine walked end to end on the in-memory provider.
 *
 * This is the test that should have existed before anyone said the delivery half of the
 * pipeline "had never run". It had never run *against Airtable* — but every packet, the
 * contract gate and the timer sweep run here in about a second, with no credentials and
 * no network, and they always could have.
 *
 * What this cannot catch is the Airtable layer: select-option spelling, link fields,
 * computed fields refusing a write, the 5 req/s limit. That is not hypothetical —
 * `scripts/repair-stage-choices.ts` exists because an import wrote the domain key
 * ("pre-event") where Airtable wanted the label ("Pre-Event"), and `typecast: true`
 * silently *created* the wrong option rather than rejecting it. A scratch base, not this
 * file, is what catches that.
 */

import { strict as assert } from 'node:assert'
import { after, before, describe, it } from 'node:test'
import { setProvider, type DataProvider } from '@/lib/data'
import { MockProvider } from '@/lib/data/mock'
import { setProviderRunner } from '@/lib/gateway'
import { STAGE_PACKETS } from '@/lib/stages'
import { changeStage, firePacket, StageBlocked } from './f5-stage-engine'
import { run as runTimers } from './f6-timers'
import type { Deal, StageKey } from '@/lib/types'

const ACTOR = { kind: 'human' as const, email: 'walk@test.example' }
const iso = (daysFromNow: number) =>
  new Date(Date.now() + daysFromNow * 864e5).toISOString().slice(0, 10)

let provider: DataProvider

before(() => {
  provider = new MockProvider()
  setProvider(provider)
  // Without this the default `claude-code` backend shells out to the Claude CLI once per
  // draft: this file took five minutes and billed real tokens before the seam existed.
  setProviderRunner(async (_backend, call) => ({
    text: call.json ? '{"ok":true}' : 'Stub draft body.',
    tokensIn: 10,
    tokensOut: 10,
    estimated: true,
  }))
})
after(() => {
  setProvider(null)
  setProviderRunner(null)
})

async function freshDeal(over: Partial<Deal> = {}): Promise<Deal> {
  const client = (await provider.listClients())[0]!
  return provider.createDeal({
    name: 'Walk test',
    stage: 'inquiry',
    client: { id: client.id, name: client.name },
    eventDate: iso(40),
    holdDate: iso(40),
    negotiatedFee: 40000,
    decisionDate: iso(5),
    ...over,
  })
}

describe('a deal walked from Inquiry to Debriefed', () => {
  it('fires a packet at every stage and is stopped only by the contract gate', async () => {
    let deal = await freshDeal()

    const inquiry = await firePacket(deal, { source: 'test' })
    assert.ok(inquiry.tasksCreated.length > 0, 'inquiry creates work')
    assert.ok(inquiry.draftsRequested.length > 0, 'inquiry drafts the auto-ack')

    for (const to of ['sales', 'closed-won'] as StageKey[]) {
      const out = await changeStage({ deal, to, actor: ACTOR })
      deal = out.deal
      assert.equal(deal.stage, to)
      assert.ok(out.packet.tasksCreated.length > 0, `${to} creates work`)
    }

    // The one hard gate. It must actually stop the move, not warn and continue.
    await assert.rejects(
      () => changeStage({ deal, to: 'pre-event', actor: ACTOR }),
      StageBlocked,
      'pre-event without a signed contract',
    )
    assert.equal((await provider.getDeal(deal.id))!.stage, 'closed-won', 'the deal did not move')

    deal = await provider.updateDeal(deal.id, { contractStatus: 'signed' })
    for (const to of ['pre-event', 'delivered', 'debriefed'] as StageKey[]) {
      const out = await changeStage({ deal, to, actor: ACTOR })
      deal = out.deal
      assert.equal(deal.stage, to)
    }
    assert.equal(deal.stage, 'debriefed')
  })

  it('creates the tasks its packet names, at every stage', async () => {
    let deal = await freshDeal({ contractStatus: 'signed' })
    await firePacket(deal, { source: 'test' })

    for (const to of ['sales', 'closed-won', 'pre-event', 'delivered', 'debriefed'] as StageKey[]) {
      const out = await changeStage({ deal, to, actor: ACTOR })
      deal = out.deal
      const expected = STAGE_PACKETS[to].tasks.map((t) => t.title)
      const created = out.packet.tasksCreated.map((t) => t.title)
      for (const title of expected) assert.ok(created.includes(title), `${to}: ${title}`)
    }
  })

  it('does not duplicate a task when the same packet fires twice', async () => {
    // Re-firing happens whenever a stage change is retried after a partial failure.
    const deal = await freshDeal()
    const first = await firePacket(deal, { source: 'test' })
    const second = await firePacket(deal, { source: 'test' })
    assert.ok(first.tasksCreated.length > 0)
    assert.equal(second.tasksCreated.length, 0, 'the second firing adds nothing')
  })

  it('records the stage change in the audit log, attributed to the person', async () => {
    let deal = await freshDeal()
    const out = await changeStage({ deal, to: 'sales', actor: ACTOR })
    deal = out.deal
    const entries = await provider.listAudit(deal.id)
    const stageEntry = entries.find((e) => e.field === 'Stage')
    assert.ok(stageEntry, 'a Stage entry exists')
    assert.equal(stageEntry.actor, ACTOR.email)
    assert.equal(stageEntry.actorKind, 'human')
    assert.equal(stageEntry.newValue, 'Sales')
  })
})

describe('the timer sweep', () => {
  it('runs over a populated base and reports every category', async () => {
    const report = await runTimers()
    for (const key of [
      'softCheckIns', 'forcingEmails', 'staleHolds',
      'questionnaireChases', 'redAlerts', 'journalNudges',
    ] as const) {
      assert.equal(typeof report[key], 'number', key)
    }
  })

  it('leaves historical deals alone', async () => {
    // 802 of the 802 deals in production are historical. If the sweep touched them it
    // would chase questionnaires for keynotes delivered in 2019.
    const before = await provider.listTasks()
    await provider.createDeal({
      name: 'Historical walk test',
      stage: 'delivered',
      eventDate: iso(-400),
      historical: true,
    })
    await runTimers()
    const after = await provider.listTasks()
    const named = after.filter((t) => t.title.includes('Historical walk test'))
    assert.equal(named.length, 0, 'no task was raised against a historical deal')
    assert.ok(after.length >= before.length)
  })
})
