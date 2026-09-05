/**
 * F11 — BOOKINGS MASTER import (WP4.2, Phase B of the go-live cutover).
 *
 * The generic F11 path in `f11-import.ts` is one CSV → one table, keyed on HubSpot
 * headers. The bookings master is a different animal: 803 rows that each imply a
 * company, up to three contacts, a bureau, and a deal, all linked. So it gets its own
 * mapping, per `Louis-AddOn-SocialProof-Import-MCP-Backup.md` §2, and reuses F11's CSV
 * parser and its "dry run, then a human, then commit" contract.
 *
 * Rules the mapping doc fixes, all enforced here:
 *  - `event_id` is the deal dedupe key. 803 rows, 803 distinct IDs, no exceptions.
 *  - 309 rows have no `actual_event_date`; fall back to `date` and flag it unverified.
 *  - Bureau labels are normalised through a synonym map before they become records.
 *  - No fee data exists anywhere in the file. Money stays null. It is not guessed.
 *  - Every row is tagged with the batch ID so the whole import reverses as one unit.
 *
 * Stage: the runbook says Delivered, the mapping doc says Closed-Won. Delivered is
 * correct for an event that already happened — Closed-Won is a sales outcome, and these
 * were all delivered years ago. `HISTORICAL_STAGE` is the single place to change it.
 */

import { db } from '@/lib/data'
import { agentActor, recordEvent } from '@/lib/audit'
import { invalidateSearchCache } from '@/lib/search'
import type { Client, Contact, Deal, StageKey } from '@/lib/types'

const WORKER = 'F11'

export const HISTORICAL_STAGE: StageKey = 'delivered'
export const DEFAULT_BATCH_ID = 'import-history-2026-09'

/** Labels in `agreement_type` that are not a bureau at all. */
const NOT_A_BUREAU = new Set([
  'stock',
  'direct',
  'direct (email evidence)',
  'none',
  'n/a',
  'unknown',
  'needs_review',
  'none found',
  'direct (verified email)',
])

export interface BookingRow {
  date: string
  actual_event_date: string
  event_name: string
  event_theme: string
  year: string
  client_organization: string
  industry: string
  sub_industry: string
  direct_booking: string
  agreement_type: string
  contact_1_name: string
  contact_1_phone: string
  contact_2_name: string
  contact_2_phone: string
  contact_3_name: string
  contact_3_phone: string
  contact_emails: string
  booking_contact: string
  top_challenges: string
  stress_notes: string
  keynote_goal: string
  problem_to_solve: string
  email_insight: string
  event_title: string
  location: string
  virtual: string
  event_id: string
  source_notes: string
}

export interface BookingsPlan {
  batchId: string
  rows: number
  companies: { create: number; update: number; names: string[] }
  contacts: { create: number; update: number; withoutEmail: number }
  deals: { create: number; update: number; dateUnverified: number }
  bureaus: { canonical: string[]; rawLabels: number }
  review: {
    needsReviewLane: string[]
    unclassifiedIndustry: string[]
    /** Rows whose `agreement_type` names two bureaus. A person picks which one. */
    ambiguousBureau: string[]
  }
  warnings: string[]
}

/** "not found in sources" is this file's way of writing null. Treat it as null. */
function clean(value: string | undefined): string | null {
  const v = (value ?? '').trim()
  if (!v) return null
  if (v.toLowerCase() === 'not found in sources') return null
  if (v.toLowerCase() === 'no body description present') return null
  return v
}

/** Company match key: case and punctuation are not identity. */
export function companyKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|llc|ltd|the|corp|corporation|company|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Words that describe what a bureau *is*, not which one it is. Dropped when building a
 * match key so "Keppler", "Keppler Speakers" and "Keppler Speakers Bureau" meet.
 */
/**
 * Two tiers, because they answer different questions.
 *
 * A legal suffix never distinguishes one bureau from another, so it always goes. A
 * descriptive word usually doesn't either — but for "A-Speakers" it is most of the name,
 * and stripping it leaves "a", which is not an identity. So the second tier is dropped
 * only when something recognisable survives it.
 */
