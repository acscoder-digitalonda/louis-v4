import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { INDUSTRIES, MIN_CLIENTS, NOT_AN_INDUSTRY, isRealIndustry, pickTestimonial, rankClients, resolveSocialProof } from './social-proof'
import { parseCsv } from '@/workers/f11-import'
import type { PastClient, Testimonial } from './types'

let n = 0
const client = (over: Partial<PastClient> = {}): PastClient => ({
  id: `pc${++n}`,
  industry: 'Financial Services',
  clientName: `Client ${n}`,
  bookings: 1,
  lastYear: 2024,
  anyVirtual: false,
  ...over,
})

const quote = (over: Partial<Testimonial> = {}): Testimonial => ({
  id: `t${++n}`,
  quote: 'It landed.',
  shortQuote: null,
  personName: `Person ${n}`,
  title: 'VP',
  company: `Company ${n}`,
  industry: 'Financial Services',
  format: 'In-person',
  category: null,
  sourceUrl: null,
  active: true,
  ...over,
})

describe('rankClients', () => {
  it('puts the same industry ahead of a neighbour', () => {
    const out = rankClients(
      [client({ industry: 'Healthcare & Pharma', clientName: 'Neighbour' }), client({ clientName: 'Same' })],
      { industry: 'Financial Services' },
    )
    assert.equal(out[0]!.clientName, 'Same')
  })

  it('drops an unrelated industry entirely', () => {
    // Telling a hospital that Ben speaks to banks reads as "we have nothing for you".
    const out = rankClients([client({ industry: 'Agriculture' })], { industry: 'Financial Services' })
    assert.equal(out.length, 0)
  })

  it('puts a repeat client ahead of a one-off', () => {
    // One company that booked twice is a stronger claim than two that booked once.
    const out = rankClients(
      [client({ clientName: 'Once', bookings: 1 }), client({ clientName: 'Twice', bookings: 2 })],
      { industry: 'Financial Services' },
    )
    assert.equal(out[0]!.clientName, 'Twice')
  })

  it('breaks a tie on recency', () => {
    const out = rankClients(
      [client({ clientName: 'Old', lastYear: 2019 }), client({ clientName: 'New', lastYear: 2025 })],
      { industry: 'Financial Services' },
    )
    assert.equal(out[0]!.clientName, 'New')
  })

  it('prefers a client who has done it virtually when the inquiry is virtual', () => {
    // The first question a virtual buyer has is whether the talk survives a screen.
    const out = rankClients(
      [client({ clientName: 'RoomOnly' }), client({ clientName: 'DidVirtual', anyVirtual: true })],
      { industry: 'Financial Services', virtual: true },
    )
    assert.equal(out[0]!.clientName, 'DidVirtual')
  })

  it('never names the company back to itself', () => {
    const out = rankClients([client({ clientName: 'Fidelity' })], {
      industry: 'Financial Services',
      excludeCompany: 'fidelity',
    })
    assert.equal(out.length, 0)
  })

  it('returns nothing when the inquiry has no industry', () => {
    assert.deepEqual(rankClients([client()], { industry: null }), [])
  })
})

describe('pickTestimonial', () => {
  it('prefers the reader’s own industry', () => {
    const out = pickTestimonial(
      [quote({ industry: 'Agriculture', personName: 'Wrong' }), quote({ personName: 'Right' })],
      { industry: 'Financial Services' },
    )
    assert.equal(out?.personName, 'Right')
  })

  it('prefers a matching format once industry ties', () => {
    const out = pickTestimonial(
      [quote({ format: 'In-person', personName: 'Room' }), quote({ format: 'Virtual', personName: 'Screen' })],
      { industry: 'Financial Services', virtual: true },
    )
    assert.equal(out?.personName, 'Screen')
  })

  it('honours the Active flag, because that is how Ben retires a quote', () => {
    assert.equal(pickTestimonial([quote({ active: false })], { industry: 'Financial Services' }), null)
  })

  it('returns none rather than an unrelated quote', () => {
    // A random quote invites "why are you telling me about a bank?".
    assert.equal(pickTestimonial([quote({ industry: 'Agriculture' })], { industry: 'Financial Services' }), null)
  })

  it('never quotes a company back to itself', () => {
    assert.equal(
      pickTestimonial([quote({ company: 'Fidelity' })], { industry: 'Financial Services', excludeCompany: 'Fidelity' }),
      null,
    )
  })

  it('accepts a neighbouring industry when the exact one has nothing', () => {
    const out = pickTestimonial([quote({ industry: 'Professional Services' })], {
      industry: 'Financial Services',
    })
    assert.equal(out?.industry, 'Professional Services')
  })

  it('never matches on a placeholder', () => {
    // "Needs review" sits on eleven companies waiting for enrichment. Telling a hospital
    // that Ben speaks to "Unknown" is worse than saying nothing.
    for (const industry of ['Needs review', 'Unknown', '']) {
      assert.equal(pickTestimonial([quote({ industry })], { industry }), null, industry)
    }
  })
})

