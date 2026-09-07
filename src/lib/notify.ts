/**
 * Notifications — in-app bell + email fanout (Handoff §8).
 *
 * Three hard rules, encoded rather than remembered:
 *  1. Notification email is internal-only. `assertInternal` refuses any address
 *     outside the team domain, so a notification can never leak to a client.
 *  2. `worker-failure` always emails every admin immediately — not batchable,
 *     not mutable by a preference.
 *  3. Quiet hours hold the *email* and never the in-app record (WP3.2). Four event
 *     types ignore them entirely; everything else waits for morning.
 *
 * ── Why quiet hours hold the mail and not the notification ─────────────────
 *
 * The bell is silent by nature: a row in the notifications table wakes nobody, and
 * holding it back would mean somebody opening the app at 7am sees an empty bell for
 * something that happened at 2am. So the record is always written and only the email
 * waits. `heldUntil` says when it will go, which is what makes a held notification
 * different from a lost one.
 */

import { db } from './data'
import { ALWAYS_EMAIL, resolveChannel } from './rbac'
import type { NotificationType, Role, User } from './types'
import { speaker } from '~/speaker.config'
import { sendMail } from './mailer'
import { DEFAULT_QUIET_HOURS, decideDelivery, type QuietHours } from './quiet-hours'

export interface NotifyInput {
  type: NotificationType
  title: string
  body?: string | null
  link?: string | null
  /** Explicit recipients, else `roles` decides. */
  to?: string[]
  roles?: Role[]
  /** Injected by tests so quiet hours can be exercised without waiting for 9pm. */
  at?: Date
}

/**
 * The team's quiet hours.
 *
 * From settings when they are configured, from the speaker's timezone otherwise. A read
 * failure falls back to the default rather than throwing: a notification that cannot be
 * sent because the settings table was briefly unreachable is the worst possible failure
 * for this particular module.
 */
async function quietHoursFor(): Promise<QuietHours> {
  try {
    const settings = (await db().getSettings()) as unknown as Record<string, unknown>
    const configured = settings.quietHours as Partial<QuietHours> | undefined
    return { ...DEFAULT_QUIET_HOURS, timezone: speaker.timezone, ...(configured ?? {}) }
  } catch {
    return { ...DEFAULT_QUIET_HOURS, timezone: speaker.timezone }
  }
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

  const hours = await quietHoursFor()
  const now = input.at ?? new Date()

  for (const user of targets) {
    if (!isInternal(user.email)) continue
    const channel = resolveChannel(user, input.type)
    if (channel === 'off' && !ALWAYS_EMAIL.includes(input.type)) continue

    const decision = decideDelivery(input.type, channel, hours, now)
    const wantsEmail =
      channel === 'email' || channel === 'both' || (ALWAYS_EMAIL.includes(input.type) && user.role === 'admin')

    // A worker failure reaches an admin whatever the hour, because a system that has
    // stopped and told nobody is the thing every other rule here exists to prevent.
    const overridesQuiet = ALWAYS_EMAIL.includes(input.type) && user.role === 'admin'
    const held = decision.delivery === 'digest' && !overridesQuiet

    let emailed = false
    if (wantsEmail && !held) {
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
      // The in-app record always lands, so a 7am bell is not empty for something that
      // happened at 2am. Only the email waits.
      title: held ? `${input.title} (held until ${hours.to}:00)` : input.title,
      body: input.body ?? null,
      link: input.link ?? null,
      read: false,
      createdAt: now.toISOString(),
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
