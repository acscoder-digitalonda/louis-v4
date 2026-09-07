/**
 * C1 — CALENDAR SEED. Phase C of the go-live cutover.
 *
 * The single, deliberate exception to "the calendar is a render, not a source". It runs
 * once, before the one-way mirror is switched on, and everything it produces is a
 * proposal for a human.
 *
 * ── What the calendar actually looks like ──────────────────────────────────
 *
 * The runbook was written expecting colour coding, "HOLD" wording and "CONFIRMED".
 * Reading Ben's calendar for 1 Jun 2026 → +18 months (917 events) says otherwise:
 *
 *  - "HOLD" appears in 1 event out of 917. "CONFIRMED" in 2. Neither is a usable signal.
 *  - `colorId` is not exposed by the calendar connector at all, so colour cannot be read.
 *  - Bookings are **all-day** events titled `CLIENT-LOCATION-CONTACT`, in caps, with an
 *    optional `(2)` / `(3)` / `(4)` suffix. 132 of 917 events match; no timed event does.
 *  - `*STARRED*` fragments are Ben's notes to himself (*BRING PASSPORT*, *EVENING*) and
 *    are stripped from the client name but kept as notes.
 *
 * ── What (n) means ─────────────────────────────────────────────────────────
 *
 * Not "the nth hold on this date", which is what the runbook assumed. It is the
 * **preference rank among several candidate dates for one deal**:
 *
 *   TBD-CHARLOTTE, NC-MARILY      2026-10-08
 *   TBD-CHARLOTTE, NC-MARILY (2)  2026-10-07
 *   TBD-CHARLOTTE, NC-MARILY (3)  2026-10-06
 *
 * That is one deal holding three dates, first choice 10-08 — not three deals. Grouping
 * by (client, contact, location) instead of by date turns 132 events into 115 deals and
 * is the difference between Liezel reviewing a correct list and a badly duplicated one.
 *
 * A **date conflict** is therefore two *different* deals holding the *same* date, which
 * is a much rarer and more meaningful signal than "any date with two events on it".
 */

import type { Client, DealProposal, SeedSource, StageKey } from '@/lib/types'
import { companyKey } from './f11-bookings'

export const SEED_SOURCE: SeedSource = 'calendar'
export const DEFAULT_BATCH_ID = 'seed-calendar-2026-09'

/** Titles that are Ben's life, not Ben's business. */
const PERSONAL = new RegExp(
  [
    'b-?day',
    'birthday',
    'anniversary',
    '\\bPTO\\b',
    'holiday',
    'offline',
    'dentist',
    'doctor',
    'school',
    'vacation',
    'flight',
    'hotel',
    'check-?in',
    'tax',
    'deadline',
    'storage',
    'taskrabbit',
    'to ?do',
    'promo vid',
  ].join('|'),
  'i',
)

export interface CalendarEvent {
  id: string
  summary?: string
  description?: string
  location?: string
  created?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
}

export interface HeldDate {
  date: string
  /** 1 = first choice. Read from the "(n)" suffix; absent means 1. */
  order: number
  eventId: string
  title: string
  createdAt: string | null
}

export interface CalendarDeal {
  client: string
  location: string | null
  contact: string | null
  heldDates: HeldDate[]
  primaryDate: string
  holdOrder: number
  virtual: boolean
  historical: boolean
  clientUnknown: boolean
  notes: string[]
  eventIds: string[]
  confidence: number
}

/** The start date, whether the event is all-day or timed. */
export function startDate(event: CalendarEvent): string | null {
  const raw = event.start?.date ?? event.start?.dateTime
  return raw ? raw.slice(0, 10) : null
}

/**
 * Is this title shaped like a booking? Caps, hyphen-separated, not personal.
 * Deliberately conservative: a missed booking surfaces in Fable's weekly review as
 * "a hold with no thread", while a false one wastes Liezel's time in the session.
 */
export function isBookingTitle(title: string | undefined): boolean {
  if (!title) return false
  if (PERSONAL.test(title)) return false
  const core = title.replace(/\s*\(\d\)\s*$/, '').trim()
  if (!core.includes('-')) return false
  const letters = core.replace(/[^a-zA-Z]/g, '')
  if (letters.length === 0) return false
  const upper = letters.replace(/[^A-Z]/g, '').length / letters.length
  return upper > 0.75
}

export interface ParsedTitle {
  order: number
  client: string
  location: string | null
  contact: string | null
  notes: string[]
}

