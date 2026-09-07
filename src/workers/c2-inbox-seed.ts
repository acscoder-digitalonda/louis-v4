/**
 * C2 — INBOX SEED. Phase C of the go-live cutover.
 *
 * Sweeps the mailboxes from 1 Jun 2026, attaches each in-flight thread to the deal C1
 * derived from the calendar, and fills the fields a calendar cannot know: the negotiated
 * fee, the decision date, whether the booking came through a bureau, and how far the
 * contract and invoice have got. A thread with no matching hold proposes its own deal.
 *
 * Everything it produces is a proposal. Nothing here writes a Deal.
 *
 * ── Why two model passes ───────────────────────────────────────────────────
 *
 * Sweeping the mailbox on a deal-shaped query still returns roughly two noise threads
 * for every real one — Venmo, Stripe, hotel offers, flight confirmations. Running the
 * expensive extraction over all of them costs several times what the answer is worth.
 *
 * So: a cheap `classify` pass (Haiku) decides whether a thread is a deal at all and what
 * it is about, and only survivors reach the `extract` pass (Sonnet), which reads bodies
 * and pulls values. Both tasks are in the gateway's CRITICAL set, so intake keeps working
 * after the monthly cap pauses research and QA.
 *
 * ── Why the lane is not guessed ────────────────────────────────────────────
 *
 * Bureau-versus-direct decides who is invoiced and which templates fire. It is tempting
 * to infer it from the contact's first name against the 701 bureau agents already in the
 * base, but those collapse to 238 distinct first names — "BOB", "LAUREN", "ANGELA" — so
 * a first-name hit is a coincidence, not evidence. The lane is only set when a thread
 * actually shows a bureau in it, and stays null otherwise for a human to fill.
 */

import { db } from '@/lib/data'
import { complete, GatewayPaused } from '@/lib/gateway'
import { agentActor, recordChanges, recordEvent } from '@/lib/audit'
import { sweep, type GmailThread } from '@/lib/google/gmail'
import type { CalendarDeal } from './c1-calendar-seed'
import { companyKey } from './f11-bookings'
import type { DealProposal, SeedSource, StageKey } from '@/lib/types'

const WORKER = 'C2'

export const SEED_SOURCE: SeedSource = 'inbox'
export const DEFAULT_BATCH_ID = 'seed-inbox-2026-09'

/** The default sweep. Deliberately broad — the classify pass is what narrows it. */
export const DEFAULT_QUERY =
  'after:2026/06/01 -in:draft -in:spam -in:trash ' +
  '(speaking OR keynote OR inquiry OR proposal OR contract OR invoice OR ' +
  '"save the date" OR availability OR agreement OR deposit OR honorarium)'

/** Ben's side of every conversation. Never the client. */
export const INTERNAL_DOMAINS = ['bennemtin.com', 'digitalonda.com']

const NOISE_SENDERS = [
  'notification.intuit.com',
  'inform.bill.com',
  'wetransfer.com',
  'stripe.com',
  'venmo.com',
  'notify.wellsfargo.com',
  'mindbodyonline.com',
  'travelocity.com',
  'wholefoodsmarket.com',
  'fathom.video', // meeting-recording bot, not a person
  'lu.ma',
]

/**
 * Relays, not people. The website form and the intake mailer forward a real inquiry from
 * a real client, so the thread matters — but the sending address is a robot and must
 * never end up as the contact or in the proposal's title.
 */
const RELAY_SENDERS = [
  'noreply.ondasmtp@gmail.com',
  'digitalonda.mailer@gmail.com',
  'noreply@',
  'no-reply@',
]

export function isRelay(address: string): boolean {
  const a = address.toLowerCase()
  return RELAY_SENDERS.some((r) => (r.endsWith('@') ? a.startsWith(r) : a === r))
}

/** Participants worth naming — a person, not a forwarder. */
export function humanParticipants(thread: GmailThread): string[] {
  return externalAddresses(thread).filter((a) => !isRelay(a))
}

