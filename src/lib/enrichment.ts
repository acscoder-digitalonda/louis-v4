/**
 * Company enrichment — industry, address and logo, from the company's own website.
 *
 * A hundred and eighty-nine companies in the base have no industry. That is not a
 * cosmetic gap: the social-proof engine picks testimonials by industry, so an unclassified
 * company gets a generic proof line, and the adjacency map cannot help a company that has
 * no starting point.
 *
 * ── Why it reads the site rather than asking a model ───────────────────────
 *
 * The obvious build is to hand a model the company name and take what comes back. That
 * works for Blue Cross and invents a headquarters for everyone else: a language model
 * with no browser will produce a plausible city for a company it has never heard of, and
 * a plausible wrong address is worse than a blank one, because nobody checks a filled
 * field.
 *
 * So the source is the company's own homepage. The title and description are read from
 * the page, the address only from structured data the site publishes about itself, and
 * the logo from the tags the site already uses to tell Slack and Twitter what its logo is.
 * The model's only job is classification — turning fetched text into one of eighteen
 * labels — which is the one part of this a model is actually good at.
 *
 * Everything here is a parser over a string. Nothing in this file makes a request, so all
 * of it is testable without a network.
 */

import { INDUSTRIES } from './social-proof'

/** Mailbox providers, which say nothing about a company's own domain. */
const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'me.com',
  'aol.com',
  'msn.com',
  'comcast.net',
  'proton.me',
  'protonmail.com',
])

export function isFreeMailDomain(domain: string): boolean {
  return FREE_MAIL.has(domain.toLowerCase())
}

/**
 * The company's domain, from whatever the record already has.
 *
 * Costs nothing and fills a good share of the gap on its own: a company with three
 * contacts at the same employer has already told us its domain three times.
 */
export function deriveDomain(input: {
  name?: string | null
  domain?: string | null
  website?: string | null
  emails?: (string | null)[]
}): string | null {
  const fromField = normaliseDomain(input.domain)
  if (fromField) return fromField

  const fromSite = normaliseDomain(input.website)
  if (fromSite) return fromSite

  const counts = new Map<string, number>()
  for (const email of input.emails ?? []) {
    const domain = email?.split('@')[1]?.toLowerCase().trim()
    if (!domain || isFreeMailDomain(domain)) continue
    counts.set(domain, (counts.get(domain) ?? 0) + 1)
  }
  if (counts.size === 0) return null

  // ── Name beats majority ───────────────────────────────────────────────
  //
  // A company called Stratum had three people at tidewell.org and one at
  // stratumhealthsystem.org, and counting votes picked Tidewell — a different
  // organisation that happened to have more people on the thread.
  //
  // A domain carrying the company's own name is two signals agreeing, which beats one
  // signal repeated. Same rule the inbox sweep had to learn: a majority is not a
  // corroboration, it is the same weak signal counted twice.
  const key = nameKey(input.name)
  if (key) {
    const named = [...counts].filter(([domain]) => hostLabel(domain).includes(key))
    if (named.length > 0) {
      return named.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0]
    }
  }

  // Otherwise the most common work domain. One address is a coincidence — a contractor,
  // a personal account — and two is a fact.
  const best = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return best && best[1] >= 2 ? best[0] : null
}

/**
 * The company name reduced to something a hostname could contain.
 *
 * Nothing under three characters: "A-Speakers" would become "a" and match every domain
 * with an a in it, which is the same class of bug as the bureau names that became match
 * keys.
 */
function nameKey(name: string | null | undefined): string | null {
  const key = (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return key.length >= 3 ? key : null
}

/** `stratumhealthsystem.org` → `stratumhealthsystem`. */
function hostLabel(domain: string): string {
  return domain.split('.')[0]!.replace(/[^a-z0-9]/g, '')
}

/** `https://www.Acme.com/about?x=1` → `acme.com`. Returns null for anything unusable. */
export function normaliseDomain(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed) return null
  const host = trimmed
    .replace(/^[a-z]+:\/\//, '')
    .split('/')[0]!
    .split('?')[0]!
    .replace(/^www\./, '')
    .replace(/:\d+$/, '')
  // A domain has a dot and no spaces. "n/a" and "see email" both fail here, which is
  // the entire reason this is not a one-line regex replace.
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(host) ? host : null
}

export interface SiteFacts {
  domain: string
  title: string | null
  description: string | null
  /** Absolute URL of the best logo the page advertises about itself. */
  logo: string | null
  /** Only what the site publishes as structured data. Never inferred. */
  address: string | null
}

/**
 * What a homepage says about itself.
 *
 * Deliberately shallow: title, description, the image the site nominates for link
 * previews, and a postal address only where the site publishes one as JSON-LD. Scraping
 * a footer for something address-shaped is how you end up storing a cookie notice.
 */
export function parseSite(html: string, domain: string): SiteFacts {
  return {
    domain,
    title: clean(match(html, /<title[^>]*>([\s\S]*?)<\/title>/i)),
    description:
      clean(meta(html, 'og:description')) ??
      clean(meta(html, 'description')) ??
      clean(meta(html, 'twitter:description')),
    logo: absolute(
      meta(html, 'og:image') ??
        meta(html, 'twitter:image') ??
        link(html, 'apple-touch-icon') ??
        link(html, 'icon'),
      domain,
    ),
    address: parseAddress(html),
  }
}

/**
 * The postal address, from schema.org JSON-LD only.
 *
 * A site that publishes its address in structured data is asserting it. Anything else on
 * the page is a guess with extra confidence.
 *
 * It is *an* address the company publishes, not necessarily the headquarters: a site
 * served from a regional edge publishes the regional office, so stripe.com answers
 * Singapore from Asia and San Francisco from the States. Good enough to fill a blank
 * field, not good enough to be relabelled "HQ, verified" — which is why the runner
 * reports it as "address published" and writes it only where the field is empty.
 */
export function parseAddress(html: string): string | null {
  for (const block of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data: unknown
    try {
      data = JSON.parse(block[1]!.trim())
    } catch {
      // Malformed JSON-LD is extremely common and is not an error worth raising.
      continue
    }
    const found = findAddress(data)
    if (found) return found
  }
  return null
}

function findAddress(node: unknown, depth = 0): string | null {
  if (depth > 6 || node === null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findAddress(item, depth + 1)
      if (found) return found
    }
    return null
  }

  const obj = node as Record<string, unknown>
  const type = String(obj['@type'] ?? '')
  if (type === 'PostalAddress') {
    const parts = [
      obj.streetAddress,
      obj.addressLocality,
      obj.addressRegion,
      obj.postalCode,
      obj.addressCountry,
    ]
      .map((p) => (typeof p === 'string' ? p.trim() : typeof p === 'object' && p ? String((p as Record<string, unknown>).name ?? '') : ''))
      .filter(Boolean)
    return parts.length >= 2 ? parts.join(', ') : null
  }

  for (const value of Object.values(obj)) {
    const found = findAddress(value, depth + 1)
    if (found) return found
  }
  return null
}

