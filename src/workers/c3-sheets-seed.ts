/**
 * C3 — SHEETS SEED. Phase C of the go-live cutover.
 *
 * Reads Liezel's tracking sheets and reconciles them against the proposals C1 and C2
 * already produced. Everything it produces is a proposal or an edit to one; nothing here
 * writes a Deal.
 *
 * ── Why this matters more than it looks ────────────────────────────────────
 *
 * The inbox sweep read 480 threads and came back with a negotiated fee on 12 proposals
 * and a lane on 19. These sheets carry both in structured columns, for the whole 2026 and
 * 2027 pipeline, because Liezel has been maintaining them by hand for years. On the two
 * fields the reconciliation session most needs, a spreadsheet beats an inbox.
 *
 * ── What the sheets actually look like ─────────────────────────────────────
 *
 * `Client Inquiry Steps` is the master booking tracker, one tab per year. It is not a
 * table with a header row; it is a printed page:
 *
 *   col 0  in-person marker   "1", "-", blank
 *   col 1  virtual marker     "1", blank
 *   col 2  CLIENT — or a MONTH, when the row is a section heading
 *   col 4  Location           col 5  audience size   col 6  Date
 *   col 8  $                  col 9  Bureaus         col 10 Agent
 *
 * Month rows repeat the column labels beneath them, so the file reads as twelve small
 * tables stacked up. Header position moves between tabs, which is why nothing here keys
 * off row 1 — a month row is detected by its own shape and used as a separator.
 *
 * Money is written however it was quickest to type: `20k`, `27.5k`, `$40k`, `26,900`,
 * `37,500`, `3000 net`. Dates likewise: `1/5/26`, `3/2`, and at least one `4/16/25` in the
 * 2026 tab that is plainly a typo for 2026. The parsers below take the tab's year as the
 * authority and treat the cell as the day and month.
 */

import { db } from '@/lib/data'
import { agentActor, recordChanges, recordEvent } from '@/lib/audit'
import { normaliseBureau } from './f11-bookings'
import type { DealProposal, SeedSource } from '@/lib/types'

const WORKER = 'C3'

export const SEED_SOURCE: SeedSource = 'sheets'
export const DEFAULT_BATCH_ID = 'seed-sheets-2026-09'

const MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]

/** `n/a`, `-`, blank — Liezel's ways of writing "nothing here". */
export function blankish(value: unknown): boolean {
  const v = String(value ?? '').trim().toLowerCase()
  return v === '' || v === 'n/a' || v === 'na' || v === '-' || v === '?'
}

/**
 * `20k` → 20000, `27.5k` → 27500, `$40k` → 40000, `26,900` → 26900,
 * `3000 net` → 3000. Returns null rather than a guess when the cell is not a number —
 * a wrong fee is worse than a missing one, and this feeds a money field.
 */
export function parseFee(raw: unknown): number | null {
  if (blankish(raw)) return null
  const text = String(raw).toLowerCase().replace(/[$,\s]/g, '')
  const match = text.match(/^(\d+(?:\.\d+)?)(k?)/)
  if (!match) return null
  const n = Number(match[1])
  if (!Number.isFinite(n) || n <= 0) return null
  const value = match[2] === 'k' ? n * 1000 : n
  // Below a thousand with no "k" is a page count or an audience size that drifted into
  // the wrong column, not a keynote fee.
  return value >= 1000 ? Math.round(value) : null
}

/**
 * `1/5/26` → 2026-01-05, `3/2` → the tab's year. The tab wins over the cell: the 2026
 * tab contains `4/16/25` for an April 2026 booking.
 */
