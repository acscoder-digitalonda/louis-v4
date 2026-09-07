/**
 * WP1.5 — SOCIAL PROOF. Who else in your world has booked him.
 *
 * The resolver behind E01b, the personal first reply. Given an inquiry's industry it
 * returns three things: a sentence about the industry, three to five client names, and
 * **exactly one** testimonial.
 *
 * One. Not a wall. That number comes from Ben's own sent mail, and it is the whole design
 * constraint — a list of forty logos reads as a brochure, and a brochure is what someone
 * sends when they have nothing specific to say. One quote from the reader's own industry,
 * paired with the reel, says: we have done this, for people like you.
 *
 * ── The ordering rules, and why each one is there ──────────────────────────
 *
 * Same industry first, then adjacent ones, because "we work with insurance companies" is
 * only interesting to an insurance company. Repeat clients before one-offs, because a
 * company that booked twice is a stronger claim than two that booked once. Recent before
 * old, because a 2019 booking invites the question of what has happened since.
 *
 * And a virtual inquiry gets virtual proof where it exists: the first question a virtual
 * buyer has is whether the talk survives a screen.
 */

import type { PastClient, Testimonial } from './types'

/**
 * The industry taxonomy the seed data actually uses.
 *
 * Written down because guessing it cost a rewrite: the first version of this file used
 * names like "Insurance", "Manufacturing" and "Food & Beverage", none of which exist in
 * the 711-row past-client file. Roughly seventy per cent of the adjacency map was dead
 * code that looked like it was working.
 */
export const INDUSTRIES = [
  'Financial Services',
  'Healthcare & Pharma',
  'Technology',
  'Associations & Nonprofits',
  'Retail & Consumer',
  'Education & Youth',
  'Industrial & Energy',
  'Real Estate',
  'Hospitality & Events',
  'Executive Networks (YPO etc.)',
  'Professional Services',
  'Media & Agencies',
  'Government & Public Sector',
  'Agriculture',
  'Building Products',
  'Entertainment',
  'Non-Profit/Community',
  'Sports & Entertainment',
] as const

/**
 * Values that appear in the industry column but are not industries.
 *
 * `Needs review` and `Unknown` are placeholders on eleven and one company respectively,
 * waiting on WP1.7's enrichment. Matching on them would tell a hospital that Ben speaks
 * to "Unknown", which is worse than saying nothing.
 */
export const NOT_AN_INDUSTRY = ['Needs review', 'Unknown', 'Celebrity', '']

/**
 * Industries that count as neighbours when the exact one has too little.
 *
 * Deliberately sparse and deliberately asymmetric. A wrong neighbour is worse than no
 * neighbour: telling a hospital that Ben speaks to banks reads as "we have nothing for
 * you" with extra steps. Financial Services has 228 past clients and never needs a
 * neighbour; Agriculture has two and cannot function without one.
 */
const ADJACENT: Record<string, string[]> = {
  'Financial Services': ['Professional Services', 'Real Estate'],
  'Healthcare & Pharma': ['Associations & Nonprofits'],
  Technology: ['Professional Services', 'Media & Agencies'],
  'Associations & Nonprofits': ['Non-Profit/Community', 'Executive Networks (YPO etc.)'],
  'Retail & Consumer': ['Hospitality & Events', 'Agriculture'],
  'Education & Youth': ['Associations & Nonprofits', 'Government & Public Sector'],
  'Industrial & Energy': ['Building Products', 'Real Estate'],
  'Real Estate': ['Building Products', 'Financial Services'],
  'Hospitality & Events': ['Retail & Consumer', 'Entertainment'],
  'Executive Networks (YPO etc.)': ['Associations & Nonprofits', 'Professional Services'],
  'Professional Services': ['Financial Services', 'Technology'],
  'Media & Agencies': ['Entertainment', 'Technology'],
  'Government & Public Sector': ['Education & Youth', 'Associations & Nonprofits'],
  Agriculture: ['Retail & Consumer', 'Industrial & Energy'],
  'Building Products': ['Industrial & Energy', 'Real Estate'],
  Entertainment: ['Media & Agencies', 'Sports & Entertainment'],
  'Non-Profit/Community': ['Associations & Nonprofits'],
  'Sports & Entertainment': ['Entertainment', 'Media & Agencies'],
}

/** A placeholder is not something to match on. */
export function isRealIndustry(industry: string | null | undefined): industry is string {
  return typeof industry === 'string' && !NOT_AN_INDUSTRY.includes(industry)
}

export const MIN_CLIENTS = 3
export const MAX_CLIENTS = 5

export interface ProofRequest {
  industry: string | null
  /**
   * Whose name goes in the industry sentence.
   *
   * Passed in rather than templated. An earlier version returned the sentence with a
   * literal `{{speakerName}}` in it, which then travelled as a *value* into the email
   * template — and `render` deliberately does not expand values, so the client would have
   * read `{{speakerName}}` on the page. Passing the name keeps the module white-label and
   * keeps the placeholder out of the copy.
   */
  speakerName?: string
  /** Virtual inquiries get virtual proof where it exists. */
  virtual?: boolean
  /** Never quote a company back to itself, or name it in its own list. */
  excludeCompany?: string | null
}

