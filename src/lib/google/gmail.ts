/**
 * Gmail reads for the intake workers.
 *
 * Read-only by design: this module lists and fetches. Sending and drafting stay in
 * `mailer.ts`, so nothing here can put mail in front of a client by accident.
 *
 * `mailboxes()` is what makes multi-account intake possible — with a delegated service
 * account, one credential reads every address on the domain, and each is fetched under
 * its own impersonated token so Gmail's own permissions still apply per mailbox.
 */

import { accessToken, authMode, GMAIL_READ } from './auth'

const API = 'https://gmail.googleapis.com/gmail/v1'

/**
 * The mailboxes intake sweeps. Configurable because a second speaker on the same
 * deployment has different addresses, and hardcoding Ben's would make that a code change.
 */
export function mailboxes(): string[] {
  const raw = process.env.INTAKE_MAILBOXES ?? process.env.GMAIL_SERVICE_ADDRESS ?? ''
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

export interface GmailMessage {
  id: string
  threadId: string
  from: string
  to: string[]
  cc: string[]
  subject: string
  date: string
  snippet: string
  /** Plain-text body, decoded and stripped of quoted history. */
  body: string
  labelIds: string[]
}

export interface GmailThread {
  id: string
  /** Which mailbox this was read from — a thread can appear in more than one. */
  mailbox: string
  messages: GmailMessage[]
}

interface RawPart {
  mimeType?: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; size?: number }
  parts?: RawPart[]
}

interface RawMessage {
  id: string
  threadId: string
  snippet?: string
  labelIds?: string[]
  internalDate?: string
  payload?: RawPart
}

async function get<T>(path: string, mailbox: string): Promise<T> {
  const token = await accessToken([GMAIL_READ], mailbox)
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    throw new Error(`Gmail ${path} for ${mailbox} failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as T
}

function header(part: RawPart | undefined, name: string): string {
  const found = part?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())
  return found?.value ?? ''
}

function addresses(value: string): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((s) => {
      const angle = s.match(/<([^>]+)>/)
      return (angle ? angle[1]! : s).trim().toLowerCase()
    })
    .filter((s) => s.includes('@'))
}

function decode(data: string | undefined): string {
  if (!data) return ''
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

/** Depth-first walk for the first text/plain part; falls back to stripped HTML. */
function textFrom(part: RawPart | undefined): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data)
  if (part.parts) {
    for (const child of part.parts) {
      const found = textFrom(child)
      if (found) return found
    }
  }
  if (part.mimeType === 'text/html' && part.body?.data) {
    return decode(part.body.data)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
  }
  return ''
}

/**
 * Drops quoted history and signatures.
 *
 * Threads in this mailbox routinely quote the whole chain on every reply. Left in, the
 * same paragraph reaches the model once per message and the token bill scales with the
 * square of the thread length, for no added meaning.
 */
export function stripQuoted(body: string): string {
  const lines = body.split(/\r?\n/)
  const kept: string[] = []
  for (const line of lines) {
    if (/^\s*>/.test(line)) break
    if (/^\s*On .+ wrote:\s*$/.test(line)) break
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line)) break
    if (/^\s*From:\s.+@/.test(line) && kept.length > 0) break
    if (/^\s*(--|__)\s*$/.test(line)) break
    kept.push(line)
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** Message body capped: past a point, more text stops adding signal and only adds cost. */
const BODY_CHARS = 4000

function toMessage(raw: RawMessage): GmailMessage {
  const p = raw.payload
  const body = stripQuoted(textFrom(p)).slice(0, BODY_CHARS)
  return {
    id: raw.id,
    threadId: raw.threadId,
    from: addresses(header(p, 'From'))[0] ?? '',
    to: addresses(header(p, 'To')),
    cc: addresses(header(p, 'Cc')),
    subject: header(p, 'Subject'),
    date: raw.internalDate
      ? new Date(Number(raw.internalDate)).toISOString()
      : header(p, 'Date'),
    snippet: raw.snippet ?? '',
    body,
    labelIds: raw.labelIds ?? [],
  }
}

/**
 * A raw Gmail GET against one mailbox, impersonating it.
 *
 * Exported because F2 was doing this itself with a single token taken from the mailer —
 * one identity, `GMAIL_SERVICE_ADDRESS`, and the compose scope. With a delegated service
 * account that reads the same mailbox four times under four names, and with no service
 * address set it read nothing at all. Reading a mailbox means impersonating *that*
 * mailbox, which is what `get` has always done here.
 */
export async function gmailGetAs<T>(mailbox: string, path: string): Promise<T> {
  return get<T>(path, mailbox)
}

/** Thread IDs matching a Gmail query, newest first. */
export async function listThreadIds(
  mailbox: string,
  query: string,
  limit = 200,
): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({ q: query, maxResults: '100' })
    if (pageToken) params.set('pageToken', pageToken)
    const page = await get<{ threads?: { id: string }[]; nextPageToken?: string }>(
      `/users/me/threads?${params}`,
      mailbox,
    )
    for (const t of page.threads ?? []) ids.push(t.id)
    pageToken = page.nextPageToken
  } while (pageToken && ids.length < limit)

  return ids.slice(0, limit)
}

export async function getThread(mailbox: string, threadId: string): Promise<GmailThread> {
  const raw = await get<{ id: string; messages?: RawMessage[] }>(
    `/users/me/threads/${threadId}?format=full`,
    mailbox,
  )
  return {
    id: raw.id,
    mailbox,
    messages: (raw.messages ?? []).map(toMessage),
  }
}

/**
 * Sweeps every configured mailbox and returns threads, deduped across accounts on
 * thread ID — Liezel is CC'd on most of Ben's client mail, so the same conversation
 * turns up twice and must not be extracted twice.
 */
export class GmailNotConfigured extends Error {}

export async function sweep(query: string, perMailbox = 200): Promise<GmailThread[]> {
  // A sweep that finds nothing because it was never pointed at a mailbox looks exactly
  // like a sweep that found nothing because the inbox is quiet. Refuse instead: an empty
  // result has to mean an empty result.
  if (authMode() === 'none') {
    throw new GmailNotConfigured(
      'No Google credentials. Set GOOGLE_SERVICE_ACCOUNT_JSON (preferred) or ' +
        'GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GMAIL_REFRESH_TOKEN.',
    )
  }
  const boxes = mailboxes()
  if (boxes.length === 0) {
    throw new GmailNotConfigured(
      'No mailboxes to sweep. Set INTAKE_MAILBOXES to a comma-separated list, ' +
        'e.g. INTAKE_MAILBOXES=b@bennemtin.com,liezel@bennemtin.com,speaking@bennemtin.com',
    )
  }

  const out: GmailThread[] = []
  const seen = new Set<string>()

  for (const mailbox of boxes) {
    let ids: string[]
    try {
      ids = await listThreadIds(mailbox, query, perMailbox)
    } catch (err) {
      // One unreachable mailbox must not lose the others — a missing delegation grant
      // for one address is exactly the case this protects.
      console.warn(`[gmail] ${mailbox}: ${err instanceof Error ? err.message : err}`)
      continue
    }
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(await getThread(mailbox, id))
    }
  }

  return out
}