export type ThreadIntent =
  | 'inquiry'
  | 'proposal'
  | 'contract'
  | 'invoice'
  | 'logistics'
  | 'kit'
  | 'questionnaire'
  | 'journal'
  | 'bureau'
  | 'noise'

export interface Classification {
  intent: ThreadIntent
  /** The client organisation the thread is about, as the thread names it. */
  client: string | null
  confidence: number
}

export interface Extraction {
  client: string | null
  eventDate: string | null
  location: string | null
  negotiatedFee: number | null
  decisionDate: string | null
  lane: 'direct' | 'bureau' | null
  bureauName: string | null
  contractStatus: 'none' | 'out' | 'signed' | null
  invoiceStatus: 'none' | 'sent' | 'paid' | null
  contactName: string | null
  contactEmail: string | null
  notes: string | null
  confidence: number
}

/** Everyone on the thread who is not Ben's side. */
export function externalAddresses(thread: GmailThread): string[] {
  const all = new Set<string>()
  for (const m of thread.messages) {
    for (const addr of [m.from, ...m.to, ...m.cc]) {
      const a = (addr ?? '').toLowerCase().trim()
      if (!a || !a.includes('@')) continue
      if (INTERNAL_DOMAINS.some((d) => a.endsWith(`@${d}`))) continue
      if (a === 'bennemtin@gmail.com') continue
      all.add(a)
    }
  }
  return [...all]
}

/** Cheap rejects, so obvious noise never costs a model call at all. */
export function isObviousNoise(thread: GmailThread): boolean {
  const external = externalAddresses(thread)
  if (external.length === 0) return true
  return external.every((a) => NOISE_SENDERS.some((d) => a.endsWith(d) || a.includes(d)))
}

function threadDigest(thread: GmailThread, bodyChars = 1200): string {
  const lines: string[] = [`Thread ${thread.id}`]
  for (const m of thread.messages.slice(0, 8)) {
    lines.push(
      `--- ${m.date} · from ${m.from} · to ${m.to.join(', ')}`,
      `Subject: ${m.subject}`,
      m.body.slice(0, bodyChars) || m.snippet,
    )
  }
  return lines.join('\n')
}

function parseJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = (fenced ? fenced[1]! : text).trim()
  try {
    return JSON.parse(raw) as T
  } catch {
    // Models occasionally prepend a sentence. Take the outermost object.
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(raw.slice(start, end + 1)) as T
    } catch {
      return null
    }
  }
}

const CLASSIFY_SYSTEM =
  'You sort a speaking-business inbox. You answer only with JSON. You are strict: most ' +
  'mail is not about a booking, and calling something a booking when it is not wastes a ' +
  'person\'s time later.'

export async function classifyThread(thread: GmailThread): Promise<Classification> {
  const result = await complete({
    worker: WORKER,
    task: 'classify',
    json: true,
    system: CLASSIFY_SYSTEM,
    input: [
      'Classify this email thread about a professional speaker.',
      '',
      'intent — one of:',
      '  inquiry       someone asking about booking him',
      '  proposal      a fee, rate or availability is being discussed',
      '  contract      an agreement is being sent, signed or negotiated',
      '  invoice       billing, deposit or payment',
      '  logistics     travel, hotel, AV, run of show for a booked event',
      '  kit           speaker kit, bio, headshot, intro, tech rider',
      '  questionnaire pre-event audience questions',
      '  journal       book or journal copies, bulk order, shipping',
      '  bureau        a speakers bureau checking in, not tied to one event',
      '  noise         anything else, including newsletters and personal mail',
      '',
      'client — the client organisation this is about, or null if none is named.',
      'confidence — 0 to 1.',
      '',
      'Answer: {"intent":"...","client":"...","confidence":0.0}',
      '',
      threadDigest(thread, 400),
    ].join('\n'),
  })

  const parsed = parseJson<Classification>(result.text)
  if (!parsed) return { intent: 'noise', client: null, confidence: 0 }
  return {
    intent: parsed.intent ?? 'noise',
    client: parsed.client || null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
  }
}

