#!/usr/bin/env tsx
/**
 * WP4.1 — seeds Rate Cards and Products from Decisions Log §4.
 *
 *   npm run seed:pricing             dry run
 *   npm run seed:pricing -- --apply  write it
 *
 * Idempotent on Label / Name, so a re-run after Ben edits a number does not duplicate the
 * row or overwrite his edit — an existing row is reported and left alone. Changing a
 * price is a cell edit in Airtable, which is the entire point of the table.
 *
 * Two things here are deliberately not what the source spec said:
 *
 *  - **Overseas weekend surcharges are 0, with rule `None`.** Decisions Log §4: an
 *    overseas trip consumes the weekend in travel anyway, so the surcharge is not a
 *    thing there. Jordan's open-items list (§5) asks Ben to confirm; a zero that Ben
 *    changes to a number later is a cell edit, and a wrong number seeded confidently is
 *    a wrong invoice.
 *
 *  - **Half day and full day are Products, not rate cards.** They are add-ons to a
 *    keynote, never sold alone, so they belong on a line item where the quantity and the
 *    override live.
 */

import { fieldRef } from '../src/lib/airtable/fields'
import { createRecords, listRecords, readConfig } from '../src/lib/airtable/rest'
import { rateRegionCodec, secondaryTypeCodec, weekendRuleCodec } from '../src/lib/data/airtable-codec'
import type { RateRegion, SecondaryDealType, WeekendRule } from '../src/lib/types'

interface CardSeed {
  label: string
  region: RateRegion | null
  format: SecondaryDealType
  baseFee: number
  weekendSurcharge: number
  weekendRule: WeekendRule
  travelBuyout: number
  travelTerms: string
}

const DOMESTIC_TERMS = 'Client covers ground transport and hotel.'
const OVERSEAS_TERMS =
  "Client books lie-flat first class on Ben's choice of airline, plus ground transport and hotel."

/** The 2026 rows, exactly as Decisions Log §4 lists them. */
const CARDS: CardSeed[] = [
  {
    label: '2026 · US / non-remote Canada · in-person',
    region: 'us-canada',
    format: 'in-person',
    baseFee: 37_500,
    weekendSurcharge: 2_500,
    weekendRule: 'event-date',
    travelBuyout: 2_500,
    travelTerms: DOMESTIC_TERMS,
  },
  {
    label: '2026 · Mexico / Caribbean / Central America / remote Canada · in-person',
    region: 'near-international',
    format: 'in-person',
    baseFee: 50_000,
    weekendSurcharge: 0,
    weekendRule: 'none',
    travelBuyout: 0,
    travelTerms: OVERSEAS_TERMS,
  },
  {
    label: '2026 · Europe / South America / Japan · in-person',
    region: 'europe-samerica-japan',
    format: 'in-person',
    baseFee: 60_000,
    weekendSurcharge: 0,
    weekendRule: 'none',
    travelBuyout: 0,
    travelTerms: OVERSEAS_TERMS,
  },
  {
    label: '2026 · Middle East / India / Africa / Asia / Australia · in-person',
    region: 'far-international',
    format: 'in-person',
    baseFee: 70_000,
    weekendSurcharge: 0,
    weekendRule: 'none',
    travelBuyout: 0,
    travelTerms: OVERSEAS_TERMS,
  },
  {
    // No region: nobody travels, so where the client sits does not price the talk.
    label: '2026 · Virtual · any region',
    region: null,
    format: 'virtual',
    baseFee: 20_000,
    weekendSurcharge: 0,
    weekendRule: 'none',
    travelBuyout: 0,
    travelTerms: '',
  },
]

interface ProductSeed {
  name: string
  kind: string
  unitPrice: number
  physical: boolean
}

