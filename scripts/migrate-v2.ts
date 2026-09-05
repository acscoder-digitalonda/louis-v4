#!/usr/bin/env tsx
/**
 * v2 → v3 migration.
 *
 * Reads the two v2 bases and writes the v3 shape into a freshly bootstrapped base.
 * Nothing is written without `--apply`; the default is a dry run that prints exactly
 * what would move and — more usefully — what it cannot map.
 *
 *   SOURCE_LOUIS_BASE_ID=appNAaHVJMeTMbzdh \
 *   SOURCE_CASH_BASE_ID=appOXgMU40vanIiDG \
 *   AIRTABLE_BASE_ID=<the new v3 base> \
 *   npm run migrate:v2            # dry run
 *   npm run migrate:v2 -- --apply
 *
 * The v2 bases are only ever read. If this script goes wrong, the worst case is a
 * half-filled new base you delete and re-bootstrap.
 *
 * Three shape changes matter, and each is a deliberate decision recorded here:
 *
 *  1. `Events.Status` has four values; v3 has seven stages. v2 has no Sales stage at all
 *     — that pipeline is the thing v3 adds upstream — so nothing lands in Sales and the
 *     report says so rather than inventing it.
 *  2. Journal lived as nine repeated fields on Events. v3 makes it a child table, so one
 *     Event can produce up to two Journal Orders (a promo and a bulk order).
 *  3. Money lived in a second base with its own copy of Deals. We join on
 *     `Cash.Deals.Source Deal ID` → the v2 Events record id, and re-point Payments and
 *     Schedule Legs at the new v3 Deal.
 */

import {
  createRecords,
  listRecords,
  type AirtableConfig,
  type AirtableRecord,
} from '../src/lib/airtable/rest'
import { TABLES } from '../src/lib/airtable/schema'
import type { StageKey } from '../src/lib/types'
import { stageCodec } from '../src/lib/data/airtable-codec'

const APPLY = process.argv.includes('--apply')

const KEY = process.env.AIRTABLE_API_KEY
const LOUIS = process.env.SOURCE_LOUIS_BASE_ID ?? 'appNAaHVJMeTMbzdh'
const CASH = process.env.SOURCE_CASH_BASE_ID ?? 'appOXgMU40vanIiDG'
const TARGET = process.env.AIRTABLE_BASE_ID

