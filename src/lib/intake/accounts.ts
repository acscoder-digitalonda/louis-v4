/**
 * WP1.6 — which mailboxes are swept, how much of each, and how far back.
 *
 * Decisions Log §6: the scope is a Settings value, not a deploy. OAuth is already granted
 * at full-mailbox read scope, so switching between "everything" and "one label" takes
 * effect on the next sweep and never triggers a re-consent.
 *
 * ── The dedupe key is not the Gmail id ─────────────────────────────────────
 *
 * Gmail message ids are **per mailbox**. The same email sitting in Ben's inbox and
 * Liezel's has two different ids, so deduping on it produces two records of one email,
 * two classifications, and eventually two deals for one inquiry.
 *
 * The RFC 5322 `Message-ID` header is assigned once by the sending server and travels
 * with the message everywhere, which is why the spec asks for it by name. Where a message
 * genuinely has none — some bulk senders omit it, in violation of the RFC — the fallback
 * is the thread id plus the sender plus the timestamp, which is stable across mailboxes
 * for the same reason a Message-ID would have been.
 */

import type { MailAccount } from '../types'

export type MailScope = 'full' | 'label'

export interface ResolvedAccount {
  address: string
  label: string
  scope: MailScope
  watchedLabel: string | null
  lookbackDays: number
  active: boolean
}

export const DEFAULT_LOOKBACK_DAYS = 2
export const DEFAULT_WATCHED_LABEL = 'louis'

/**
 * The accounts to sweep.
 *
 * From the Mail Accounts table when it has rows, from the environment when it does not,
 * so a fresh install sweeps something rather than nothing. An install that has never been
 * configured and an install someone deliberately emptied look identical from here, so the
 * fallback is deliberately narrow: one address, watched-label only.
 */
export function resolveAccounts(
  rows: MailAccount[],
  env: { addresses?: string; label?: string } = {},
): ResolvedAccount[] {
  const configured = rows
    .filter((r) => r.active && r.address)
    .map((r) => ({
      address: r.address.trim().toLowerCase(),
      label: r.label || r.address,
      scope: (r.scope === 'Full mailbox' ? 'full' : 'label') as MailScope,
      watchedLabel: r.watchedLabel?.trim() || DEFAULT_WATCHED_LABEL,
      lookbackDays: r.lookbackDays && r.lookbackDays > 0 ? r.lookbackDays : DEFAULT_LOOKBACK_DAYS,
      active: true,
    }))

  if (configured.length > 0) return configured

  return (env.addresses ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .map((address) => ({
      address,
      label: address,
      // Watched-label, not full: an unconfigured install reading every message in
      // somebody's mailbox is a surprise nobody asked for.
      scope: 'label' as MailScope,
      watchedLabel: env.label || DEFAULT_WATCHED_LABEL,
      lookbackDays: DEFAULT_LOOKBACK_DAYS,
      active: true,
    }))
}

/**
 * The Gmail search query for one account.
 *
 * `newer_than` rather than an absolute date: a sweep that has not run for a week should
 * still catch the week, and an absolute date computed at deploy time goes stale silently.
 *
 * Chat, spam and trash are excluded everywhere. A sweep that reads spam will eventually
 * classify a phishing mail as an inquiry and put a fake company in the pipeline.
 */
export function queryFor(account: ResolvedAccount): string {
  const parts = [`newer_than:${account.lookbackDays}d`, '-in:chats', '-in:spam', '-in:trash']
  if (account.scope === 'label' && account.watchedLabel) {
    parts.unshift(`label:${account.watchedLabel}`)
  }
  return parts.join(' ')
}

/** How far back a historical backfill should reach, in Gmail's own syntax. */
export function backfillQuery(account: ResolvedAccount, since: string): string {
  const base = queryFor(account).replace(/newer_than:\d+d\s*/, '')
  return `after:${since.slice(0, 10).replace(/-/g, '/')} ${base}`.trim()
}

export interface MessageLike {
  /** The per-mailbox Gmail id. Not a dedupe key. */
  id: string
  threadId: string
  from: string
  date: string
  headers?: { name: string; value: string }[]
}

/**
 * The key that identifies one email across every mailbox it landed in.
 *
 * Normalised: some servers wrap it in angle brackets and some do not, and a key that
 * differs by punctuation is not a key.
 */
export function dedupeKey(message: MessageLike): string {
  const header = message.headers?.find((h) => h.name.toLowerCase() === 'message-id')?.value
  if (header?.trim()) return header.trim().replace(/^<|>$/g, '').toLowerCase()
  // No Message-ID, which is against the RFC but happens with bulk senders. The thread,
  // sender and timestamp together are stable across mailboxes for the same reason.
  return `fallback:${message.threadId}:${message.from.toLowerCase()}:${message.date}`
}

export interface DedupeResult<T> {
  fresh: T[]
  /** Messages dropped because the same email arrived in another mailbox. */
  duplicates: number
}

/**
 * Drops messages already seen, in this sweep or a previous one.
 *
 * The first copy wins, so which mailbox a message is filed under is decided by whichever
 * account is swept first — which is why `resolveAccounts` preserves the table's order
 * rather than sorting. Liezel's account is listed first because she files things.
 */
export function dedupe<T extends MessageLike>(messages: T[], known: Set<string>): DedupeResult<T> {
  const fresh: T[] = []
  const seen = new Set(known)
  let duplicates = 0

  for (const message of messages) {
    const key = dedupeKey(message)
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    seen.add(key)
    fresh.push(message)
  }

  return { fresh, duplicates }
}