export function parseSheetDate(raw: unknown, tabYear: number): string | null {
  if (blankish(raw)) return null
  const first = String(raw).split(/[-–]/)[0]!.trim()
  const m = first.match(/^(\d{1,2})\s*\/\s*(\d{1,2})/)
  if (!m) return null
  const month = Number(m[1])
  const day = Number(m[2])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${tabYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export interface SheetBooking {
  client: string
  location: string | null
  audienceSize: number | null
  eventDate: string | null
  industry: string | null
  fee: number | null
  bureau: string | null
  agent: string | null
  virtual: boolean
  tab: string
  row: number
}

/** True when a row is a month heading rather than a booking. */
function isMonthRow(cells: string[]): boolean {
  const label = (cells[2] ?? '').trim().toUpperCase()
  return MONTHS.some((m) => label.startsWith(m))
}

export function parseInquirySteps(rows: string[][], tab: string): SheetBooking[] {
  const tabYear = Number(tab.match(/(20\d\d)/)?.[1] ?? new Date().getFullYear())
  const out: SheetBooking[] = []

  rows.forEach((raw, i) => {
    const c = (n: number) => String(raw[n] ?? '').trim()
    const client = c(2)
    if (!client || isMonthRow(raw.map((x) => String(x ?? '')))) return
    // A row that names no location and no date is a stray note, not a booking.
    if (blankish(c(4)) && blankish(c(6))) return

    const bureauRaw = c(9)
    out.push({
      client,
      location: blankish(c(4)) ? null : c(4),
      audienceSize: /^\d+$/.test(c(5)) ? Number(c(5)) : null,
      eventDate: parseSheetDate(c(6), tabYear),
      industry: blankish(c(7)) ? null : c(7),
      fee: parseFee(c(8)),
      bureau: blankish(bureauRaw) ? null : (normaliseBureau(bureauRaw) ?? bureauRaw),
      agent: blankish(c(10)) ? null : c(10),
      virtual: c(1) === '1' || /virtual/i.test(c(4)),
      tab,
      row: i + 1,
    })
  })

  return out
}

export interface ReleasedInquiry {
  company: string
  contactName: string | null
  email: string | null
  city: string | null
  askedFor: string | null
  reason: string | null
  otherDates: string | null
  row: number
}

/** `Company | Client Name | Email | City | Date | Reason | Other Dates` — a real table. */
export function parseReleasedInquiries(rows: string[][]): ReleasedInquiry[] {
  const header = rows.findIndex((r) => (r[0] ?? '').trim().toLowerCase() === 'company')
  if (header < 0) return []
  return rows
    .slice(header + 1)
    .map((r, i) => {
      const c = (n: number) => String(r[n] ?? '').trim()
      return {
        company: c(0),
        contactName: blankish(c(1)) ? null : c(1),
        email: blankish(c(2)) ? null : c(2).toLowerCase(),
        city: blankish(c(3)) ? null : c(3),
        askedFor: blankish(c(4)) ? null : c(4),
        reason: blankish(c(5)) ? null : c(5),
        otherDates: blankish(c(6)) ? null : c(6),
        row: header + i + 2,
      }
    })
    .filter((r) => r.company !== '')
}

/** Loose company match, same normalisation the history import used. */
function key(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(inc|llc|ltd|the|corp|corporation|company|co)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface SheetsPlan {
  bookings: number
  matched: { booking: SheetBooking; proposal: DealProposal; fills: string[] }[]
  unmatched: SheetBooking[]
  released: ReleasedInquiry[]
  releasedAlreadyProposed: number
}

/**
 * Reconciles the sheets against what is already in the review queue.
 *
 * A sheet row matches a proposal on client name *and* a nearby date — the same two-signal
 * rule the inbox sweep needed, for the same reason: Liezel's tracker holds several
 * bookings for one client across a year, and a name-only match would attach a March fee
 * to a November booking.
 *
 * "Nearby" is a month rather than a week, because the two sources mean different things
 * by a date: C1 collapses a hold on several candidate dates into one proposal carrying
 * the *first choice*, while the sheet records the date actually agreed. A month is wide
 * enough for that gap and still rejects Forward Academy at 106 days, or a YPO Miami
 * booking a year out.
 *
 * It does not rescue every case, and deliberately so. Janney has seven proposals in the
 * queue and three of them fall inside a month of the tracker's date. Widening the window
 * turns that from a wrong match into no match, which is the better failure: ambiguity is
 * never resolved by picking. Two candidates in range means the row goes to the unmatched
 * list, and a person decides at C5 — where they can also see that Janney needs merging.
 */
export async function planSheets(
  bookings: SheetBooking[],
  released: ReleasedInquiry[],
): Promise<SheetsPlan> {
  const provider = db()
  const proposals = await provider.listDealProposals('proposed')

  const plan: SheetsPlan = {
    bookings: bookings.length,
    matched: [],
    unmatched: [],
    released: [],
    releasedAlreadyProposed: 0,
  }

  const used = new Set<string>()

  for (const b of bookings) {
    const k = key(b.client)
    if (!k) continue

    const candidates = proposals.filter((p) => {
      if (used.has(p.id)) return false
      const pk = key(p.clientName ?? p.title)
      if (!pk) return false
      if (!(pk === k || pk.startsWith(`${k} `) || k.startsWith(`${pk} `))) return false
      if (!b.eventDate || !p.eventDate) return false
      if (b.eventDate.slice(0, 4) !== p.eventDate.slice(0, 4)) return false
      const days = Math.abs(
        (new Date(b.eventDate).getTime() - new Date(p.eventDate).getTime()) / 86_400_000,
      )
      return days <= 31
    })

    if (candidates.length !== 1) {
      plan.unmatched.push(b)
      continue
    }

    const p = candidates[0]!
    const fills: string[] = []
    if (p.negotiatedFee === null && b.fee !== null) fills.push('fee')
    if (p.lane !== 'bureau' && b.bureau) fills.push('lane')
    if (!p.location && b.location) fills.push('location')
    if (!p.contactName && b.agent) fills.push('agent')

    if (fills.length === 0) {
      plan.unmatched.push(b)
      continue
    }
    used.add(p.id)
    plan.matched.push({ booking: b, proposal: p, fills })
  }

  const proposedNames = new Set(proposals.map((p) => key(p.clientName ?? p.title)))
  for (const r of released) {
    if (proposedNames.has(key(r.company))) {
      plan.releasedAlreadyProposed += 1
      continue
    }
    plan.released.push(r)
  }

  return plan
}

export interface SheetsResult {
  enriched: number
  releasedCreated: number
}

/** Only ever called after a human has read the plan. */
export async function commitSheets(
  plan: SheetsPlan,
  batchId = DEFAULT_BATCH_ID,
): Promise<SheetsResult> {
  const provider = db()
  const out: SheetsResult = { enriched: 0, releasedCreated: 0 }

  for (const { booking, proposal, fills } of plan.matched) {
    const patch: Partial<DealProposal> = {}
    if (fills.includes('fee')) patch.negotiatedFee = booking.fee
    if (fills.includes('lane')) patch.lane = 'bureau'
    if (fills.includes('location')) patch.location = booking.location
    if (fills.includes('agent')) patch.contactName = booking.agent
    patch.sources = [proposal.sources, `sheet:Client Inquiry Steps!${booking.tab}:${booking.row}`]
      .filter(Boolean)
      .join('\n')
    patch.notes = [
      proposal.notes,
      `From Liezel's tracker (${booking.tab} row ${booking.row}): ` +
        [
          booking.fee !== null ? `fee ${booking.fee.toLocaleString()}` : null,
          booking.bureau ? `bureau ${booking.bureau}` : 'direct',
          booking.agent ? `agent ${booking.agent}` : null,
          booking.audienceSize ? `${booking.audienceSize} in the room` : null,
        ]
          .filter(Boolean)
          .join(' · '),
    ]
      .filter(Boolean)
      .join('\n')

    const before = Object.fromEntries(
      Object.keys(patch).map((k) => [k, proposal[k as keyof DealProposal]]),
    )
    await provider.updateDealProposal(proposal.id, patch)
    await recordChanges({
      table: 'dealProposals',
      recordId: proposal.id,
      before,
      after: patch as Record<string, unknown>,
      actor: agentActor(WORKER),
      source: `sheets ${booking.tab}:${booking.row}`,
      batchId,
    })
    out.enriched += 1
  }

  // Released inquiries become Closed Lost proposals carrying the reason, which is what
  // makes the re-engagement segment in WP1.7 possible at all — "why did this one go away"
  // is the whole basis of the twelve-month follow-up.
  for (const r of plan.released) {
    const created = await provider.createDealProposal({
      title: `${r.company} — released inquiry`,
      seedSource: SEED_SOURCE,
      batchId,
      status: 'proposed',
      confidence: 0.75,
      clientName: r.company,
      clientId: null,
      contactName: r.contactName,
      contactId: null,
      // The stage list has no Closed Lost yet (WP0.2 adds it). Dormant is the closest
      // thing that exists and does not pretend the deal is live; the reason is in notes
      // either way, so nothing is lost when the stage arrives.
      stage: 'dormant',
      lane: 'direct',
      eventDate: null,
      holdDate: null,
      holdOrder: null,
      location: r.city,
      negotiatedFee: null,
      decisionDate: null,
      historical: false,
      sourceRef: `released:${r.row}`,
      sources: `sheet:Released Inquiries!${r.row}`,
      notes: [
        `Released inquiry. Reason: ${r.reason ?? 'not recorded'}.`,
        r.askedFor ? `Originally asked for: ${r.askedFor}.` : null,
        r.otherDates ? `Offered other dates: ${r.otherDates}.` : null,
        r.email ? `Contact: ${r.email}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      conflictId: null,
      dealId: null,
      resolvedBy: null,
      createdAt: new Date().toISOString(),
    })
    await recordEvent({
      table: 'dealProposals',
      recordId: created.id,
      what: 'Proposed from sheets',
      detail: `Released Inquiries row ${r.row}`,
      actor: agentActor(WORKER),
      source: 'sheets',
      batchId,
    })
    out.releasedCreated += 1
  }

  console.info(
    `[${WORKER}] sheets seed ${batchId}: ${out.enriched} enriched, ${out.releasedCreated} released inquiries`,
  )
  return out
}