/** v2 tables are read by name through a raw fetch — they are not in the v3 schema. */
async function readV2(baseId: string, table: string): Promise<AirtableRecord[]> {
  const out: AirtableRecord[] = []
  let offset: string | undefined
  do {
    const params = new URLSearchParams({ pageSize: '100' })
    if (offset) params.set('offset', offset)
    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}?${params}`,
      { headers: { Authorization: `Bearer ${KEY}` }, cache: 'no-store' },
    )
    if (!res.ok) throw new Error(`read ${table}: ${res.status} ${await res.text()}`)
    const json = (await res.json()) as { records: AirtableRecord[]; offset?: string }
    out.push(...json.records)
    offset = json.offset
  } while (offset)
  return out
}

const f = (r: AirtableRecord, name: string): unknown => r.fields[name]
const s = (r: AirtableRecord, name: string): string | null => {
  const v = f(r, name)
  return typeof v === 'string' && v !== '' ? v : null
}
const n = (r: AirtableRecord, name: string): number | null => {
  const v = f(r, name)
  return typeof v === 'number' ? v : null
}
const b = (r: AirtableRecord, name: string): boolean => f(r, name) === true
const link = (r: AirtableRecord, name: string): string | null => {
  const v = f(r, name)
  return Array.isArray(v) && typeof v[0] === 'string' ? v[0] : null
}

/**
 * v2 Status → v3 Stage. "Confirmed" splits on contract: a signed contract is the gate
 * v3 puts in front of Pre-Event, so an unsigned Confirmed deal stays at Closed-Won.
 */
function mapStage(record: AirtableRecord): { stage: StageKey; note: string | null } {
  const status = s(record, 'Status')
  const contract = s(record, 'Contract Status')
  switch (status) {
    case 'Inquiry':
      return { stage: 'inquiry', note: null }
    case 'Confirmed':
      return contract === 'Signed'
        ? { stage: 'pre-event', note: null }
        : { stage: 'closed-won', note: `contract "${contract ?? 'none'}" — held at Closed-Won` }
    case 'Delivered':
      return { stage: 'delivered', note: null }
    case 'Past':
      return { stage: 'debriefed', note: null }
    default:
      return { stage: 'inquiry', note: `unknown Status "${status ?? '∅'}" — defaulted to Inquiry` }
  }
}

const CONTRACT: Record<string, string> = { Pending: 'None', Sent: 'Out', Signed: 'Signed' }

/** The questionnaire answers were five separate Q— fields; v3 has one audience profile. */
function audienceProfile(record: AirtableRecord): string | null {
  const parts = [
    ['Audience', s(record, 'Q — Audience Mood')],
    ['Challenges', s(record, 'Q — Challenges')],
    ['Theme', s(record, 'Q — Theme')],
    ['Key messaging', s(record, 'Q — Key Messaging')],
    ['Focus topics', s(record, 'Q — Niche / Focus Topics')],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
  return parts.length ? parts.join('\n\n') : null
}

interface Plan {
  clients: Record<string, unknown>[]
  contacts: Record<string, unknown>[]
  deals: Record<string, unknown>[]
  journal: Record<string, unknown>[]
  payments: Record<string, unknown>[]
  legs: Record<string, unknown>[]
  notes: string[]
}

async function main() {
  if (!KEY) throw new Error('AIRTABLE_API_KEY is not set')
  if (!TARGET && APPLY) throw new Error('AIRTABLE_BASE_ID (the new v3 base) is not set')

  console.info(`Reading v2 — Louis ${LOUIS}, Cash ${CASH}`)
  const [events, v2clients, v2contacts, cashDeals, cashPayments, cashLegs] = await Promise.all([
    readV2(LOUIS, 'Events'),
    readV2(LOUIS, 'Clients'),
    readV2(LOUIS, 'Contacts'),
    readV2(CASH, 'Deals'),
    readV2(CASH, 'Payments'),
    readV2(CASH, 'Schedule Legs'),
  ])

  const plan: Plan = { clients: [], contacts: [], deals: [], journal: [], payments: [], legs: [], notes: [] }

  // ── Clients ────────────────────────────────────────────────────────────────
  // Company Domain is new in v3 and is the dedupe key for every export. v2 never
  // captured it, so we derive it from a linked contact's email where we can and let
  // the F13 sweep flag the rest rather than guessing.
  const contactEmailByClient = new Map<string, string>()
  for (const c of v2contacts) {
    const email = s(c, 'Email')
    const eventId = link(c, 'Event')
    if (!email || !eventId) continue
    const event = events.find((e) => e.id === eventId)
    const clientId = event ? link(event, 'Client') : null
    if (clientId && !contactEmailByClient.has(clientId)) contactEmailByClient.set(clientId, email)
  }

  const freeDomains = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com'])
  for (const c of v2clients) {
    const email = contactEmailByClient.get(c.id)
    const domain = email?.split('@')[1]?.toLowerCase() ?? null
    plan.clients.push({
      __src: c.id,
      'Company Name': s(c, 'Company Name') ?? 'Untitled',
      'Company Domain': domain && !freeDomains.has(domain) ? domain : null,
      Industry: s(c, 'Industry'),
      Website: s(c, 'Website'),
      'Relationship Notes': [s(c, 'Relationship'), s(c, 'Notes')].filter(Boolean).join('\n\n') || null,
    })
  }
  const noDomain = plan.clients.filter((c) => !c['Company Domain']).length
  if (noDomain) plan.notes.push(`${noDomain} client(s) end up without a Company Domain — F13 will flag them.`)

  // ── Deals (from Events) + Journal Orders ───────────────────────────────────
  for (const e of events) {
    const { stage, note } = mapStage(e)
    if (note) plan.notes.push(`${s(e, 'Event Name') ?? e.id}: ${note}`)

    plan.deals.push({
      __src: e.id,
      __client: link(e, 'Client'),
      'Deal Name': s(e, 'Event Name') ?? 'Untitled deal',
      Stage: stageCodec.toAirtable(stage),
      // v2's "Deal Type" is the direct/bureau axis; v3 keeps that as Source and uses
      // Deal Type for the product.
      Source: s(e, 'Deal Type') ?? 'Direct',
      'Deal Type': 'Keynote',
      Location: s(e, 'Location'),
      'Event Date': s(e, 'Event Date'),
      'AV Check Time': s(e, 'AV Check Time'),
      'Stage Time': s(e, 'Stage Time'),
      'Event URL': s(e, 'Event URL'),
      'Negotiated Fee': n(e, 'Fee'),
      'Questionnaire Received': b(e, 'Questionnaire Received'),
      'Audience Profile': audienceProfile(e),
      'Desired Outcomes': s(e, 'Q — Desired Outcomes'),
      'Kickoff Notes': s(e, 'Kickoff Call Notes'),
      'Post-Keynote Notes': [s(e, 'Post-Keynote Notes'), s(e, 'Post-Keynote Next Steps')]
        .filter(Boolean)
        .join('\n\n') || null,
      Hotel: s(e, 'Hotel Confirmation'),
      'Travel Notes': s(e, 'Travel Notes'),
      'Drive Folder': s(e, 'Deck Folder URL'),
    })

    // Nine repeated fields become up to two child rows.
    if (b(e, 'Sample Journal Sent')) {
      plan.journal.push({
        __deal: e.id,
        Reference: `${s(e, 'Event Name') ?? 'Deal'} — promo copies`,
        Status: 'Promo Sent',
        'Ship To': s(e, 'Sample Journal Shipping Address'),
      })
    }
    if (b(e, 'Journals Ordered')) {
      plan.journal.push({
        __deal: e.id,
        Reference: `${s(e, 'Event Name') ?? 'Deal'} — bulk order`,
        Status: 'Bulk Ordered',
        Quantity: n(e, 'Journals — Quantity Ordered'),
        'Ship To': s(e, 'Journal Shipping Address & Contact'),
        'Ship By': s(e, 'Journal Receiving Window — Start'),
        'Warehouse Notes': [
          s(e, 'Journal Order Notes'),
          s(e, 'Journal Receiving Contact'),
          b(e, 'Journals Paid') ? 'Paid (v2 flag).' : null,
          s(e, 'Journal Payment Info'),
        ]
          .filter(Boolean)
          .join('\n') || null,
      })
    }
  }

  // ── Contacts ───────────────────────────────────────────────────────────────
  // v2 linked a contact to one Event; v3 links a person to many deals, so we merge
  // duplicates by email — the whole point of "one person, one record, forever".
  const byEmail = new Map<string, { rec: Record<string, unknown>; deals: string[] }>()
  for (const c of v2contacts) {
    const email = s(c, 'Email')
    const key = (email ?? `${c.id}`).toLowerCase()
    const eventId = link(c, 'Event')
    const role = (s(c, 'Role') ?? '').toLowerCase()
    const type = role.includes('bureau')
      ? 'Bureau Agent'
      : role.includes('planner')
        ? 'Meeting Planner'
        : role.includes('onsite')
          ? 'Onsite'
          : 'Decision Maker'

    const existing = byEmail.get(key)
    if (existing) {
      if (eventId) existing.deals.push(eventId)
      continue
    }
    byEmail.set(key, {
      rec: {
        Name: s(c, 'Contact Name') ?? email ?? 'Unknown',
        Email: email,
        Phone: s(c, 'Phone'),
        Type: type,
        'History Notes': s(c, 'Role') ? `v2 role: ${s(c, 'Role')}` : null,
      },
      deals: eventId ? [eventId] : [],
    })
  }
  const merged = v2contacts.length - byEmail.size
  if (merged > 0) plan.notes.push(`${merged} duplicate contact record(s) merged by email.`)
  for (const [, v] of byEmail) plan.contacts.push({ ...v.rec, __deals: v.deals })

  // ── Money ──────────────────────────────────────────────────────────────────
  // Join Cash → Louis on Source Deal ID, so payments land on the right v3 deal.
  const cashDealToEvent = new Map<string, string>()
  for (const d of cashDeals) {
    const src = s(d, 'Source Deal ID')
    if (src) cashDealToEvent.set(d.id, src)
  }

  let orphanPayments = 0
  for (const p of cashPayments) {
    const eventId = cashDealToEvent.get(link(p, 'Deal') ?? '')
    if (!eventId) orphanPayments += 1
    plan.payments.push({
      __deal: eventId,
      'Invoice Number': s(p, 'Reference'),
      Amount: n(p, 'Amount') ?? 0,
      // Everything in the v2 ledger is money that actually arrived.
      Status: 'Confirmed',
      Method: s(p, 'Method'),
      Received: s(p, 'Received Date'),
      'Confirmed By': s(p, 'Confirmed By'),
      Note: 'Migrated from the Cash base.',
    })
  }
  if (orphanPayments) plan.notes.push(`${orphanPayments} payment(s) have no matching deal — they migrate unlinked.`)

  for (const l of cashLegs) {
    const eventId = cashDealToEvent.get(link(l, 'Deal') ?? '')
    plan.legs.push({
      __deal: eventId,
      Label: s(l, 'Label') ?? 'Leg',
      Amount: n(l, 'Amount') ?? 0,
      Due: s(l, 'Expected Date'),
      Paid: false,
    })
  }

  // ── report ─────────────────────────────────────────────────────────────────
  const stageCounts = new Map<string, number>()
  for (const d of plan.deals) {
    const st = String(d.Stage)
    stageCounts.set(st, (stageCounts.get(st) ?? 0) + 1)
  }

  console.info('\n── would migrate ────────────────────────────')
  console.info(`  Clients         ${plan.clients.length}`)
  console.info(`  Contacts        ${plan.contacts.length}  (from ${v2contacts.length} v2 rows)`)
  console.info(`  Deals           ${plan.deals.length}`)
  for (const [st, count] of [...stageCounts].sort()) console.info(`      ${st.padEnd(12)} ${count}`)
  console.info(`  Journal Orders  ${plan.journal.length}  (from repeated fields on Events)`)
  console.info(`  Payments        ${plan.payments.length}`)
  console.info(`  Schedule Legs   ${plan.legs.length}`)

  if (plan.notes.length) {
    console.info('\n── things you should look at ────────────────')
    for (const note of plan.notes) console.info(`  · ${note}`)
  }

  console.info('\n── not migrated, on purpose ─────────────────')
  console.info('  · Auto Updates      — v3 replaces it with Field Proposals + Audit Log')
  console.info('  · Fit — * tables    — a separate v2 feature, not part of the v3 spec')
  console.info('  · Logistics Items   — v3 models these as Tasks, created by the stage packet')
  console.info('  · QB Staging        — the matcher rebuilds it; stale rows are noise')
  console.info('  · Payment/Contract Status on Deals — rollups in v3, derived from Payments')

  if (!APPLY) {
    console.info('\nDry run. Nothing was written. Re-run with --apply once the target base is bootstrapped.')
    return
  }

  await write(plan)
}

async function write(plan: Plan) {
  const cfg: AirtableConfig = { apiKey: KEY!, baseId: TARGET! }
  const strip = (r: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(r).filter(([k, v]) => !k.startsWith('__') && v !== null))

  console.info('\nWriting to', TARGET)

  const clientIds = new Map<string, string>()
  const created = await createRecords(cfg, 'clients', plan.clients.map(strip))
  plan.clients.forEach((c, i) => {
    const id = created[i]?.id
    if (id) clientIds.set(String(c.__src), id)
  })
  console.info(`  Clients        ${created.length}`)

  const dealIds = new Map<string, string>()
  const dealRows = plan.deals.map((d) => {
    const row = strip(d)
    const clientId = d.__client ? clientIds.get(String(d.__client)) : null
    if (clientId) row.Client = [clientId]
    return row
  })
  const createdDeals = await createRecords(cfg, 'deals', dealRows)
  plan.deals.forEach((d, i) => {
    const id = createdDeals[i]?.id
    if (id) dealIds.set(String(d.__src), id)
  })
  console.info(`  Deals          ${createdDeals.length}`)

  const contactRows = plan.contacts.map((c) => {
    const row = strip(c)
    const deals = (c.__deals as string[]).map((e) => dealIds.get(e)).filter(Boolean)
    if (deals.length) row.Deals = deals
    return row
  })
  console.info(`  Contacts       ${(await createRecords(cfg, 'contacts', contactRows)).length}`)

  const relink = (rows: Record<string, unknown>[]) =>
    rows.map((r) => {
      const row = strip(r)
      const id = r.__deal ? dealIds.get(String(r.__deal)) : null
      if (id) row.Deal = [id]
      return row
    })

  console.info(`  Journal Orders ${(await createRecords(cfg, 'journalOrders', relink(plan.journal))).length}`)
  console.info(`  Payments       ${(await createRecords(cfg, 'payments', relink(plan.payments))).length}`)
  console.info(`  Schedule Legs  ${(await createRecords(cfg, 'scheduleLegs', relink(plan.legs))).length}`)

  console.info('\nDone. Next: npm run fields:refresh, then remove DATA_BACKEND=mock.')
  console.info(`Tables in the v3 schema: ${Object.keys(TABLES).length}`)
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