const EXTRACT_SYSTEM =
  'You read email threads for a speaking business and pull out facts. You answer only ' +
  'with JSON. Every field you cannot support from the text is null. You never estimate a ' +
  'fee, never infer a date, and never guess whether a bureau is involved — a wrong value ' +
  'here is worse than a missing one, because a person will trust it.'

export async function extractThread(thread: GmailThread): Promise<Extraction | null> {
  const result = await complete({
    worker: WORKER,
    task: 'extract',
    json: true,
    system: EXTRACT_SYSTEM,
    input: [
      'Pull the booking facts out of this thread. Use null for anything not stated.',
      '',
      'client          the client organisation',
      'eventDate       ISO yyyy-mm-dd, only if a specific date is agreed or proposed',
      'location        city and state/country if given',
      'negotiatedFee   number only, no currency symbol. Only a fee actually quoted or agreed.',
      'decisionDate    ISO date the client said they would decide by',
      'lane            "bureau" only if a speakers bureau is visibly involved, else "direct",',
      '                or null if the thread does not show it',
      'bureauName      the bureau, if any',
      'contractStatus  none | out | signed',
      'invoiceStatus   none | sent | paid',
      'contactName     the main person on the client side',
      'contactEmail    their address',
      'notes           one sentence on where this stands, for a human skimming a list',
      'confidence      0 to 1',
      '',
      threadDigest(thread),
    ].join('\n'),
  })

  return parseJson<Extraction>(result.text)
}

export interface ThreadOutcome {
  threadId: string
  mailbox: string
  intent: ThreadIntent
  /** The calendar deal this belongs to, if it could be placed. */
  matched: CalendarDeal | null
  matchReason: string
  extraction: Extraction | null
  participants: string[]
  lastMessageAt: string | null
}

/** Addresses that identify a person, never an organisation. */
const FREEMAIL = [
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
  'aol.com', 'me.com', 'live.com', 'proton.me', 'protonmail.com',
]

function domainOf(address: string): string | null {
  const at = address.indexOf('@')
  return at >= 0 ? address.slice(at + 1).toLowerCase() : null
}

function isFreemail(domain: string): boolean {
  return FREEMAIL.includes(domain)
}

/** "ACUITY/ TILT GROUP" → ["acuity","tilt","group"] */
function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((t) => t.length >= 4)
}

/**
 * Words that appear in a client name but identify nothing on their own. A hold called
 * "EVENT CONNECTIONS" must not swallow every thread whose subject says "event".
 */
const WEAK_TOKENS = new Set([
  'event', 'events', 'group', 'company', 'corp', 'association', 'assoc', 'foundation',
  'institute', 'university', 'college', 'school', 'center', 'centre', 'council',
  'society', 'club', 'annual', 'conference', 'summit', 'meeting', 'virtual', 'national',
  'international', 'america', 'american', 'global', 'partners', 'services', 'solutions',
])

/**
 * Places a thread against the calendar-derived deals.
 *
 * ── Why this is strict ─────────────────────────────────────────────────────
 *
 * A first pass matched on any single signal and produced three kinds of wreckage on a
 * 45-thread sweep:
 *
 *  - ten threads from five *different* people who each met Ben at *a* Rotary event all
 *    landed on the one hold named ROTARY, where they would have overwritten each other
 *  - a hold called EVENT CONNECTIONS absorbed threads whose subject merely said "event"
 *  - YPO PASADENA absorbed a thread from pasadena.edu, matching the location, not the client
 *
 * The lesson is the same one the bureau lane taught: one weak signal is a coincidence,
 * not evidence. So a match now needs either a company domain that genuinely belongs to
 * the client, or a name match *corroborated* by a second fact — a held date or the
 * location. Everything else is left unplaced, which is a finding a human can act on
 * rather than a silent corruption of a real proposal.
 */
