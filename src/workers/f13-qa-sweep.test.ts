/**
 * The QA sweep, against a base that holds seven years of history.
 *
 * Written after the first live run: it reported every one of 802 imported deals as
 * "delivered with no open task", and would have reported 654 companies with no domain.
 * Fourteen hundred findings a night is not a report, it is the shape of the base, and it
 * buries the one mirror error that needed somebody this morning.
 */

import { strict as assert } from 'node:assert'
import { after, before, describe, it } from 'node:test'
import { setProvider, type DataProvider } from '@/lib/data'
import { MockProvider } from '@/lib/data/mock'
import { setProviderRunner } from '@/lib/gateway'
import { capPerKind, MAX_PER_KIND, run, type Finding } from './f13-qa-sweep'

let provider: DataProvider

before(() => {
  provider = new MockProvider()
  setProvider(provider)
  setProviderRunner(async () => ({ text: 'Stub summary.', tokensIn: 5, tokensOut: 5, estimated: true }))
})
after(() => {
  setProvider(null)
  setProviderRunner(null)
})

const finding = (kind: string, n: number): Finding[] =>
  Array.from({ length: n }, (_, i) => ({ kind, detail: `${kind} ${i}`, link: null }))

describe('capPerKind', () => {
  it('keeps everything when nothing floods', () => {
    const out = capPerKind(finding('mirror-error', 3))
    assert.equal(out.findings.length, 3)
    assert.deepEqual(out.elided, [])
  })

  it('caps a flood and says how much it left out', () => {
    // Silent elision would be worse than the flood: a reader who sees ten and no note
    // believes there were ten.
    const out = capPerKind(finding('missing-domain', 654))
    assert.equal(out.findings.length, MAX_PER_KIND)
    assert.deepEqual(out.elided, [`… and ${654 - MAX_PER_KIND} more missing-domain`])
  })

  it('does not let one flooding kind push out another kind entirely', () => {
    const out = capPerKind([...finding('missing-domain', 200), ...finding('mirror-error', 1)])
    assert.equal(out.findings.filter((f) => f.kind === 'mirror-error').length, 1)
  })
})

describe('the sweep on imported history', () => {
  it('never flags a historical deal for having no next task', async () => {
    const client = (await provider.listClients())[0]!
    await provider.createDeal({
      name: 'HOME DEPOT - ATL - JENNA (2019)',
      stage: 'delivered',
      historical: true,
      client: { id: client.id, name: client.name },
    })

    const report = await run()
    const flagged = report.findings.filter(
      (f) => f.kind === 'no-next-task' && f.detail.includes('HOME DEPOT'),
    )
    // Delivered is not terminal, so `isTerminal` alone did not catch these — and there
    // are 802 of them in the live base.
    assert.deepEqual(flagged, [], 'imported history is not a stalled deal')
  })

  it('only asks for a company domain on a company still in play', async () => {
    const orphanClient = await provider.createClient({ name: 'Dormant Co 2019', domain: null })
    await provider.createDeal({
      name: 'Old booking',
      stage: 'delivered',
      historical: true,
      client: { id: orphanClient.id, name: orphanClient.name },
    })

    const report = await run()
    const flagged = report.findings.filter(
      (f) => f.kind === 'missing-domain' && f.detail.includes('Dormant Co 2019'),
    )
    assert.deepEqual(flagged, [], 'a 2019 client with no domain is not tonight’s job')
  })
})
