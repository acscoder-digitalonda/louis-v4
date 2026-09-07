#!/usr/bin/env tsx
/**
 * WP4.1 — seeds Testimonials, Past Clients by Industry, and Bureau Companies.
 *
 *   npm run seed:proof             dry run
 *   npm run seed:proof -- --apply  write it
 *
 * These three tables exist to be *read*: they are what the social-proof resolver resolves
 * against, and without them E01b is an email that says "here is what a session looks
 * like" and nothing else.
 *
 * Idempotent on the natural key of each table, so a re-run adds only what is new. Batched
 * ten records per request, because Airtable bills per request and a loop over 718 rows
 * costs 718 of them — the mistake that exhausted a month of quota in a day.
 */

import { readFileSync } from 'node:fs'
import { fieldRef } from '../src/lib/airtable/fields'
import { createRecords, listRecords, readConfig, type AirtableConfig } from '../src/lib/airtable/rest'
import { parseCsv } from '../src/workers/f11-import'
import { bureauDisplay, bureauKey, buildBureauNames } from '../src/workers/f11-bookings'
import type { BookingRow } from '../src/workers/f11-bookings'

const SEEDS = 'Louis-AddOn-Handoff-Package/louis-addon-handoff/seeds'
const BOOKINGS = 'fixtures/seed-2026-09/bookings-master.csv'

function truthy(v: string | undefined): boolean {
  return /^(true|yes|y|1|active)$/i.test((v ?? '').trim())
}

/** The three formats the resolver understands. Anything else is "Either". */
function format(raw: string | undefined): 'In-person' | 'Virtual' | 'Either' {
  const t = (raw ?? '').toLowerCase()
  if (t.includes('virtual') || t.includes('remote')) return 'Virtual'
  if (t.includes('person') || t.includes('live') || t.includes('stage')) return 'In-person'
  return 'Either'
}

interface Plan {
  testimonials: Record<string, unknown>[]
  pastClients: Record<string, unknown>[]
  bureaus: Record<string, unknown>[]
}

async function build(cfg: AirtableConfig): Promise<Plan> {
  // ── Testimonials ────────────────────────────────────────────────────────
  const haveQuotes = new Set(
    (await listRecords(cfg, 'testimonials'))
      .map((r) => String(r.fields[fieldRef('testimonials', 'quote')] ?? '').slice(0, 120))
      .filter(Boolean),
  )
  const testimonials = (parseCsv(readFileSync(`${SEEDS}/louis-testimonials-seed.csv`, 'utf8')) as Record<string, string>[])
    .filter((r) => (r.Quote ?? '').trim())
    .filter((r) => !haveQuotes.has(r.Quote!.slice(0, 120)))
    .map((r) => ({
      [fieldRef('testimonials', 'quote')]: r.Quote,
      [fieldRef('testimonials', 'shortQuote')]: r['Short Version'] || null,
      [fieldRef('testimonials', 'personName')]: r.Name || '',
      [fieldRef('testimonials', 'title')]: r.Title || null,
      [fieldRef('testimonials', 'company')]: r.Company || null,
      [fieldRef('testimonials', 'industry')]: r.Industry || null,
      [fieldRef('testimonials', 'format')]: format(r.Format),
      [fieldRef('testimonials', 'category')]: r.Category || null,
      [fieldRef('testimonials', 'sourceUrl')]: r['Source URL'] || null,
      // Ben retires a quote by unticking this, and the resolver honours it. Anything
      // the CSV does not explicitly mark inactive comes in active.
      [fieldRef('testimonials', 'active')]: r.Active ? truthy(r.Active) : true,
    }))

  // ── Past clients by industry ────────────────────────────────────────────
  const havePairs = new Set(
    (await listRecords(cfg, 'pastClients')).map(
      (r) =>
        `${r.fields[fieldRef('pastClients', 'industry')]}|${r.fields[fieldRef('pastClients', 'clientName')]}`,
    ),
  )
  const pastClients = (parseCsv(readFileSync(`${SEEDS}/louis-past-clients-by-industry.csv`, 'utf8')) as Record<string, string>[])
    .filter((r) => (r.client_organization ?? '').trim() && (r.industry ?? '').trim())
    .filter((r) => !havePairs.has(`${r.industry}|${r.client_organization}`))
    .map((r) => ({
      [fieldRef('pastClients', 'industry')]: r.industry,
      [fieldRef('pastClients', 'clientName')]: r.client_organization,
      [fieldRef('pastClients', 'bookings')]: Number(r.bookings) || 1,
      [fieldRef('pastClients', 'lastYear')]: Number(r.last_year) || null,
      [fieldRef('pastClients', 'anyVirtual')]: truthy(r.virtual_any),
    }))

  // ── Bureau companies ────────────────────────────────────────────────────
  // Derived from the history rather than typed: the same normaliser that named 700
  // contacts' agencies names the records they point at, so the two can never disagree.
  const haveKeys = new Set(
    (await listRecords(cfg, 'bureauCompanies'))
      .map((r) => String(r.fields[fieldRef('bureauCompanies', 'matchKey')] ?? ''))
      .filter(Boolean),
  )
  const rows = parseCsv(readFileSync(BOOKINGS, 'utf8')) as unknown as BookingRow[]
  const labels = rows.map((r) => r.agreement_type ?? '')
  const names = buildBureauNames(labels)
  const seen = new Map<string, string>()
  for (const raw of labels) {
    const key = bureauKey(raw)
    if (!key) continue
    seen.set(key, names.get(key) ?? bureauDisplay(raw) ?? key)
  }
  const bureaus = [...seen]
    .filter(([key]) => !haveKeys.has(key))
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([key, name]) => ({
      [fieldRef('bureauCompanies', 'name')]: name,
      [fieldRef('bureauCompanies', 'matchKey')]: key,
      [fieldRef('bureauCompanies', 'active')]: true,
    }))

  return { testimonials, pastClients, bureaus }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  const plan = await build(cfg)
  const requests = Math.ceil(plan.testimonials.length / 10) +
    Math.ceil(plan.pastClients.length / 10) +
    Math.ceil(plan.bureaus.length / 10)

  console.log(`Testimonials       ${String(plan.testimonials.length).padStart(4)} to add`)
  console.log(`Past clients       ${String(plan.pastClients.length).padStart(4)} to add`)
  console.log(`Bureau companies   ${String(plan.bureaus.length).padStart(4)} to add`)
  console.log(
    `\n${plan.testimonials.length + plan.pastClients.length + plan.bureaus.length} record(s) in ${requests} request(s), ten to a batch.`,
  )

  if (plan.bureaus.length > 0) {
    console.log('\nBureaus, as the history spells them:')
    for (const b of plan.bureaus.slice(0, 12)) {
      console.log(`  · ${b[fieldRef('bureauCompanies', 'name')]}`)
    }
    if (plan.bureaus.length > 12) console.log(`  … and ${plan.bureaus.length - 12} more`)
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to write.')
    return
  }

  if (plan.testimonials.length) await createRecords(cfg, 'testimonials', plan.testimonials)
  if (plan.pastClients.length) await createRecords(cfg, 'pastClients', plan.pastClients)
  if (plan.bureaus.length) await createRecords(cfg, 'bureauCompanies', plan.bureaus)

  console.log('\nSeeded. The social-proof resolver now has something to resolve against.')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
