/**
 * Outbound mail.
 *
 * Two transports:
 *  - `gmail` — the service address, via the Gmail API with a refresh token. Used for
 *    internal notification mail, and for *creating drafts* (never sending) on the
 *    client-facing side.
 *  - `console` — the default when no credentials exist. Prints and returns; nothing
 *    leaves the machine.
 *
 * Client-facing mail is never sent by this module. `createGmailDraft` puts a draft in
 * the mailbox for a human to press send on, which is the whole point of the design.
 */

import { accessToken as googleAccessToken, GMAIL_COMPOSE, googleConfigured } from './google/auth'

export interface MailInput {
  to: string
  subject: string
  text: string
}

export type Transport = 'gmail' | 'console'

export function transport(): Transport {
  // Either credential shape will do — a delegated service account or the original
  // single-user refresh token. Both resolve through lib/google/auth.
  return googleConfigured() && !!process.env.GMAIL_SERVICE_ADDRESS ? 'gmail' : 'console'
}

/**
 * Sends. Actually sends — `/messages/send`, not `/drafts`.
 *
 * Returns what Gmail returns so a draft record can keep the thread. The console transport
 * returns a synthetic id and no thread, and says so in the id.
 */
export async function sendMail(input: MailInput): Promise<{ id: string; threadId: string | null }> {
  if (transport() === 'console') {
    console.info(`[mailer:console] → ${input.to}\n  ${input.subject}\n${indent(input.text)}`)
    return { id: `console-send-${Date.now()}`, threadId: null }
  }
  const raw = encodeMessage({ ...input, from: process.env.GMAIL_SERVICE_ADDRESS! })
  const res = await gmailRequest<{ id: string; threadId?: string }>('/messages/send', { raw })
  return { id: res.id, threadId: res.threadId ?? null }
}

/**
 * Creates a Gmail draft. This is the only path client-facing copy takes out of the
 * system, and it stops at "draft" by design (F7: human edits/sends).
 */
export async function createGmailDraft(input: MailInput): Promise<{ id: string; threadId: string | null }> {
  if (transport() === 'console') {
    console.info(`[mailer:console] draft → ${input.to}\n  ${input.subject}\n${indent(input.text)}`)
    return { id: `console-draft-${Date.now()}`, threadId: null }
  }
  const raw = encodeMessage({ ...input, from: process.env.GMAIL_SERVICE_ADDRESS! })
  const res = await gmailRequest<{ id: string; message?: { threadId?: string } }>('/drafts', {
    message: { raw },
  })
  return { id: res.id, threadId: res.message?.threadId ?? null }
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((l) => `  | ${l}`)
    .join('\n')
}

/**
 * A header value Gmail will show as written.
 *
 * Headers are ASCII. A subject with an em dash in it — which is most of this product's
 * subjects — went out as raw UTF-8 bytes, and every mail client read them as Latin-1:
 * "No reply yet Ã¢Â€Â" Book Ben". RFC 2047 is the envelope: base64 the value and mark
 * it UTF-8. Pure-ASCII values are left alone so nothing else changes.
 */
export function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7f]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`
}

function encodeMessage(input: MailInput & { from: string }): string {
  const lines = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${encodeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.text,
  ]
  return Buffer.from(lines.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Acts as the service address. With a delegated service account that means impersonating
 * it; with a refresh token it is simply whose token it is.
 */
async function accessToken(): Promise<string> {
  return googleAccessToken([GMAIL_COMPOSE], process.env.GMAIL_SERVICE_ADDRESS)
}

async function gmailRequest<T = unknown>(path: string, body: unknown): Promise<T> {
  const token = await accessToken()
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Gmail ${path} failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as T
}

export { accessToken as gmailAccessToken }