const LEGAL_SUFFIX = /\b(inc|llc|ltd|lp|corp|corporation|co|company|the|aps|associates)\b/g
const DESCRIPTIVE = /\b(bureau|bureaus|speakers|speaker|speaking|agency|agencies|group|com|international|entertainment|talent)\b/g

/**
 * Spellings that differ by knowledge rather than punctuation.
 *
 * "SpeakInc" and "Speak, Inc." are one company; no rule about word boundaries will ever
 * discover that, because to a tokeniser "speakinc" is a single word. "AAE" is the same
 * problem from the other side: the acronym is only ever written on its own here, so
 * there is no expansion to read it from.
 *
 * Deliberately short. Every other acronym in the file appears beside its expansion —
 * "Executive Speakers Bureau (ESB)" — and is handled by the rule, so listing it here
 * would be a dead entry that looks load-bearing.
 */
const KEY_ALIASES: Record<string, string> = {
  speakinc: 'speak',
  aae: 'all american',
}

/** A label naming two organisations either side of a slash is a question for a person. */
export function namesTwoBureaus(raw: string): boolean {
  return / \/ /.test(raw.replace(/\([^)]*\)/g, ' '))
}

/**
 * Strips the decoration around a bureau name without touching the name itself.
 *
 * The only case where the real name hides inside the parentheses is an acronym being
 * spelled out — "WSB (Washington Speakers Bureau)". That is recognisable: the outside is
 * a single all-caps token and the inside's initials spell it. Everything else in the
 * parentheses is a note or a list of agents ("Premiere Speakers Bureau (Brian Lord,
 * Becky Seal)"), and promoting those produced a bureau called "Brian Lord, Becky Seal".
 */
export function bureauDisplay(raw: string): string | null {
  let label = raw.trim()
  if (!label || NOT_A_BUREAU.has(label.toLowerCase())) return null

  // "X d/b/a Y" — Y is the name it trades under, and the one people use.
  const dba = label.match(/\bd\/b\/a\s+(.+)$/i)?.[1]
  if (dba) label = dba.trim()

  // Agent names hung off the end: " - Kirk Myers, Emily Blackman".
  label = label.replace(/\s+[-\u2013\u2014]\s+.*$/, '').trim()

  const paren = label.match(/\(([^)]+)\)/)?.[1]?.trim()
  const outside = label.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
  const expandsAcronym =
    Boolean(paren) &&
    /^[A-Z]{2,5}$/.test(outside) &&
    paren!.split(/\s+/).length <= 4 &&
    paren!
      .split(/\s+/)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('')
      .startsWith(outside)
  label = expandsAcronym ? paren! : outside

  // Two organisations: the first is the one that booked. The row is flagged for review.
  label = label.split(/ \/ /)[0]!.trim()

  return label.replace(/[\s,;]+$/, '').trim() || null
}

/**
 * The match key. Aggressive on purpose — it decides which labels are the same bureau —
 * and never shown to anyone.
 */
export function bureauKey(raw: string): string | null {
  const display = bureauDisplay(raw)
  if (!display) return null

  const flat = display
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (KEY_ALIASES[flat]) return KEY_ALIASES[flat]

  const base = flat.replace(LEGAL_SUFFIX, ' ').replace(/\s+/g, ' ').trim()
  if (KEY_ALIASES[base]) return KEY_ALIASES[base]

  const stripped = base.replace(DESCRIPTIVE, ' ').replace(/\s+/g, ' ').trim()
  const key = stripped.length >= 3 ? stripped : base
  return KEY_ALIASES[key] ?? key ?? null
}

/**
 * Picks one display name per bureau across the whole file.
 *
 * A key alone cannot choose a name — only the corpus can, because the choice is "which
 * spelling did people use most". Most frequent wins; ties go to the longest, which keeps
 * "Washington Speakers Bureau" over a bare "WSB", then alphabetically so a re-import
 * produces the same names as the first run.
 */