export function placeThread(
  thread: GmailThread,
  classification: Classification,
  deals: CalendarDeal[],
  /** What the extraction pass read, when it has already run. */
  extracted: Pick<Extraction, 'client' | 'contactName' | 'location'> | null = null,
): { deal: CalendarDeal | null; reason: string } {
  const external = humanParticipants(thread)
  const domains = external
    .map(domainOf)
    .filter((d): d is string => Boolean(d) && !isFreemail(d!))
  const named = (classification.client ?? '').toLowerCase()

  // Tokens that point at more than one hold cannot identify one of them.
  const tokenCounts = new Map<string, number>()
  for (const deal of deals) {
    for (const tok of new Set(tokens(deal.client))) {
      tokenCounts.set(tok, (tokenCounts.get(tok) ?? 0) + 1)
    }
  }
  const discriminating = (tok: string) =>
    !WEAK_TOKENS.has(tok) && (tokenCounts.get(tok) ?? 0) === 1

  // 1. A company domain carrying the client's name, corroborated by the name the
  //    extractor read out of the thread.
  //
  //    The domain alone is not enough, and the reason is instructive: client names are
  //    full of place names. "YPO PASADENA" matched pasadena.edu — a community college
  //    with no connection to YPO. Excluding place tokens looked like the fix until it
  //    also killed "VICTORIA FOUNDATION" in Victoria BC, whose name genuinely is the
  //    city. There is no clever token rule here. Requiring a second, independent signal
  //    settles both: the college thread named no client at all, the foundation thread
  //    named itself.
  for (const deal of deals) {
    const strong = tokens(deal.client).filter(discriminating)
    if (strong.length === 0) continue

    for (const tok of strong) {
      const hitDomain = domains.find((d) =>
        d.split('.').some((part) => part === tok || part.startsWith(tok)),
      )
      if (!hitDomain) continue
      if (!named || !named.includes(tok)) continue
      return {
        deal,
        reason: `Sender domain "${hitDomain}" and the thread both name "${tok}" — calendar hold ${deal.client}.`,
      }
    }
  }

  // 2. The name the extractor read, corroborated by a date or the location. A name on its
  //    own is what put five separate Rotary leads on one deal.
  if (named) {
    for (const deal of deals) {
      const strong = tokens(deal.client).filter(discriminating)
      if (strong.length === 0 || !strong.every((tok) => named.includes(tok))) continue

      const heldDates = new Set(deal.heldDates.map((h) => h.date))
      const threadText = thread.messages
        .map((m) => `${m.subject} ${m.body}`)
        .join(' ')
        .toLowerCase()
      const dateHit = [...heldDates].find((d) => threadText.includes(d))
      const locationHit =
        deal.location && tokens(deal.location).filter(discriminating).find((t) => threadText.includes(t))

      if (dateHit) {
        return { deal, reason: `Names "${classification.client}" and mentions the held date ${dateHit} — hold ${deal.client}.` }
      }
      if (locationHit) {
        return { deal, reason: `Names "${classification.client}" and mentions "${locationHit}" — hold ${deal.client}.` }
      }
    }
  }

  // 3. Holds whose client is still "TBD". Ben blocks a date before the client is named,
  //    so nine upcoming holds say only a city and a first name — and the client's name is
  //    sitting in the mailbox. Resolving these is the most useful thing this sweep can do
  //    for the reconciliation session: it turns an anonymous block of Ben's diary into a
  //    named deal.
  //
  //    Three conditions, all required, and each one earned by a false positive on a real
  //    sweep:
  //      - the thread must actually name a client. "ORLANDO - ANDI" was resolved by a
  //        thread that named nobody.
  //      - the contact's first name must match. Common first names alone are not enough,
  //        which is why the location has to agree too.
  //      - the location must match what the *extractor* recorded as the event location,
  //        not merely appear somewhere in the body. Scanning the body put a University of
  //        Texas Health **Houston** thread onto the **MIAMI** hold, because the word
  //        turned up in passing.
  if (extracted?.client && extracted.contactName && extracted.location) {
    const nameWords = extracted.contactName.toUpperCase().split(/\s+/).filter(Boolean)
    const eventPlace = extracted.location.toLowerCase()

    for (const deal of deals) {
      if (!deal.clientUnknown || deal.historical) continue
      const first = (deal.contact ?? '').trim().toUpperCase()
      if (first.length < 3 || !nameWords.some((w) => w === first)) continue

      const placeTokens = tokens(deal.location ?? '').filter((t) => !WEAK_TOKENS.has(t))
      const placeHit = placeTokens.find((t) => eventPlace.includes(t))
      if (!placeHit) continue

      return {
        deal,
        reason:
          `Resolves the "TBD" hold on ${deal.primaryDate}: the thread names ` +
          `${extracted.client}, contact "${first}", in ${extracted.location}. ` +
          `This hold had no client name until now.`,
      }
    }
  }

  return { deal: null, reason: 'Deal-shaped thread with no calendar hold that it can be tied to.' }
}