/** `*BRING ETHERNET* LIVENATION - AUSTIN - DEIRDRE (4)` → the pieces. */
export function parseTitle(title: string): ParsedTitle {
  const orderMatch = title.match(/\((\d)\)\s*$/)
  const order = orderMatch ? Number(orderMatch[1]) : 1

  let core = title.replace(/\s*\(\d\)\s*$/, '')

  // Ben's notes to himself are asterisked, and he does not always close the pair:
  // "*BRING ETHERNET* YPO MIAMI" closes, "JANNEY *EVENING- GLASTONBURY" does not.
  // An unclosed marker runs to the next hyphen, which is where the field separator
  // resumes. Missing this leaks "*EVENING" into the client name and breaks the match
  // against the imported companies.
  // One rule, not two: a marker runs from "*" to the next "*" or the next "-",
  // whichever comes first. Pairing greedily instead would let
  // "*STAY IN MIAMI-ARUBA-BILL *MEALS" swallow the location and contact between two
  // unrelated markers.
  const notes: string[] = []
  core = core.replace(/\*([^*\-]*)\*?/g, (_, note: string) => {
    const trimmed = note.trim()
    if (trimmed) notes.push(trimmed)
    return ' '
  })

  const parts = core
    .split('-')
    .map((p) => p.trim())
    .filter(Boolean)

  if (parts.length >= 3) {
    return { order, client: parts[0]!, location: parts[1]!, contact: parts[parts.length - 1]!, notes }
  }
  if (parts.length === 2) {
    // Two parts is ambiguous: "MORELAND - AUSTIN" could be client-location or
    // client-contact. Treated as location, because that is the commoner shape, and
    // flagged by a lower confidence so C5 looks at it.
    return { order, client: parts[0]!, location: parts[1]!, contact: null, notes }
  }
  return { order, client: core.trim(), location: null, contact: null, notes }
}

function groupKey(p: ParsedTitle): string {
  return [p.client, p.contact ?? '', p.location ?? ''].map((s) => s.toUpperCase()).join('|')
}

/**
 * Confidence, and why it matters: C5 bulk-accepts the high-confidence set and reads the
 * rest one by one. So this has to be honest rather than flattering.
 */
function confidenceFor(deal: Omit<CalendarDeal, 'confidence'>): number {
  let score = 0.9
  if (deal.clientUnknown) score -= 0.4 // "TBD" — nobody knows who this is yet
  if (!deal.contact) score -= 0.15 // two-part title, contact unresolved
  if (!deal.location) score -= 0.1
  if (deal.heldDates.length > 1) score -= 0.05 // which date is real is a human call
  return Math.max(0.1, Math.round(score * 100) / 100)
}

/**
 * Turns raw calendar events into one proposal per deal.
 *
 * @param today Anything whose last held date is before this is already delivered, and
 *              becomes historical rather than entering the live pipeline.
 */
export function extractDeals(events: CalendarEvent[], today: string): CalendarDeal[] {
  const groups = new Map<string, { parsed: ParsedTitle; held: HeldDate[]; notes: Set<string> }>()

  for (const event of events) {
    const title = event.summary
    if (!isBookingTitle(title)) continue
    const date = startDate(event)
    if (!date) continue

    const parsed = parseTitle(title!)
    const key = groupKey(parsed)
    const entry = groups.get(key) ?? { parsed, held: [], notes: new Set<string>() }
    entry.held.push({
      date,
      order: parsed.order,
      eventId: event.id,
      title: title!,
      createdAt: event.created ?? null,
    })
    parsed.notes.forEach((n) => entry.notes.add(n))
    groups.set(key, entry)
  }

  const out: CalendarDeal[] = []
  for (const { parsed, held, notes } of groups.values()) {
    // First choice = lowest (n); ties broken by the earliest date, then by which hold
    // Ben created first, which is the runbook's stated fallback.
    const sorted = [...held].sort(
      (a, b) =>
        a.order - b.order ||
        a.date.localeCompare(b.date) ||
        (a.createdAt ?? '').localeCompare(b.createdAt ?? ''),
    )
    const primary = sorted[0]!
    const lastDate = held.reduce((max, h) => (h.date > max ? h.date : max), held[0]!.date)
    const base = {
      client: parsed.client,
      location: parsed.location,
      contact: parsed.contact,
      heldDates: sorted,
      primaryDate: primary.date,
      holdOrder: primary.order,
      virtual: sorted.some((h) => /virtual|zoom|webinar/i.test(h.title)),
      historical: lastDate < today,
      clientUnknown: /^TBD\b/i.test(parsed.client),
      notes: [...notes],
      eventIds: sorted.map((h) => h.eventId),
    }
    out.push({ ...base, confidence: confidenceFor(base) })
  }

  return out.sort((a, b) => a.primaryDate.localeCompare(b.primaryDate))
}

export interface DateConflict {
  date: string
  deals: CalendarDeal[]
}

/**
 * Two *different* deals holding the same date. One deal holding five dates is not a
 * conflict — it is how Ben shops a date with a client.
 */