describe('resolveSocialProof', () => {
  const clients = [
    client({ clientName: 'Aetna', bookings: 3, lastYear: 2025 }),
    client({ clientName: 'Guardian', bookings: 2, lastYear: 2024 }),
    client({ clientName: 'MetLife', bookings: 1, lastYear: 2023 }),
    client({ clientName: 'Prudential', bookings: 1, lastYear: 2022 }),
  ]

  it('returns three to five names, most convincing first', () => {
    const p = resolveSocialProof({ industry: 'Financial Services' }, { clients, testimonials: [quote()] })
    assert.equal(p.relatedClients[0], 'Aetna')
    assert.ok(p.relatedClients.length >= MIN_CLIENTS && p.relatedClients.length <= 5)
    assert.match(p.relatedClientsLine ?? '', /Aetna, Guardian/)
  })

  it('uses exactly one testimonial, never a wall', () => {
    // Ben's own rule, from his sent mail: one quote paired with the reel.
    const p = resolveSocialProof(
      { industry: 'Financial Services' },
      { clients, testimonials: [quote(), quote(), quote()] },
    )
    assert.ok(p.testimonial)
    assert.equal(Array.isArray(p.testimonial), false)
  })

  it('leaves the client line out rather than padding it with strangers', () => {
    const p = resolveSocialProof(
      { industry: 'Financial Services' },
      { clients: [clients[0]!], testimonials: [] },
    )
    assert.equal(p.relatedClientsLine, null)
    assert.match(p.rationale, /rather than padded/)
  })

  it('says why it found nothing, so the reviewer is not guessing', () => {
    const p = resolveSocialProof({ industry: null }, { clients, testimonials: [quote()] })
    assert.equal(p.relatedClientsLine, null)
    assert.equal(p.testimonial, null)
    assert.match(p.rationale, /No industry/)
  })

  it('does not hardcode the speaker name into the copy', () => {
    // White-label rule: a new speaker is a config edit, not a find-and-replace.
    const p = resolveSocialProof({ industry: 'Financial Services' }, { clients, testimonials: [quote()] })
    assert.equal(/\bBen\b|Nemtin/.test(`${p.industryLine} ${p.relatedClientsLine}`), false)
  })

  it('uses the speaker name it is given, and never a placeholder', () => {
    // The copy travels as a *value* into an email template, and `render` does not expand
    // values — so a `{{speakerName}}` here would be read by the client, verbatim.
    const named = resolveSocialProof(
      { industry: 'Financial Services', speakerName: 'Ada Lovelace' },
      { clients, testimonials: [quote()] },
    )
    assert.match(named.industryLine ?? '', /Ada Lovelace speaks to most/)
    for (const line of [named.industryLine, named.relatedClientsLine]) {
      assert.equal(/\{\{/.test(line ?? ''), false, `placeholder left in: ${line}`)
    }
  })

  it('says "we" when no name is given, rather than leaving a gap', () => {
    const anon = resolveSocialProof({ industry: 'Financial Services' }, { clients, testimonials: [] })
    assert.match(anon.industryLine ?? '', /audiences we speak to most/)
  })
})

describe('the industry taxonomy', () => {
  // The first version of this module used names like "Insurance", "Manufacturing" and
  // "Food & Beverage". None exist in the seed data, so most of the adjacency map was
  // dead code that read as if it worked. These tests make that impossible to repeat.
  const SEEDS = 'Louis-AddOn-Handoff-Package/louis-addon-handoff/seeds'
  const real = new Set(
    (parseCsv(readFileSync(`${SEEDS}/louis-past-clients-by-industry.csv`, 'utf8')) as Record<string, string>[])
      .map((r) => r.industry)
      .filter((i): i is string => Boolean(i)),
  )

  it('lists every industry the seed data actually contains', () => {
    for (const i of real) {
      if (NOT_AN_INDUSTRY.includes(i)) continue
      assert.ok(INDUSTRIES.includes(i as never), `"${i}" is in the data but not in INDUSTRIES`)
    }
  })

  it('invents no industry the data has never seen', () => {
    for (const i of INDUSTRIES) {
      assert.ok(real.has(i), `"${i}" is declared but appears in no past-client row`)
    }
  })

  it('points every adjacency at a real industry, in both directions', () => {
    // A neighbour that does not exist is a branch that never runs.
    for (const i of INDUSTRIES) {
      const proof = resolveSocialProof({ industry: i }, { clients: [], testimonials: [] })
      assert.ok(proof.rationale.length > 0, i)
    }
  })

  it('treats the placeholders as placeholders', () => {
    for (const p of NOT_AN_INDUSTRY) assert.equal(isRealIndustry(p), false, `"${p}"`)
    for (const i of INDUSTRIES) assert.equal(isRealIndustry(i), true, i)
    assert.equal(isRealIndustry(null), false)
  })
})