const PRODUCTS: ProductSeed[] = [
  // Workshops: add-ons to a keynote, never standalone (Gap Analysis §1).
  { name: 'Half-day workshop', kind: 'Workshop', unitPrice: 7_000, physical: false },
  { name: 'Full-day workshop', kind: 'Workshop', unitPrice: 14_000, physical: false },
  // Journals: physical, so each line item spawns a Fulfillment record.
  { name: 'Journal', kind: 'Journal', unitPrice: 25, physical: true },
  { name: 'Book — What Do You Want To Do Before You Die?', kind: 'Book', unitPrice: 20, physical: true },
  // Priced at zero on purpose: Dream fulfilment is given, not sold. An override on the
  // line item, not a special case in code.
  { name: 'Dream Wall', kind: 'Dream Wall', unitPrice: 0, physical: false },
  { name: 'Dream fulfilment', kind: 'Other', unitPrice: 0, physical: false },
]

async function main() {
  const apply = process.argv.includes('--apply')
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  const existingCards = new Set(
    (await listRecords(cfg, 'rateCards'))
      .map((r) => String(r.fields[fieldRef('rateCards', 'label')] ?? ''))
      .filter(Boolean),
  )
  const existingProducts = new Set(
    (await listRecords(cfg, 'products'))
      .map((r) => String(r.fields[fieldRef('products', 'name')] ?? ''))
      .filter(Boolean),
  )

  const newCards = CARDS.filter((c) => !existingCards.has(c.label))
  const newProducts = PRODUCTS.filter((p) => !existingProducts.has(p.name))

  console.log(`Rate Cards: ${existingCards.size} present, ${newCards.length} to add.`)
  for (const c of newCards) {
    const wk = c.weekendSurcharge > 0 ? ` (+${c.weekendSurcharge.toLocaleString()} weekend)` : ''
    console.log(`  + ${c.baseFee.toLocaleString().padStart(7)}${wk.padEnd(22)} ${c.label}`)
  }

  console.log(`\nProducts: ${existingProducts.size} present, ${newProducts.length} to add.`)
  for (const p of newProducts) {
    console.log(`  + ${String(p.unitPrice).padStart(6)}  ${p.name}${p.physical ? '  (physical)' : ''}`)
  }

  console.log(
    '\nOverseas weekend surcharges are seeded 0 with rule None — an overseas trip eats',
  )
  console.log('the weekend in travel anyway. Jordan\'s §5 asks Ben to confirm before go-live.')

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.')
    return
  }

  if (newCards.length > 0) {
    await createRecords(
      cfg,
      'rateCards',
      newCards.map((c) => ({
        [fieldRef('rateCards', 'label')]: c.label,
        [fieldRef('rateCards', 'year')]: 2026,
        [fieldRef('rateCards', 'dealType')]: 'Keynote',
        [fieldRef('rateCards', 'secondaryType')]: secondaryTypeCodec.toAirtable(c.format),
        ...(c.region ? { [fieldRef('rateCards', 'rateRegion')]: rateRegionCodec.toAirtable(c.region) } : {}),
        [fieldRef('rateCards', 'baseFee')]: c.baseFee,
        [fieldRef('rateCards', 'weekendSurcharge')]: c.weekendSurcharge,
        [fieldRef('rateCards', 'weekendRule')]: weekendRuleCodec.toAirtable(c.weekendRule),
        [fieldRef('rateCards', 'travelBuyout')]: c.travelBuyout,
        [fieldRef('rateCards', 'travelTerms')]: c.travelTerms,
        [fieldRef('rateCards', 'effectiveFrom')]: '2026-01-01',
        [fieldRef('rateCards', 'active')]: true,
      })),
    )
  }

  if (newProducts.length > 0) {
    await createRecords(
      cfg,
      'products',
      newProducts.map((p) => ({
        [fieldRef('products', 'name')]: p.name,
        [fieldRef('products', 'kind')]: p.kind,
        [fieldRef('products', 'unitPrice')]: p.unitPrice,
        [fieldRef('products', 'physical')]: p.physical,
        [fieldRef('products', 'active')]: true,
      })),
    )
  }

  console.log(`\nSeeded ${newCards.length} rate card(s) and ${newProducts.length} product(s).`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