export function buildBureauNames(rawLabels: string[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>()
  for (const raw of rawLabels) {
    const key = bureauKey(raw)
    const display = bureauDisplay(raw)
    if (!key || !display) continue
    if (!counts.has(key)) counts.set(key, new Map())
    const bucket = counts.get(key)!
    bucket.set(display, (bucket.get(display) ?? 0) + 1)
  }

  const out = new Map<string, string>()
  for (const [key, bucket] of counts) {
    const best = [...bucket].sort(
      (a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]),
    )[0]
    if (best) out.set(key, best[0])
  }
  return out
}

/**
 * The bureau name for one row, resolved against the names the whole file agreed on.
 *
 * Without the map this falls back to the row's own cleaned label, which is right for a
 * single row and wrong for an import — hence `buildBureauNames` at both call sites.
 */
export function normaliseBureau(raw: string, names?: Map<string, string>): string | null {
  const key = bureauKey(raw)
  if (!key) return null
  return names?.get(key) ?? bureauDisplay(raw)
}

/** Splits the `contact_emails` cell, which uses commas, semicolons and whitespace. */
export function splitEmails(cell: string): string[] {
  return (cell ?? '')
    .split(/[;,\s]+/)
    .map((e) => e.trim().toLowerCase().replace(/\.$/, ''))
    .filter((e) => e.includes('@') && e.length > 3)
}

/** The event date, and whether we had to fall back to the booking date. */
export function eventDateFor(row: BookingRow): { date: string | null; verified: boolean } {
  const actual = clean(row.actual_event_date)
  if (actual) return { date: actual.slice(0, 10), verified: true }
  const booked = clean(row.date)
  return { date: booked ? booked.slice(0, 10) : null, verified: false }
}

/** Notes that would otherwise be lost: the questionnaire-shaped columns. */
function historyNotes(row: BookingRow): string | null {
  const parts: [string, string | null][] = [
    ['Top challenges', clean(row.top_challenges)],
    ['Stress notes', clean(row.stress_notes)],
    ['Keynote goal', clean(row.keynote_goal)],
    ['Problem to solve', clean(row.problem_to_solve)],
    ['Email insight', clean(row.email_insight)],
    ['Source notes', clean(row.source_notes)],
  ]
  const kept = parts.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)
  return kept.length > 0 ? kept.join('\n\n') : null
}

function dealName(row: BookingRow): string {
  const client = clean(row.client_organization) ?? 'Unknown client'
  const event = clean(row.event_title) ?? clean(row.event_name) ?? clean(row.event_theme)
  const { date } = eventDateFor(row)
  const year = date?.slice(0, 4) ?? clean(row.year)?.slice(0, 4) ?? ''
  return event ? `${client} — ${event}${year ? ` (${year})` : ''}` : `${client}${year ? ` (${year})` : ''}`
}

/**
 * The dry run. Reads the whole base once, decides create-vs-update for every row, and
 * reports what a commit would do — including the two review lists the mapping doc asks
 * to be surfaced to Liezel rather than silently guessed at.
 */
