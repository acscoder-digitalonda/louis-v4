/**
 * F2 — EMAIL INTAKE WORKER.
 *
 * Every 15 minutes: read new mail on the watched Gmail label → store an Email record
 * (metadata + a body reference; the raw message is never edited) → Haiku classifies it
 * (inquiry / update / noise) → for inquiries, create or attach a Deal; for updates,
 * Sonnet extracts fields and hands them to F4, which decides silent-write vs proposal.
 *
 * Mail from a Key Agent forwards to Ben immediately and notifies — the flag lives on the
 * Contact record, never in this file.
 */

import { db } from '@/lib/data'
import { dedupe, dedupeKey, queryFor, resolveAccounts } from '@/lib/intake/accounts'
import { complete } from '@/lib/gateway'
import { sendMail } from '@/lib/mailer'
import { gmailGetAs } from '@/lib/google/gmail'
import { googleConfigured } from '@/lib/google/auth'
import { isFreeMailDomain } from '@/lib/enrichment'
import { notify } from '@/lib/notify'
import { agentActor, recordEvent } from '@/lib/audit'
import { invalidateSearchCache } from '@/lib/search'
import { applyExtractions, EXTRACTABLE_FIELDS, type Extraction } from './f4-change-handler'
import { firePacket } from './f5-stage-engine'
import { runResearch } from './f3-research'
import { parseJson } from './f7-drafts'
import { speaker } from '~/speaker.config'
import type { Deal, EmailRecord } from '@/lib/types'
import { isLive } from '@/lib/stages'

const WORKER = 'F2'
const LABEL = process.env.GMAIL_WATCH_LABEL ?? 'louis-intake'
const MAX_PER_RUN = Number(process.env.EMAIL_INTAKE_BATCH ?? 25)

/**
 * How long one sweep may take before it stops and leaves the rest for the next run.
 *
 * The serverless function is killed at 300 seconds, and a kill loses the report: the
 * emails already written stay written, but nothing says how far it got or what is left.
 * Four mailboxes at twenty-five messages is a hundred classifications, and the first run
 * after a backlog will always be the slow one.
 *
 * So the sweep is time-boxed below the kill. It drains a backlog across runs — which,
 * every fifteen minutes, is fast enough — and every run returns a real report.
 */
const RUN_BUDGET_MS = Number(process.env.EMAIL_INTAKE_BUDGET_MS ?? 210_000)

export interface IntakeReport {
  fetched: number
  /** Copies of a message already seen in another mailbox or an earlier sweep. */
  duplicates: number
  inquiries: number
  updates: number
  noise: number
  forwarded: number
  errors: number
  /** Left for the next run because this one spent its time budget. */
  deferred: number
}

interface RawMessage {
  id: string
  threadId: string
  from: string
  to: string
  subject: string
  date: string
  body: string
  /** Which mailbox this copy came from. */
  mailbox?: string
  /** Raw headers, kept so the dedupe key can find Message-ID. */
  headers?: { name: string; value: string }[]
}

export async function run(): Promise<IntakeReport> {
  const report: IntakeReport = {
    fetched: 0,
    duplicates: 0,
    inquiries: 0,
    updates: 0,
    noise: 0,
    forwarded: 0,
    errors: 0,
    deferred: 0,
  }
  const provider = db()
  const startedAt = Date.now()

  const messages = await fetchMessages()
  if (messages.length === 0) return report

  // Deduped on the RFC Message-ID, not the Gmail id. Gmail ids are per mailbox, so the
  // same email in Ben's inbox and Liezel's has two of them — and deduping on those makes
  // two records of one email, two classifications, and eventually two deals.
  const seen = await provider.listEmails()
  const known = new Set(seen.map((e) => e.messageId ?? e.id).filter(Boolean))
  const { fresh, duplicates } = dedupe(messages, known as Set<string>)
  report.duplicates = duplicates
  if (duplicates > 0) {
    console.info(`[F2] ${duplicates} message(s) already seen in another mailbox`)
  }

  const contacts = await provider.listContacts()

  for (const message of fresh) {
    if (Date.now() - startedAt > RUN_BUDGET_MS) {
      report.deferred = fresh.length - report.fetched
      console.info(`[F2] budget spent — ${report.deferred} message(s) left for the next run`)
      break
    }
    try {
      report.fetched += 1

      const sender = extractAddress(message.from)
      const contact = contacts.find((c) => c.email?.toLowerCase() === sender)

      const classification = await classify(message)
      const email = await provider.createEmail({
        dealId: null,
        from: sender,
        to: message.to,
        subject: message.subject,
        threadId: message.threadId,
        messageId: dedupeKey(message),
        mailbox: message.mailbox ?? null,
        receivedAt: message.date,
        bodyRef: null,
        classification,
        extractionStatus: 'pending',
      })

      // Key agents jump the queue: forward and notify before anything else.
      if (contact?.keyAgent) {
        await forwardToOwner(message)
        report.forwarded += 1
      }

      if (classification === 'noise') {
        report.noise += 1
        await provider.updateEmail(email.id, { extractionStatus: 'extracted' })
        continue
      }

      const deal = await attachDeal(message, email, contact?.clientId ?? null)
      if (!deal) {
        await provider.updateEmail(email.id, { extractionStatus: 'error' })
        continue
      }
      await provider.updateEmail(email.id, { dealId: deal.id })

      if (classification === 'inquiry') report.inquiries += 1
      else report.updates += 1

      const extractions = await extract(message, deal)
      if (extractions.length > 0) {
        await applyExtractions({ deal, extractions, sourceEmailId: email.id })
      }
      await provider.updateEmail(email.id, { extractionStatus: 'extracted' })
    } catch (err) {
      report.errors += 1
      console.error('[F2] message failed', err)
    }
  }

  invalidateSearchCache()
  console.info(`[${WORKER}]`, report)
  return report
}

