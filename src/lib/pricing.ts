/**
 * WP1.1 — PRICING. List Amount is a lookup, never a formula in code.
 *
 * Decisions Log §4 is emphatic about why, and it is worth restating because the shortcut
 * is tempting: SpeakerOS's original List Amount formula hardcoded the bands and applied a
 * weekend surcharge to the US/Canada band only. Real practice differs by region — an
 * overseas trip consumes the weekend in travel anyway, so a weekend surcharge there is not
 * a thing, and "further afield" pricing already prices in the trip. A formula that
 * hardcodes that is wrong somewhere, and wrong for every future speaker.
 *
 * So: a Rate Cards table, one row per (region × format × effective year). Ben changes a
 * price by editing a cell. A new speaker's whole pricing is a CSV import.
 *
 * Negotiated Amount stays the truth. What this computes is hygiene and the forecast
 * default, exactly as the source spec says.
 */

import type { Deal, RateCard, SecondaryDealType, WeekendRule } from './types'

export interface PricedDeal {
  /** From the rate card. Null when no card matches — reported, never guessed. */
  listAmount: number | null
  /** The surcharge actually applied, and zero is different from "no rule". */
  weekendSurcharge: number
  travelStipend: number | null
  travelTerms: string | null
  /** negotiated ?? list, plus travel, plus add-ons. */
  amount: number | null
  card: RateCard | null
  /** Why no card matched, for the reviewer. Null when one did. */
  reason: string | null
}

/** Saturday or Sunday. Whether that costs anything is the rate card's call, not this. */
export function isWeekend(isoDate: string | null | undefined): boolean {
  if (!isoDate) return false
  const d = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return false
  const day = d.getUTCDay()
  return day === 0 || day === 6
}

function withinWindow(card: RateCard, on: string | null): boolean {
  if (!on) return true
  if (card.effectiveFrom && on < card.effectiveFrom) return false
  if (card.effectiveTo && on > card.effectiveTo) return false
  return true
}

/**
 * Picks the rate card for a deal.
 *
 * A virtual row carries no region, because a virtual talk costs the same wherever the
 * client sits — nobody travels. So format is matched first and region only narrows an
 * in-person card. Among several candidates the most recently effective wins, which is
 * what makes next year's price a new row rather than an edit that rewrites history.
 */
export function findRateCard(
  cards: RateCard[],
  deal: Pick<Deal, 'dealType' | 'secondaryType' | 'rateRegion' | 'eventDate'>,
): RateCard | null {
  const format: SecondaryDealType = deal.secondaryType ?? 'in-person'
  const on = deal.eventDate?.slice(0, 10) ?? null

  const candidates = cards.filter((c) => {
    if (!c.active) return false
    if (c.dealType && deal.dealType && c.dealType !== deal.dealType) return false
    if (c.secondaryType !== format) return false
    // A card with no region is the any-region row (virtual). One with a region has to
    // match, and a deal with no region set cannot claim a regional price.
    if (c.rateRegion && c.rateRegion !== deal.rateRegion) return false
    return withinWindow(c, on)
  })

  return (
    candidates.sort((a, b) => (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''))[0] ??
    null
  )
}

/** Does this card's weekend rule fire for this deal? */
export function weekendApplies(rule: WeekendRule | null, deal: Pick<Deal, 'eventDate'>): boolean {
  switch (rule) {
    case 'event-date':
      return isWeekend(deal.eventDate)
    // Travel-day rules need the travel dates, which are Logistics fields a deal may not
    // have yet. Until WP3.3 fills them, this reports false rather than inventing a day.
    case 'travel-days':
      return false
    default:
      return false
  }
}

/**
 * The full price of a deal.
 *
 * Everything here is derived. Nothing is stored, so nothing can go stale, and a price
 * change is a cell edit that takes effect the next time anyone looks.
 */
export function priceDeal(
  deal: Pick<
    Deal,
    | 'dealType'
    | 'secondaryType'
    | 'rateRegion'
    | 'eventDate'
    | 'negotiatedFee'
    | 'travelStipend'
    | 'addOnAmount'
  >,
  cards: RateCard[],
): PricedDeal {
  const card = findRateCard(cards, deal)

  if (!card) {
    // No card is not a zero. A deal priced at zero looks deliberate in a forecast; a
    // deal with no list price looks like what it is — one nobody can price yet.
    const missing: string[] = []
    if (!deal.secondaryType) missing.push('in-person or virtual')
    if (!deal.rateRegion && deal.secondaryType !== 'virtual') missing.push('a rate region')
    return {
      listAmount: null,
      weekendSurcharge: 0,
      travelStipend: deal.travelStipend,
      travelTerms: null,
      amount: deal.negotiatedFee ?? null,
      card: null,
      reason:
        missing.length > 0
          ? `No rate card: the deal needs ${missing.join(' and ')}.`
          : 'No active rate card covers this region, format and date.',
    }
  }

  const surcharge = weekendApplies(card.weekendRule, deal) ? (card.weekendSurcharge ?? 0) : 0
  const listAmount = (card.baseFee ?? 0) + surcharge

  // A manual travel stipend overrides the card's buyout: some clients book the flights.
  const travel = deal.travelStipend ?? card.travelBuyout ?? 0
  const base = deal.negotiatedFee ?? listAmount

  return {
    listAmount,
    weekendSurcharge: surcharge,
    travelStipend: deal.travelStipend ?? card.travelBuyout,
    travelTerms: card.travelTerms,
    amount: base + travel + (deal.addOnAmount ?? 0),
    card,
    reason: null,
  }
}
