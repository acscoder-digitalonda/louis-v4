/**
 * Notifications — in-app bell + email fanout (Handoff §8).
 *
 * Two hard rules, encoded rather than remembered:
 *  1. Notification email is internal-only. `assertInternal` refuses any address
 *     outside the team domain, so a notification can never leak to a client.
 *  2. `worker-failure` always emails every admin immediately — not batchable,
 *     not mutable by a preference.
 */

import { db } from './data'
import { ALWAYS_EMAIL, resolveChannel } from './rbac'
import type { NotificationType, Role, User } from './types'
import { speaker } from '~/speaker.config'
import { sendMail } from './mailer'

export interface NotifyInput {
  type: NotificationType
  title: string
  body?: string | null
  link?: string | null
  /** Explicit recipients, else `roles` decides. */
  to?: string[]
  roles?: Role[]
}

function isInternal(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  if (!domain) return false
  if (domain === speaker.teamDomain.toLowerCase()) return true
  const extra = (process.env.INTERNAL_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
  return extra.includes(domain)
}

export function assertInternal(email: string): void {
  if (!isInternal(email)) {
    throw new Error(
      `Refusing to send a notification to ${email}: notifications are internal-only. ` +
        'Client-facing mail is exclusively human-sent drafts.',
    )
  }
}

async function recipients(input: NotifyInput): Promise<User[]> {
  const users = (await db().listUsers()).filter((u) => u.active)
  if (input.to?.length) {
    const wanted = new Set(input.to.map((e) => e.toLowerCase()))
    return users.filter((u) => wanted.has(u.email.toLowerCase()))
  }
  if (input.roles?.length) {
    return users.filter((u) => input.roles!.includes(u.role))
  }
  // Default audience: everyone who works the system.
  return users.filter((u) => u.role !== 'accountant')
}

export async function notify(input: NotifyInput): Promise<number> {
  const provider = db()
  const targets = await recipients(input)
  let sent = 0

  for (const user of targets) {
    if (!isInternal(user.email)) continue
    const channel = resolveChannel(user, input.type)
    if (channel === 'off' && !ALWAYS_EMAIL.includes(input.type)) continue

    const wantsEmail =
      channel === 'email' || channel === 'both' || (ALWAYS_EMAIL.includes(input.type) && user.role === 'admin')

    let emailed = false
    if (wantsEmail) {
      try {
        await sendMail({
          to: user.email,
          subject: `[${speaker.wordmark}] ${input.title}`,
          text: buildEmailBody(input),
        })
        emailed = true
      } catch (err) {
        // A failed notification email must never take down the worker that raised it.
        console.error('[notify] email failed', user.email, err)
      }
    }

    await provider.createNotification({
      user: user.email,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      read: false,
      createdAt: new Date().toISOString(),
      emailed,
    })
    sent += 1
  }
  return sent
}

function buildEmailBody(input: NotifyInput): string {
  const url = input.link ? `${process.env.NEXTAUTH_URL ?? ''}${input.link}` : null
  return [input.title, '', input.body ?? '', url ? `\nOpen: ${url}` : '']
    .filter((line) => line !== undefined)
    .join('\n')
    .trim()
}

/**
 * The failure path every worker uses. Includes the log tail and the worker name,
 * because "something broke" is not actionable.
 */
export async function notifyWorkerFailure(params: {
  worker: string
  error: unknown
  logTail?: string
  link?: string
}): Promise<void> {
  const message = params.error instanceof Error ? params.error.message : String(params.error)
  const stack = params.error instanceof Error ? params.error.stack : undefined
  await notify({
    type: 'worker-failure',
    title: `${params.worker} failed`,
    body: [message, params.logTail, stack].filter(Boolean).join('\n\n').slice(0, 4000),
    link: params.link ?? '/settings?tab=ai',
    roles: ['admin'],
  })
}