export function findDateConflicts(deals: CalendarDeal[], today: string): DateConflict[] {
  const byDate = new Map<string, CalendarDeal[]>()
  for (const deal of deals) {
    for (const held of deal.heldDates) {
      if (held.date < today) continue
      const list = byDate.get(held.date) ?? []
      if (!list.includes(deal)) list.push(deal)
      byDate.set(held.date, list)
    }
  }
  return [...byDate.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([date, list]) => ({ date, deals: list }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Stage, as far as a calendar can tell — which is not very far.
 *
 * Without the colour convention or "HOLD"/"CONFIRMED" wording, a lone hold and a signed
 * booking look identical. So everything upcoming lands as a hold for a human to promote,
 * and nothing is auto-promoted to Closed-Won on a guess. C2's contract and invoice
 * threads are what will actually distinguish the two.
 */
export function stageFor(deal: CalendarDeal): StageKey {
  if (deal.historical) return 'delivered'
  // Qualified is exactly "a date is held and we are still selling", which is the most a
  // calendar entry can honestly claim. Firm Offer would assert a priced offer is out,
  // and no calendar event carries that.
  return 'qualified'
}


/**
 * Matching a calendar client name against the imported companies.
 *
 * The calendar writes shorthand — "JANNEY", "TVA", "WAKEFERN" — where the bookings
 * master holds the legal name: "Janney Montgomery Scott", "Tennessee Valley Authority
 * (TVA)", "Wakefern Food Corp". Exact-key matching alone finds 16 of 106; the rest are
 * real repeat clients that would be proposed as brand-new companies and quietly split
 * seven years of history in two.
 *
 * The rule that matters is what happens when shorthand is *ambiguous*: "FIDELITY" has
 * three candidates in the base. An automatic pick would be wrong a third of the time
 * and invisible once accepted, so ambiguity is never resolved here — the candidates are
 * written into the proposal's notes and a human chooses in C5.
 */
export interface ClientMatch {
  clientId: string | null
  reason: string
  confidencePenalty: number
}

export function matchClient(name: string | null, clients: Client[]): ClientMatch {
  if (!name) return { clientId: null, reason: '', confidencePenalty: 0 }

  const key = companyKey(name)
  if (!key) return { clientId: null, reason: '', confidencePenalty: 0 }

  const exact = clients.filter((c) => companyKey(c.name) === key)
  if (exact.length === 1) {
    return { clientId: exact[0]!.id, reason: `Matched imported company "${exact[0]!.name}".`, confidencePenalty: 0 }
  }

  // Shorthand: the calendar name is a whole leading word-run of the company name.
  const prefix = clients.filter((c) => {
    const ck = companyKey(c.name)
    return ck === key || ck.startsWith(`${key} `)
  })
  if (prefix.length === 1) {
    return {
      clientId: prefix[0]!.id,
      reason: `Matched imported company "${prefix[0]!.name}" on the calendar's shorthand.`,
      confidencePenalty: 0.05,
    }
  }

  const candidates = prefix.length > 0 ? prefix : exact
  if (candidates.length > 1) {
    const names = candidates.slice(0, 4).map((c) => c.name).join(', ')
    return {
      clientId: null,
      reason: `Ambiguous: ${candidates.length} imported companies match "${name}" (${names}). Pick one here.`,
      confidencePenalty: 0.2,
    }
  }

  return { clientId: null, reason: `No imported company matches "${name}" — proposes a new one.`, confidencePenalty: 0.05 }
}

/** Shapes a deal into the Deal Proposals row C5 reviews. */
export function toProposal(
  deal: CalendarDeal,
  batchId: string,
  match: ClientMatch = { clientId: null, reason: '', confidencePenalty: 0 },
): Omit<DealProposal, 'id' | 'createdAt'> {
  const dateList = deal.heldDates
    .map((h) => `${h.date} (option ${h.order})`)
    .join(', ')
  const noteLines = [
    deal.heldDates.length > 1
      ? `Holds ${deal.heldDates.length} dates: ${dateList}. First choice ${deal.primaryDate}.`
      : null,
    deal.virtual ? 'Virtual event.' : null,
    deal.clientUnknown ? 'Client still TBD on the calendar — needs a name before it can go live.' : null,
    deal.contact ? null : 'Two-part title: the second field was read as a location, not a contact.',
    match.reason || null,
    ...deal.notes.map((n) => `Calendar note: ${n}`),
  ].filter(Boolean)

  return {
    title: `${deal.client}${deal.location ? ` — ${deal.location}` : ''} (${deal.primaryDate})`,
    seedSource: SEED_SOURCE,
    batchId,
    status: 'proposed',
    confidence: Math.max(0.1, Math.round((deal.confidence - match.confidencePenalty) * 100) / 100),
    clientName: deal.clientUnknown ? null : deal.client,
    clientId: match.clientId,
    contactName: deal.contact,
    contactId: null,
    stage: stageFor(deal),
    closedLostReason: null,
    // The calendar never says whether a booking came via a bureau. C2 decides the lane.
    lane: 'direct',
    eventDate: deal.primaryDate,
    holdDate: deal.primaryDate,
    holdOrder: deal.holdOrder,
    location: deal.location,
    negotiatedFee: null,
    decisionDate: null,
    historical: deal.historical,
    sourceRef: deal.eventIds[0] ?? null,
    sources: deal.eventIds.map((id) => `calendar:${id}`).join('\n'),
    notes: noteLines.length > 0 ? noteLines.join('\n') : null,
    conflictId: null,
    dealId: null,
    resolvedBy: null,
  }
}