export interface SocialProof {
  industryLine: string | null
  relatedClients: string[]
  relatedClientsLine: string | null
  testimonial: Testimonial | null
  /** Why this set was chosen. Shown in the review queue, not to the client. */
  rationale: string
}

function key(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * Ranks past clients for one industry.
 *
 * Exported because the ordering is the substance of this module, and a rule nobody can
 * test in isolation is a rule that quietly rots.
 */
export function rankClients(clients: PastClient[], req: ProofRequest): PastClient[] {
  if (!isRealIndustry(req.industry)) return []
  const exclude = req.excludeCompany ? key(req.excludeCompany) : null
  const industry = req.industry
  const neighbours = ADJACENT[industry] ?? []

  const tier = (c: PastClient): number => {
    if (c.industry === industry) return 0
    if (neighbours.includes(c.industry)) return 1
    return 2
  }

  return clients
    .filter((c) => tier(c) < 2)
    .filter((c) => !exclude || key(c.clientName) !== exclude)
    .sort(
      (a, b) =>
        tier(a) - tier(b) ||
        // A virtual inquiry prefers a client who has done it virtually.
        (req.virtual ? Number(b.anyVirtual) - Number(a.anyVirtual) : 0) ||
        b.bookings - a.bookings ||
        (b.lastYear ?? 0) - (a.lastYear ?? 0) ||
        a.clientName.localeCompare(b.clientName),
    )
}

/**
 * Picks the one testimonial.
 *
 * Industry is a **filter**, not a bonus. An earlier version scored it alongside format
 * and let a quote from an agriculture co-op reach an insurance company, because matching
 * the format alone was enough to clear the bar. Jordan's order is industry, then format,
 * then recency; the first of those decides who is eligible and the rest only sort them.
 *
 * Recency is not implemented, and saying so is better than pretending: the archived
 * quotes carry no date. When Ben starts adding new ones with a date, sort on it here.
 */
export function pickTestimonial(testimonials: Testimonial[], req: ProofRequest): Testimonial | null {
  // No industry — or a placeholder like "Needs review" — means we know nothing about the
  // reader, and a quote to an unknown reader is not proof, just a quote.
  if (!isRealIndustry(req.industry)) return null

  const industry = req.industry
  const neighbours = ADJACENT[industry] ?? []
  const exclude = req.excludeCompany ? key(req.excludeCompany) : null
  const wanted = req.virtual ? 'Virtual' : 'In-person'

  const eligible = testimonials
    .filter((t) => t.active)
    .filter((t) => !exclude || key(t.company ?? '') !== exclude)
    .filter((t) => isRealIndustry(t.industry))
    .filter((t) => t.industry === industry || neighbours.includes(t.industry ?? ''))

  if (eligible.length === 0) return null

  const score = (t: Testimonial): number => {
    let s = t.industry === industry ? 100 : 40
    if (t.format === wanted) s += 20
    else if (t.format === 'Either') s += 10
    // A quote with a named person and title carries more weight than a bare company.
    if (t.personName && t.title) s += 5
    return s
  }

  return (
    eligible
      .map((t) => ({ t, s: score(t) }))
      .sort((a, b) => b.s - a.s || a.t.personName.localeCompare(b.t.personName))[0]?.t ?? null
  )
}

function sentence(names: string[]): string {
  if (names.length === 1) return names[0]!
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The whole proof block for one inquiry.
 *
 * Every field can be null, and the caller has to cope: a brand-new industry has no past
 * clients and no quote, and the honest answer is to send the email without the proof
 * block rather than to pad it with strangers.
 */
export function resolveSocialProof(
  req: ProofRequest,
  data: { clients: PastClient[]; testimonials: Testimonial[] },
): SocialProof {
  const ranked = rankClients(data.clients, req)
  const chosen = ranked.slice(0, MAX_CLIENTS)
  const testimonial = pickTestimonial(data.testimonials, req)

  const sameIndustry = ranked.filter((c) => c.industry === req.industry).length
  const industryLine =
    isRealIndustry(req.industry) && sameIndustry >= MIN_CLIENTS
      ? `${req.industry} groups are among the audiences ${req.speakerName ?? 'we'} speak${req.speakerName ? 's' : ''} to most.`
      : null

  const relatedClientsLine =
    chosen.length >= MIN_CLIENTS
      ? `Recent groups include ${sentence(chosen.map((c) => c.clientName))}.`
      : null

  const reasons: string[] = []
  if (!isRealIndustry(req.industry))
    reasons.push(
      req.industry
        ? `"${req.industry}" is a placeholder, not an industry, so no proof could be matched.`
        : 'No industry on the inquiry, so no proof could be matched.',
    )
  else {
    reasons.push(`${sameIndustry} past client(s) in ${req.industry}, ${ranked.length} counting neighbours.`)
    if (chosen.length < MIN_CLIENTS) {
      reasons.push(`Fewer than ${MIN_CLIENTS} names, so the client line is left out rather than padded.`)
    }
    if (!testimonial) reasons.push('No testimonial matched on industry or format, so none is used.')
  }

  return {
    industryLine,
    relatedClients: chosen.map((c) => c.clientName),
    relatedClientsLine,
    testimonial,
    rationale: reasons.join(' '),
  }
}