// ── classification & extraction ─────────────────────────────────────────────

async function classify(message: RawMessage): Promise<EmailRecord['classification']> {
  const result = await complete({
    worker: WORKER,
    task: 'classify',
    json: true,
    system: `You triage inbound mail for a keynote speaker's operations inbox.`,
    input: [
      'Classify this message as exactly one of: inquiry, update, noise.',
      'inquiry = someone asking about booking a keynote for the first time.',
      'update = anything about an engagement already in motion (logistics, contracts, dates, questions).',
      'noise = newsletters, spam, automated receipts, anything with no operational content.',
      '',
      `From: ${message.from}`,
      `Subject: ${message.subject}`,
      `Body:\n${message.body.slice(0, 4000)}`,
      '',
      'Return {"classification": "inquiry"|"update"|"noise"}.',
    ].join('\n'),
  })
  const parsed = parseJson<{ classification?: string }>(result.text)
  const value = parsed?.classification
  return value === 'inquiry' || value === 'update' || value === 'noise' ? value : 'unclassified'
}

async function extract(message: RawMessage, deal: Deal): Promise<Extraction[]> {
  const result = await complete({
    worker: WORKER,
    task: 'extract',
    dealId: deal.id,
    json: true,
    system:
      'You extract structured facts from email. You never guess. If a value is not stated plainly, you omit it.',
    input: [
      'Extract any of these fields that the message states explicitly:',
      EXTRACTABLE_FIELDS.join(', '),
      '',
      'Dates are ISO (YYYY-MM-DD). Times stay as written, including the timezone.',
      'Fees are plain numbers with no currency symbol.',
      '',
      `Current record: ${JSON.stringify(pickFields(deal))}`,
      `Subject: ${message.subject}`,
      `Body:\n${message.body.slice(0, 6000)}`,
      '',
      'Return {"extractions":[{"field":"...","value":"...","confidence":0-1}]}. Omit anything uncertain.',
    ].join('\n'),
  })

  const parsed = parseJson<{ extractions?: Extraction[] }>(result.text)
  if (!parsed?.extractions) return []
  return parsed.extractions.filter(
    (e) =>
      e &&
      typeof e.field === 'string' &&
      (EXTRACTABLE_FIELDS as readonly string[]).includes(e.field) &&
      e.value !== null &&
      e.value !== undefined &&
      String(e.value).trim() !== '',
  )
}

function pickFields(deal: Deal): Record<string, unknown> {
  const out: Record<string, unknown> = { name: deal.name, stage: deal.stage }
  for (const field of EXTRACTABLE_FIELDS) out[field] = deal[field]
  return out
}

// ── deal matching ───────────────────────────────────────────────────────────

async function attachDeal(
  message: RawMessage,
  email: EmailRecord,
  clientId: string | null,
): Promise<Deal | null> {
  const provider = db()
  const deals = await provider.listDeals()

  // 1. Same thread as an email we already filed.
  const sameThread = (await provider.listEmails()).find(
    (e) => e.threadId && e.threadId === message.threadId && e.dealId,
  )
  if (sameThread?.dealId) {
    return deals.find((d) => d.id === sameThread.dealId) ?? null
  }

  // 2. The sender's company has exactly one live deal.
  if (clientId) {
    const live = deals.filter(
      (d) => d.client?.id === clientId && isLive(d),
    )
    if (live.length === 1) return live[0]!
  }

  // 3. An inquiry with no match starts a new deal.
  if (email.classification !== 'inquiry') return null

  const domain = email.from.split('@')[1]?.toLowerCase() ?? null

  // ── What a domain is allowed to become a company ────────────────────────
  //
  // The first live sweep created companies called "gmail" and "bennemtin": one from a
  // prospect writing on a personal address, the other from our own team forwarding an
  // enquiry inwards. Both are the same mistake — treating the envelope sender as the
  // organisation — and a fake company in the CRM is worse than a blank one, because the
  // social-proof engine, the repeat-client rollups and every export all key on it.
  //
  // So a company is created only from a domain that could be one. Otherwise the deal is
  // created without a client and a person places it from the queue, which is exactly the
  // judgement the review queue exists for.
  const companyDomain =
    domain && !isFreeMailDomain(domain) && domain !== speaker.teamDomain.toLowerCase()
      ? domain
      : null

  const clients = await provider.listClients()
  let client = clientId
    ? clients.find((c) => c.id === clientId)
    : companyDomain
      ? clients.find((c) => c.domain?.toLowerCase() === companyDomain)
      : undefined

  if (!client && companyDomain) {
    client = await provider.createClient({
      name: companyDomain.replace(/\.(com|org|net|io|co)$/i, ''),
      domain: companyDomain,
      notes: 'Created from inbound email.',
    })
  }

  const deal = await provider.createDeal({
    // Without a company the subject is the only honest label. "gmail — Book Ben" reads
    // like a company called gmail; "Book Ben - Dawn Jacobson" reads like what it is.
    name: (client ? `${client.name} — ${message.subject}` : message.subject).slice(0, 180),
    stage: 'inquiry',
    source: 'direct',
    client: client ? { id: client.id, name: client.name } : null,
    listFee: speaker.fees.defaultList,
    owner: process.env.OPS_EMAIL ?? null,
  })

  await recordEvent({
    table: 'deals',
    recordId: deal.id,
    what: 'Created from inbound email',
    detail: `${email.from} — ${message.subject}`,
    actor: agentActor(WORKER),
    source: email.id,
  })

  await firePacket(deal, { source: `email:${email.id}` })
  void runResearch(deal).catch((err) => console.error('[F2] research kickoff failed', err))
  return deal
}