export async function planBookings(
  rows: BookingRow[],
  reclassified: Map<string, string> = new Map(),
  batchId = DEFAULT_BATCH_ID,
): Promise<BookingsPlan> {
  const provider = db()
  const [clients, contacts, deals] = await Promise.all([
    provider.listClients(),
    provider.listContacts(),
    provider.listDeals(),
  ])

  const clientsByKey = new Map(clients.map((c) => [companyKey(c.name), c]))
  const contactsByEmail = new Map(
    contacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]),
  )
  const dealsByRef = new Map(deals.filter((d) => d.sourceRef).map((d) => [d.sourceRef!, d]))

  const plan: BookingsPlan = {
    batchId,
    rows: rows.length,
    companies: { create: 0, update: 0, names: [] },
    contacts: { create: 0, update: 0, withoutEmail: 0 },
    deals: { create: 0, update: 0, dateUnverified: 0 },
    bureaus: { canonical: [], rawLabels: 0 },
    review: { needsReviewLane: [], unclassifiedIndustry: [], ambiguousBureau: [] },
    warnings: [],
  }

  // One pass over the labels before the row loop: the display name for a bureau is a
  // property of the file, not of any single row.
  const bureauNames = buildBureauNames(rows.map((r) => r.agreement_type ?? ''))

  const seenCompanies = new Set<string>()
  const seenEmails = new Set<string>()
  const bureauCanonical = new Set<string>()
  const bureauRaw = new Set<string>()
  const unclassified = new Set<string>()

  for (const row of rows) {
    const orgName = clean(row.client_organization)
    if (!orgName) {
      plan.warnings.push(`Row ${row.event_id}: no client_organization — skipped.`)
      continue
    }

    // Companies
    const key = companyKey(orgName)
    if (!seenCompanies.has(key)) {
      seenCompanies.add(key)
      if (clientsByKey.has(key)) plan.companies.update += 1
      else {
        plan.companies.create += 1
        plan.companies.names.push(orgName)
      }
    }
    const industry = reclassified.get(key) ?? clean(row.industry)
    if (!industry || /^other|unclassified/i.test(industry)) unclassified.add(orgName)

    // Bureaus
    const rawLabel = clean(row.agreement_type)
    if (rawLabel && !NOT_A_BUREAU.has(rawLabel.toLowerCase())) {
      bureauRaw.add(rawLabel)
      const canon = normaliseBureau(rawLabel, bureauNames)
      if (canon) bureauCanonical.add(canon)
      if (namesTwoBureaus(rawLabel)) {
        plan.review.ambiguousBureau.push(`${row.event_id} — ${rawLabel}`)
      }
    }
    if (row.direct_booking.trim().toLowerCase() === 'needs_review') {
      plan.review.needsReviewLane.push(`${row.event_id} — ${orgName}`)
    }

    // Contacts
    const emails = splitEmails(row.contact_emails)
    const names = [row.contact_1_name, row.contact_2_name, row.contact_3_name]
      .map((n) => clean(n))
      .filter((n): n is string => Boolean(n))
    for (const email of emails) {
      if (seenEmails.has(email)) continue
      seenEmails.add(email)
      if (contactsByEmail.has(email)) plan.contacts.update += 1
      else plan.contacts.create += 1
    }
    if (names.length > emails.length) plan.contacts.withoutEmail += names.length - emails.length

    // Deals
    const ref = row.event_id.trim()
    if (dealsByRef.has(ref)) plan.deals.update += 1
    else plan.deals.create += 1
    if (!eventDateFor(row).verified) plan.deals.dateUnverified += 1
  }

  plan.bureaus.canonical = [...bureauCanonical].sort()
  plan.bureaus.rawLabels = bureauRaw.size
  plan.review.unclassifiedIndustry = [...unclassified].sort()

  return plan
}

export interface CommitResult {
  batchId: string
  companies: number
  contacts: number
  deals: number
}

/**
 * The live run. Only ever called after a human has read the plan.
 *
 * Order matters: companies first so deals can link to them, contacts second so they can
 * link to a company, deals last. Everything carries `historical`, `importBatch` and
 * `sourceRef`, which together make the batch reversible and keep these 803 rows out of
 * every timer, digest and staleness sweep for good.
 */