export function stageForIntent(intent: ThreadIntent): StageKey {
  switch (intent) {
    case 'inquiry':
    case 'bureau':
      return 'inquiry'
    case 'proposal':
      // A thread with a fee quoted in it *is* a firm offer. This is the one seed that
      // can honestly claim the stage, because it read the number in the email.
      return 'firm-offer'
    case 'contract':
    case 'invoice':
      return 'closed-won'
    case 'logistics':
    case 'kit':
    case 'questionnaire':
      return 'pre-event'
    default:
      return 'inquiry'
  }
}

export interface SweepReport {
  threads: number
  skippedAsNoise: number
  classified: number
  extracted: number
  matchedToCalendar: number
  unplaced: number
  byIntent: Record<string, number>
  outcomes: ThreadOutcome[]
  pausedByCap: boolean
}

/**
 * The read half. Fetches, classifies, extracts — and writes nothing, so it can be run
 * as often as needed while the prompts are being tuned.
 */
export async function sweepInbox(
  deals: CalendarDeal[],
  opts: { query?: string; limit?: number; threads?: GmailThread[] } = {},
): Promise<SweepReport> {
  const threads = opts.threads ?? (await sweep(opts.query ?? DEFAULT_QUERY, opts.limit ?? 200))

  const report: SweepReport = {
    threads: threads.length,
    skippedAsNoise: 0,
    classified: 0,
    extracted: 0,
    matchedToCalendar: 0,
    unplaced: 0,
    byIntent: {},
    outcomes: [],
    pausedByCap: false,
  }

  for (const thread of threads) {
    if (isObviousNoise(thread)) {
      report.skippedAsNoise += 1
      continue
    }

    let classification: Classification
    try {
      classification = await classifyThread(thread)
      report.classified += 1
    } catch (err) {
      if (err instanceof GatewayPaused) {
        report.pausedByCap = true
        break
      }
      console.warn(`[${WORKER}] classify ${thread.id} failed: ${err instanceof Error ? err.message : err}`)
      continue
    }

    report.byIntent[classification.intent] = (report.byIntent[classification.intent] ?? 0) + 1
    if (classification.intent === 'noise') {
      report.skippedAsNoise += 1
      continue
    }

    // Extraction runs before placement, not after: resolving a "TBD" hold needs the
    // contact name, and that only exists once the extractor has read the thread.
    let extraction: Extraction | null = null
    try {
      extraction = await extractThread(thread)
      if (extraction) report.extracted += 1
    } catch (err) {
      if (err instanceof GatewayPaused) {
        report.pausedByCap = true
        break
      }
      console.warn(`[${WORKER}] extract ${thread.id} failed: ${err instanceof Error ? err.message : err}`)
    }

    const { deal, reason } = placeThread(thread, classification, deals, extraction)
    if (deal) report.matchedToCalendar += 1
    else report.unplaced += 1

    report.outcomes.push({
      threadId: thread.id,
      mailbox: thread.mailbox,
      intent: classification.intent,
      matched: deal,
      matchReason: reason,
      extraction,
      participants: humanParticipants(thread),
      lastMessageAt:
        thread.messages.map((m) => m.date).sort((a, b) => b.localeCompare(a))[0] ?? null,
    })
  }

  return report
}


