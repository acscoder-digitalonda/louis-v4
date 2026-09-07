import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { findRateCard, isWeekend, priceDeal, weekendApplies } from './pricing'
import type { Deal, RateCard } from './types'

const card = (over: Partial<RateCard> = {}): RateCard => ({
  id: 'rc1',
  label: 'test',
  year: 2026,
  dealType: 'keynote',
  secondaryType: 'in-person',
  rateRegion: 'us-canada',
  baseFee: 37_500,
  weekendSurcharge: 2_500,
  weekendRule: 'event-date',
  travelBuyout: 2_500,
  travelTerms: 'Client covers ground and hotel.',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  active: true,
  ...over,
})

const deal = (over: Partial<Deal> = {}) =>
  ({
    dealType: 'keynote',
    secondaryType: 'in-person',
    rateRegion: 'us-canada',
    eventDate: '2026-03-04',
    negotiatedFee: null,
    travelStipend: null,
    addOnAmount: null,
    ...over,
  }) as Deal

const CARDS = [
  card(),
  card({ id: 'rc2', rateRegion: 'europe-samerica-japan', baseFee: 60_000, weekendSurcharge: 0, weekendRule: 'none', travelBuyout: 0 }),
  card({ id: 'rc3', rateRegion: null, secondaryType: 'virtual', baseFee: 20_000, weekendSurcharge: 0, weekendRule: 'none', travelBuyout: 0 }),
]

describe('isWeekend', () => {
  it('knows Saturday and Sunday', () => {
    assert.equal(isWeekend('2026-03-07'), true, 'Saturday')
    assert.equal(isWeekend('2026-03-08'), true, 'Sunday')
    assert.equal(isWeekend('2026-03-06'), false, 'Friday')
  })

  it('does not shift the day across a timezone', () => {
    // Parsed as UTC on purpose. Local parsing turns a Monday into a Sunday west of
    // Greenwich and quietly adds a weekend surcharge to a weekday booking.
    assert.equal(isWeekend('2026-03-09'), false, 'Monday')
  })

  it('is false for a missing or unparseable date', () => {
    for (const v of [null, undefined, '', 'soon']) assert.equal(isWeekend(v), false, String(v))
  })
})

describe('findRateCard', () => {
  it('matches on region and format', () => {
    assert.equal(findRateCard(CARDS, deal())?.id, 'rc1')
    assert.equal(findRateCard(CARDS, deal({ rateRegion: 'europe-samerica-japan' }))?.id, 'rc2')
  })

  it('matches a virtual deal against the any-region row', () => {
    // Nobody travels, so where the client sits does not price the talk. The virtual row
    // has no region and must still match a deal that has one.
    assert.equal(findRateCard(CARDS, deal({ secondaryType: 'virtual' }))?.id, 'rc3')
    assert.equal(
      findRateCard(CARDS, deal({ secondaryType: 'virtual', rateRegion: 'far-international' }))?.id,
      'rc3',
    )
  })

  it('refuses a regional price to a deal with no region', () => {
    assert.equal(findRateCard(CARDS, deal({ rateRegion: null })), null)
  })

  it('ignores an inactive card', () => {
    assert.equal(findRateCard([card({ active: false })], deal()), null)
  })

  it('respects the effective window', () => {
    const old = card({ id: 'old', baseFee: 30_000, effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31' })
    assert.equal(findRateCard([old], deal({ eventDate: '2026-03-04' })), null)
    assert.equal(findRateCard([old], deal({ eventDate: '2025-06-01' }))?.id, 'old')
  })

  it('takes the most recently effective when two overlap', () => {
    // Next year's price is a new row, not an edit that rewrites history.
    const y26 = card({ id: 'y26', effectiveFrom: '2026-01-01', baseFee: 37_500 })
    const y27 = card({ id: 'y27', effectiveFrom: '2027-01-01', baseFee: 42_000 })
    assert.equal(findRateCard([y26, y27], deal({ eventDate: '2027-05-01' }))?.id, 'y27')
  })
})

describe('weekendApplies', () => {
  it('fires on a Saturday when the rule is event-date', () => {
    assert.equal(weekendApplies('event-date', { eventDate: '2026-03-07' } as Deal), true)
    assert.equal(weekendApplies('event-date', { eventDate: '2026-03-04' } as Deal), false)
  })

  it('never fires when the rule is none', () => {
    // An overseas trip eats the weekend in travel, so the surcharge is not a thing there.
    assert.equal(weekendApplies('none', { eventDate: '2026-03-07' } as Deal), false)
    assert.equal(weekendApplies(null, { eventDate: '2026-03-07' } as Deal), false)
  })

  it('reports false for travel-days rather than inventing a travel date', () => {
    assert.equal(weekendApplies('travel-days', { eventDate: '2026-03-07' } as Deal), false)
  })
})

describe('priceDeal', () => {
  it('prices a weekday domestic keynote from the card', () => {
    const p = priceDeal(deal(), CARDS)
    assert.equal(p.listAmount, 37_500)
    assert.equal(p.weekendSurcharge, 0)
    assert.equal(p.travelStipend, 2_500)
    assert.equal(p.amount, 40_000, 'list plus travel')
  })

  it('adds the surcharge on a Saturday, and only where the card allows it', () => {
    assert.equal(priceDeal(deal({ eventDate: '2026-03-07' }), CARDS).listAmount, 40_000)
    // Same Saturday, Europe: the card says the question does not arise.
    const eu = priceDeal(deal({ eventDate: '2026-03-07', rateRegion: 'europe-samerica-japan' }), CARDS)
    assert.equal(eu.weekendSurcharge, 0)
    assert.equal(eu.listAmount, 60_000)
  })

  it('lets the negotiated fee win over the list price', () => {
    // List Amount is hygiene and a forecast default. Negotiated is the truth.
    const p = priceDeal(deal({ negotiatedFee: 30_000 }), CARDS)
    assert.equal(p.listAmount, 37_500, 'still reported')
    assert.equal(p.amount, 32_500, 'but the total uses the negotiated fee')
  })

  it('lets a manual travel stipend override the card buyout', () => {
    // Some clients book the flights themselves.
    const p = priceDeal(deal({ travelStipend: 0 }), CARDS)
    assert.equal(p.travelStipend, 0)
    assert.equal(p.amount, 37_500)
  })

  it('rolls add-ons into the total', () => {
    assert.equal(priceDeal(deal({ addOnAmount: 14_000 }), CARDS).amount, 54_000)
  })

  it('returns null rather than zero when no card matches, and says why', () => {
    // A deal priced at zero looks deliberate in a forecast. A deal with no list price
    // looks like what it is: one nobody can price yet.
    const p = priceDeal(deal({ rateRegion: null, secondaryType: null }), CARDS)
    assert.equal(p.listAmount, null)
    assert.match(p.reason ?? '', /in-person or virtual/)
    assert.match(p.reason ?? '', /rate region/)
  })

  it('still reports the negotiated fee when it cannot find a card', () => {
    const p = priceDeal(deal({ rateRegion: null, negotiatedFee: 25_000 }), CARDS)
    assert.equal(p.listAmount, null)
    assert.equal(p.amount, 25_000)
  })

  it('carries the travel terms through verbatim', () => {
    // They are rendered into the proposal and the contract. Text, not a code branch.
    assert.equal(priceDeal(deal(), CARDS).travelTerms, 'Client covers ground and hotel.')
  })
})