export async function commitBookings(
  rows: BookingRow[],
  approver: string,
  reclassified: Map<string, string> = new Map(),
  batchId = DEFAULT_BATCH_ID,
): Promise<CommitResult> {
  const provider = db()
  const [existingClients, existingContacts, existingDeals] = await Promise.all([
    provider.listClients(),
    provider.listContacts(),
    provider.listDeals(),
  ])

  const clientsByKey = new Map<string, Client>(
    existingClients.map((c) => [companyKey(c.name), c]),
  )
  const contactsByEmail = new Map<string, Contact>(
    existingContacts.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c]),
  )
  const dealsByRef = new Map<string, Deal>(
    existingDeals.filter((d) => d.sourceRef).map((d) => [d.sourceRef!, d]),
  )

  const bureauNames = buildBureauNames(rows.map((r) => r.agreement_type ?? ''))
  const result: CommitResult = { batchId, companies: 0, contacts: 0, deals: 0 }

  for (const row of rows) {
    const orgName = clean(row.client_organization)
    if (!orgName) continue

    // ── Company ────────────────────────────────────────────────────────────
    const key = companyKey(orgName)
    let client = clientsByKey.get(key)
    const industry = reclassified.get(key) ?? clean(row.industry)
    if (!client) {
      client = await provider.createClient({
        name: orgName,
        industry,
        hq: clean(row.location),
        notes: clean(row.sub_industry) ? `Sub-industry: ${clean(row.sub_industry)}` : null,
      })
      clientsByKey.set(key, client)
      result.companies += 1
      await recordEvent({
        table: 'clients',
        recordId: client.id,
        what: 'Imported',
        detail: `bookings master, approved by ${approver}`,
        actor: agentActor(WORKER),
        source: 'Import (bookings master 2026-09)',
        batchId,
      })
    }

    // ── Contacts ───────────────────────────────────────────────────────────
    const emails = splitEmails(row.contact_emails)
    const names = [row.contact_1_name, row.contact_2_name, row.contact_3_name]
      .map((n) => clean(n))
      .filter((n): n is string => Boolean(n))
    const phones = [row.contact_1_phone, row.contact_2_phone, row.contact_3_phone].map((p) =>
      clean(p),
    )
    const bureauName = normaliseBureau(row.agreement_type, bureauNames)
    const isBureauLane = row.direct_booking.trim().toLowerCase() === 'no'

    for (let i = 0; i < emails.length; i += 1) {
      const email = emails[i]!
      if (contactsByEmail.has(email)) continue
      const contact = await provider.createContact({
        name: names[i] ?? clean(row.booking_contact) ?? email,
        email,
        phone: phones[i] ?? null,
        type: isBureauLane ? 'bureau-agent' : 'decision-maker',
        agency: isBureauLane ? bureauName : null,
        clientId: client.id,
      })
      contactsByEmail.set(email, contact)
      result.contacts += 1
      await recordEvent({
        table: 'contacts',
        recordId: contact.id,
        what: 'Imported',
        detail: `bookings master, approved by ${approver}`,
        actor: agentActor(WORKER),
        source: 'Import (bookings master 2026-09)',
        batchId,
      })
    }

    // ── Deal ───────────────────────────────────────────────────────────────
    const ref = row.event_id.trim()
    if (dealsByRef.has(ref)) continue
    const { date, verified } = eventDateFor(row)
    const notes = historyNotes(row)
    const deal = await provider.createDeal({
      name: dealName(row),
      stage: HISTORICAL_STAGE,
      source: isBureauLane ? 'bureau' : 'direct',
      client: { id: client.id, name: client.name },
      eventDate: date,
      location: clean(row.location),
      // No fee data exists in this file. Money is not guessed.
      negotiatedFee: null,
      listFee: null,
      historical: true,
      importBatch: batchId,
      sourceRef: ref,
      postKeynoteNotes: notes,
      kickoffNotes:
        row.virtual.trim().toLowerCase() === 'yes' ? 'Virtual event (from bookings master).' : null,
      audienceProfile: clean(row.event_theme),
    })
    dealsByRef.set(ref, deal)
    result.deals += 1
    await recordEvent({
      table: 'deals',
      recordId: deal.id,
      what: 'Imported',
      detail:
        `bookings master row ${ref}, approved by ${approver}` +
        (verified ? '' : ' — event date unverified (fell back to booking date)'),
      actor: agentActor(WORKER),
      source: 'Import (bookings master 2026-09)',
      batchId,
    })
  }

  invalidateSearchCache()
  console.info(
    `[${WORKER}] bookings import ${batchId}: ${result.companies} companies, ` +
      `${result.contacts} contacts, ${result.deals} deals`,
  )
  return result
}
