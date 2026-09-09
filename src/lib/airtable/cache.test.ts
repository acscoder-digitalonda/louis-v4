import { strict as assert } from 'node:assert'
import { beforeEach, describe, it } from 'node:test'
import { DEFAULT_TTL_MS, cacheKey, cacheStats, invalidate, invalidateAll, readThrough, resetCache, setRecentWriteProbe } from './cache'

const t0 = 1_757_000_000_000

describe('readThrough', () => {
  beforeEach(resetCache)

  it('fetches once and serves the rest from memory', async () => {
    let calls = 0
    const load = async () => { calls += 1; return ['a'] }
    await readThrough('deals', {}, 9, load, t0)
    await readThrough('deals', {}, 9, load, t0 + 1_000)
    await readThrough('deals', {}, 9, load, t0 + 2_000)
    assert.equal(calls, 1)
    assert.equal(cacheStats().hits, 2)
  })

  it('fetches again once the entry has gone cold', async () => {
    let calls = 0
    const load = async () => { calls += 1; return ['a'] }
    await readThrough('deals', {}, 9, load, t0)
    await readThrough('deals', {}, 9, load, t0 + DEFAULT_TTL_MS + 1)
    assert.equal(calls, 2)
  })

  it('keeps different queries apart', async () => {
    let calls = 0
    const load = async () => { calls += 1; return [] }
    await readThrough('deals', {}, 9, load, t0)
    await readThrough('deals', { filterByFormula: 'x' }, 1, load, t0)
    await readThrough('clients', {}, 7, load, t0)
    assert.equal(calls, 3)
  })

  it('treats the same query written two ways as one', async () => {
    // Two callers asking the same question must share an entry, or the cache halves its
    // own hit rate for no reason.
    assert.equal(
      cacheKey('deals', { maxRecords: 5, view: 'x' }),
      cacheKey('deals', { view: 'x', maxRecords: 5 }),
    )
  })

  it('counts what it saved, not how many calls it served', async () => {
    // A cached whole-table read of 802 deals saves nine requests, not one. Counting it
    // as one would make the meter flatter and less useful than the truth.
    const load = async () => []
    await readThrough('deals', {}, 9, load, t0)
    await readThrough('deals', {}, 9, load, t0 + 1)
    assert.equal(cacheStats().requestsSaved, 9)
  })
})

describe('invalidate', () => {
  beforeEach(resetCache)

  it('makes you see your own write', async () => {
    // The case people actually notice: accept a proposal, reload, and it is still there.
    let value = 'before'
    const load = async () => value
    assert.equal(await readThrough('deals', {}, 9, load, t0), 'before')

    value = 'after'
    invalidate('deals')
    assert.equal(await readThrough('deals', {}, 9, load, t0 + 1), 'after')
  })

  it('drops every query on the table, not just the exact one', async () => {
    // Working out which cached filters a new row would have matched means
    // re-implementing filterByFormula, and getting that subtly wrong shows someone a
    // list their own new record is missing from.
    const load = async () => 'x'
    await readThrough('deals', {}, 9, load, t0)
    await readThrough('deals', { filterByFormula: 'a' }, 1, load, t0)
    invalidate('deals')
    assert.equal(cacheStats().entries, 0)
  })

  it('leaves other tables alone', async () => {
    const load = async () => 'x'
    await readThrough('deals', {}, 9, load, t0)
    await readThrough('clients', {}, 7, load, t0)
    invalidate('deals')
    assert.equal(cacheStats().entries, 1)
  })

  it('clears everything on request', async () => {
    await readThrough('deals', {}, 9, async () => 'x', t0)
    invalidateAll()
    assert.equal(cacheStats().entries, 0)
  })
})

describe('what this is worth', () => {
  beforeEach(resetCache)

  it('collapses a session of clicking into one fetch per table', async () => {
    // /pipeline, /deals, /crm, /queue, /money, /journal is 93 requests uncached. The
    // tables overlap heavily, so a warm cache turns a lap of the app into almost nothing.
    const cost: Record<string, number> = { deals: 9, clients: 7, contacts: 14, dealProposals: 3 }
    const lap = [
      ['deals', 'dealProposals'], ['deals', 'clients'], ['clients', 'contacts', 'deals'],
      ['dealProposals', 'deals'], ['deals'], ['deals'],
    ]

    let fetches = 0
    for (const page of lap) {
      for (const table of page) {
        await readThrough(table as never, {}, cost[table]!, async () => { fetches += 1; return [] }, t0)
      }
    }

    assert.equal(fetches, 4, 'four tables fetched once each, not fourteen reads')
    assert.ok(cacheStats().requestsSaved >= 50, `saved ${cacheStats().requestsSaved} requests`)
  })
})

describe('read your own writes', () => {
  it('serves from memory for everyone, but loads afresh for a browser that just wrote', async () => {
    // The cache is per instance. A write on one instance clears only that instance, so
    // the pipeline rendered elsewhere showed the old column until a hard refresh. The
    // middleware stamps the writing browser; a fresh stamp means "load, don't serve".
    resetCache()
    let loads = 0
    const load = async () => ++loads
    const t0 = 1_000_000
    await readThrough('deals', { q: 1 }, 1, load, t0)
    await readThrough('deals', { q: 1 }, 1, load, t0 + 1000)
    assert.equal(loads, 1, 'a second read within the TTL is a hit')

    setRecentWriteProbe(async () => true)
    try {
      await readThrough('deals', { q: 1 }, 1, load, t0 + 2000)
      assert.equal(loads, 2, 'a fresh stamp bypasses the hit and loads')
    } finally {
      setRecentWriteProbe(null)
    }
    await readThrough('deals', { q: 1 }, 1, load, t0 + 3000)
    assert.equal(loads, 2, 'and the fresh value it loaded is what everyone gets next')
  })
})