async function forwardToOwner(message: RawMessage): Promise<void> {
  const owner = process.env.OWNER_EMAIL
  if (!owner) return
  await sendMail({
    to: owner,
    subject: `[key agent] ${message.subject}`,
    text: `From: ${message.from}\n\n${message.body.slice(0, 8000)}`,
  })
  await notify({
    type: 'mention',
    title: `Key agent mail forwarded — ${message.from}`,
    body: message.subject,
    link: '/crm?view=bureau',
    to: [owner],
  })
}

// ── Gmail ───────────────────────────────────────────────────────────────────

/**
 * Every configured mailbox, in the order the Mail Accounts table lists them (WP1.6).
 *
 * One account failing does not cost the others their sweep: a revoked delegation on Ben's
 * mailbox must not stop Liezel's mail being read.
 */
async function fetchMessages(): Promise<RawMessage[]> {
  // `googleConfigured`, not `GMAIL_REFRESH_TOKEN`. The refresh token is the old
  // single-user credential; this deployment authenticates with a delegated service
  // account, so the original check skipped every sweep and logged a warning nobody reads.
  if (!googleConfigured()) {
    console.warn('[F2] Gmail is not configured — intake skipped.')
    return []
  }

  // The Mail Accounts table is the source of truth; the env var is the fallback for an
  // install that has not filled it in.
  const accounts = resolveAccounts(await db().listMailAccounts().catch(() => []), {
    addresses: process.env.GMAIL_ADDRESSES ?? process.env.INTAKE_MAILBOXES,
    label: LABEL,
  })
  if (accounts.length === 0) {
    console.warn('[F2] No mail accounts configured — intake skipped.')
    return []
  }

  const out: RawMessage[] = []

  for (const account of accounts) {
    try {
      // Impersonating this mailbox, with the read scope. One shared token would read
      // whichever single mailbox it belonged to, four times over.
      const list = await gmailGetAs<{ messages?: { id: string }[] }>(
        account.address,
        `/users/me/messages?q=${encodeURIComponent(queryFor(account))}&maxResults=${MAX_PER_RUN}`,
      )
      for (const item of list.messages ?? []) {
        const full = await gmailGetAs<GmailMessage>(
          account.address,
          `/users/me/messages/${item.id}?format=full`,
        )
        out.push({ ...parseMessage(full), mailbox: account.address })
      }
    } catch (err) {
      // A revoked delegation on one mailbox must not stop the others being read.
      console.error(`[F2] ${account.address} could not be swept`, err)
    }
  }
  return out
}

interface GmailPart {
  mimeType?: string
  body?: { data?: string }
  parts?: GmailPart[]
}

interface GmailMessage {
  id: string
  threadId: string
  internalDate?: string
  payload?: GmailPart & { headers?: { name: string; value: string }[] }
}

function parseMessage(message: GmailMessage): RawMessage {
  const headers = message.payload?.headers ?? []
  const header = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
  return {
    id: message.id,
    threadId: message.threadId,
    headers,
    from: header('from'),
    to: header('to'),
    subject: header('subject'),
    date: message.internalDate
      ? new Date(Number(message.internalDate)).toISOString()
      : new Date().toISOString(),
    body: extractBody(message.payload),
  }
}

function extractBody(part: GmailPart | undefined): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data)
  for (const child of part.parts ?? []) {
    const found = extractBody(child)
    if (found) return found
  }
  if (part.body?.data) return decode(part.body.data)
  return ''
}

function decode(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

function extractAddress(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return (match?.[1] ?? from).trim().toLowerCase()
}