/**
 * What makes two unplaced threads the same prospect: the client the extractor read, or
 * failing that the person on the other end. Never the sending address alone — a website
 * form relays every inquiry from the same robot, which would collapse unrelated clients
 * into one.
 */
export function groupKeyFor(o: ThreadOutcome): string {
  const client = o.extraction?.client
  if (client) return `c:${companyKey(client)}`

  // Falling back to an address is only safe when the address belongs to a person. The
  // website form relays every inquiry from one robot, so grouping on it would fold Sun
  // Life, YPO Rocky Mountain and Colombo & Hurd into a single proposal. An unnamed thread
  // from a relay stays on its own until a human names it.
  const candidates = [o.extraction?.contactEmail, ...o.participants].filter(
    (a): a is string => typeof a === 'string' && a.length > 0 && !isRelay(a),
  )
  const person = candidates[0]
  return person ? `p:${person.toLowerCase()}` : `t:${o.threadId}`
}

export interface UnplacedGroup {
  /** The thread that gets to create the proposal — the most recent one. */
  lead: ThreadOutcome
  members: ThreadOutcome[]
}

export function groupUnplaced(outcomes: ThreadOutcome[]): Map<string, UnplacedGroup> {
  const groups = new Map<string, ThreadOutcome[]>()
  for (const o of outcomes) {
    if (o.matched || o.intent === 'noise' || !o.extraction) continue
    const key = groupKeyFor(o)
    groups.set(key, [...(groups.get(key) ?? []), o])
  }

  const out = new Map<string, UnplacedGroup>()
  for (const [key, members] of groups) {
    const sorted = [...members].sort((a, b) =>
      (b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? ''),
    )
    out.set(key, { lead: sorted[0]!, members: sorted })
  }
  return out
}

export interface CommitReport {
  enriched: number
  created: number
  skipped: number
}

/**
 * The write half. Only ever called after a human has read the sweep report.
 *
 * A matched thread *enriches* the calendar proposal rather than creating a second one,
 * and only fills blanks — the calendar is better evidence for a date than an email is,
 * so a value already there wins.
 */