/**
 * The label a classification may be written as.
 *
 * Anything outside the taxonomy is refused rather than coerced. Airtable's `typecast`
 * would happily *create* a nineteenth industry called "Insurance" and nobody would notice
 * until the social-proof engine started returning nothing for it.
 */
export function isKnownIndustry(label: string): boolean {
  return (INDUSTRIES as readonly string[]).includes(label.trim())
}

export interface Classification {
  industry: string | null
  confidence: number
  /** Why, in a clause. Kept with the proposal so a person can disagree with a reason. */
  because: string
}

/** Below this, the answer is "needs review" rather than a label. */
export const MIN_CONFIDENCE = 0.7

/**
 * The model's answer, made safe.
 *
 * Three ways to get nothing, all of them deliberate: an unknown label, a low confidence,
 * or a page that said nothing to classify. Nothing is worse than wrong here — a wrong
 * industry silently routes the wrong testimonials for the life of the account.
 */
export function acceptClassification(
  raw: { industry?: unknown; confidence?: unknown; because?: unknown },
  facts: SiteFacts,
): Classification {
  const label = typeof raw.industry === 'string' ? raw.industry.trim() : ''
  const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0
  const because = typeof raw.because === 'string' ? raw.because.trim() : ''

  if (!facts.title && !facts.description) {
    return { industry: null, confidence: 0, because: 'The homepage said nothing to read.' }
  }
  if (!isKnownIndustry(label)) {
    return {
      industry: null,
      confidence,
      because: label ? `"${label}" is not one of the eighteen industries.` : 'No label returned.',
    }
  }
  if (confidence < MIN_CONFIDENCE) {
    return { industry: null, confidence, because: because || 'Below the confidence floor.' }
  }
  return { industry: label, confidence, because }
}

/** The prompt. Kept beside the parser so the taxonomy cannot drift out of the prompt. */
export function classifyPrompt(facts: SiteFacts): string {
  return [
    'Classify this company into exactly one industry from the list.',
    '',
    `Domain: ${facts.domain}`,
    `Page title: ${facts.title ?? '(none)'}`,
    `Description: ${facts.description ?? '(none)'}`,
    '',
    'Industries:',
    ...INDUSTRIES.map((i) => `- ${i}`),
    '',
    'Reply as JSON: {"industry": "<exact label from the list>", "confidence": 0-1,',
    '"because": "<one clause quoting what on the page decided it>"}',
    '',
    'If the page does not say enough, return confidence below 0.7. Guessing from the',
    'company name alone is exactly what this is meant to avoid.',
  ].join('\n')
}

/**
 * The logo, without asking anybody.
 *
 * Falls back to the site's own favicon rather than a logo service: a third party that
 * resolves logos would also receive a list of every company Ben has ever spoken to.
 */
export function logoUrl(facts: Pick<SiteFacts, 'domain' | 'logo'>): string {
  return facts.logo ?? `https://${facts.domain}/favicon.ico`
}

function match(html: string, re: RegExp): string | null {
  return html.match(re)?.[1] ?? null
}

function meta(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (
    match(html, new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, 'i')) ??
    match(html, new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, 'i'))
  )
}

function link(html: string, rel: string): string | null {
  for (const tag of html.matchAll(/<link\b[^>]*>/gi)) {
    const text = tag[0]
    const rels = match(text, /rel=["']([^"']*)["']/i)
    if (!rels) continue
    if (!rels.toLowerCase().split(/\s+/).includes(rel)) continue
    const href = match(text, /href=["']([^"']*)["']/i)
    if (href) return href
  }
  return null
}

function absolute(href: string | null, domain: string): string | null {
  if (!href) return null
  const trimmed = href.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  return `https://${domain}${trimmed.startsWith('/') ? '' : '/'}${trimmed}`
}

function clean(text: string | null): string | null {
  if (!text) return null
  const out = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return out || null
}