export async function commitSweep(
  report: SweepReport,
  batchId = DEFAULT_BATCH_ID,
): Promise<CommitReport> {
  const provider = db()
  const proposals = await provider.listDealProposals('proposed')
  const bySourceRef = new Map(proposals.filter((p) => p.sourceRef).map((p) => [p.sourceRef!, p]))

  const out: CommitReport = { enriched: 0, created: 0, skipped: 0 }

  // Threads that could not be placed are grouped before anything is written. Ben's team
  // follows up after every keynote, so one prospect routinely spans several separate
  // threads — Lauren Murdoch appeared three times in a 45-thread sweep. Creating one
  // proposal per thread would hand Liezel the same person to review three times, and she
  // would have no way to tell they were the same.
  const unplacedGroups = groupUnplaced(report.outcomes)

  for (const o of report.outcomes) {
    const e = o.extraction
    if (!e) {
      out.skipped += 1
      continue
    }

    const sources = `gmail:${o.threadId}`

    if (o.matched) {
      const existing = bySourceRef.get(o.matched.eventIds[0] ?? '')
      if (!existing) {
        out.skipped += 1
        continue
      }
      const patch: Partial<DealProposal> = {}
      if (existing.negotiatedFee === null && e.negotiatedFee !== null) patch.negotiatedFee = e.negotiatedFee
      if (!existing.decisionDate && e.decisionDate) patch.decisionDate = e.decisionDate
      if (!existing.contactName && e.contactName) patch.contactName = e.contactName
      if (!existing.location && e.location) patch.location = e.location
      if (e.lane) patch.lane = e.lane
      patch.sources = [existing.sources, sources].filter(Boolean).join('\n')
      patch.notes = [
        existing.notes,
        `From mail: ${o.matchReason}`,
        e.notes ? `Status: ${e.notes}` : null,
        e.bureauName ? `Bureau: ${e.bureauName}` : null,
        e.contractStatus ? `Contract: ${e.contractStatus}` : null,
        e.invoiceStatus ? `Invoice: ${e.invoiceStatus}` : null,
      ]
        .filter(Boolean)
        .join('\n')

      // recordChanges, not recordEvent: it diffs before against after, so each filled
      // field lands in the audit log with the value it replaced. recordEvent writes
      // oldValue: null, which is what made the first inbox batch impossible to reverse
      // field-by-field.
      const before = Object.fromEntries(
        Object.keys(patch).map((k) => [k, existing[k as keyof DealProposal]]),
      )
      await provider.updateDealProposal(existing.id, patch)
      await recordChanges({
        table: 'dealProposals',
        recordId: existing.id,
        before,
        after: patch as Record<string, unknown>,
        actor: agentActor(WORKER),
        source: `inbox thread ${o.threadId} (${o.intent})`,
        batchId,
      })
      out.enriched += 1
      continue
    }

    // A proposal with no client name is not reviewable: the row would read
    // "someone@gmail.com — inquiry" and a human could do nothing with it but guess.
    // These are real leads, they are kept in the sweep report, and they belong in the
    // weekly review as "a thread with no deal" — not in the reconciliation queue.
    if (!e.client) {
      out.skipped += 1
      continue
    }

    // Only the first thread of a group creates the row; the rest fold into it.
    const group = unplacedGroups.get(groupKeyFor(o))
    if (!group || group.lead.threadId !== o.threadId) {
      out.skipped += 1
      continue
    }

    const created = await provider.createDealProposal({
      title: `${e.client ?? o.participants[0] ?? 'Unknown'} — ${o.intent} (no calendar hold)`,
      seedSource: SEED_SOURCE,
      batchId,
      status: 'proposed',
      confidence: e.confidence ?? 0.4,
      clientName: e.client,
      clientId: null,
      contactName: e.contactName,
      contactId: null,
      closedLostReason: null,
      stage: stageForIntent(o.intent),
      lane: e.lane ?? 'direct',
      eventDate: e.eventDate,
      holdDate: null,
      holdOrder: null,
      location: e.location,
      negotiatedFee: e.negotiatedFee,
      decisionDate: e.decisionDate,
      historical: false,
      sourceRef: o.threadId,
      sources: group.members.map((m) => `gmail:${m.threadId}`).join('\n'),
      notes: [
        o.matchReason,
        e.notes,
        e.bureauName ? `Bureau: ${e.bureauName}` : null,
        group.members.length > 1
          ? `${group.members.length} threads about this prospect, merged.`
          : null,
        `Participants: ${[...new Set(group.members.flatMap((m) => m.participants))].join(', ')}`,
        `Last message ${o.lastMessageAt ?? 'unknown'}`,
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
      what: 'Proposed from inbox',
      detail: `thread ${o.threadId} (${o.intent})`,
      actor: agentActor(WORKER),
      source: 'inbox',
      batchId,
    })
    out.created += 1
  }

  console.info(
    `[${WORKER}] inbox seed ${batchId}: ${out.enriched} enriched, ${out.created} created, ${out.skipped} skipped`,
  )
  return out
}
