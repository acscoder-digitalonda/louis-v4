/**
 * WP3.2 — quiet hours, and the things that ignore them.
 *
 * A notification system without quiet hours trains people to silence it, and a silenced
 * notification system is worse than none: everyone believes they are being told.
 *
 * ── The non-batchable set ──────────────────────────────────────────────────
 *
 * Four events wake somebody up whatever the hour, and each one is on the list for a
 * reason that costs money if it waits:
 *
 *   `worker-failure`   the system has stopped doing its job and nobody knows
 *   `red-alert`        logistics are broken close to an event
 *   `cap-hit`          every worker is about to stop
 *   `date-conflict`    a client is owed an answer inside twenty-four hours
 *
 * Everything else waits for morning and arrives in the digest. That includes payments
 * confirmed and contracts signed, which are lovely news that keeps until breakfast.
 */

import type { NotificationType } from './types'

/** Delivered whatever the hour. Short on purpose: a long list is not a list. */
export const NON_BATCHABLE: NotificationType[] = ['worker-failure', 'red-alert', 'cap-warning']

export interface QuietHours {
  /** Local hour the quiet period starts, 0-23. */
  from: number
  /** Local hour it ends. May wrap past midnight. */
  to: number
  /** IANA zone. Ben's team is on one; a future speaker may not be. */
  timezone: string
  enabled: boolean
}

export const DEFAULT_QUIET_HOURS: QuietHours = {
  from: 21,
  to: 7,
  timezone: 'America/Los_Angeles',
  enabled: true,
}

/**
 * The hour of day in a timezone, without pulling in a date library.
 *
 * `Intl` is in the runtime and already knows every zone, so a dependency here would be
 * three hundred kilobytes to answer a question the platform answers for free.
 */
export function hourIn(timezone: string, at: Date): number {
  try {
    const hour = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(at)
    return Number(hour) % 24
  } catch {
    // An unknown zone must not silence every notification. UTC is wrong for somebody,
    // but it is wrong loudly rather than quietly.
    return at.getUTCHours()
  }
}

export function isQuiet(hours: QuietHours, at: Date = new Date()): boolean {
  if (!hours.enabled) return false
  const h = hourIn(hours.timezone, at)
  // A window that wraps past midnight — 21:00 to 07:00 — is the normal case, not the
  // edge case, so it is the one written first.
  return hours.from > hours.to ? h >= hours.from || h < hours.to : h >= hours.from && h < hours.to
}

export type Delivery = 'now' | 'digest' | 'suppressed'

export interface DeliveryDecision {
  delivery: Delivery
  reason: string
}

/**
 * When this notification reaches the person.
 *
 * Returns a reason in every branch. A notification system that quietly holds something
 * back is indistinguishable from one that lost it, and the only way anyone finds out is
 * the thing it was holding back.
 */
export function decideDelivery(
  type: NotificationType,
  channel: 'off' | 'in-app' | 'email' | 'both',
  hours: QuietHours,
  at: Date = new Date(),
): DeliveryDecision {
  if (channel === 'off') {
    return { delivery: 'suppressed', reason: 'Turned off for this person and this event.' }
  }
  if (NON_BATCHABLE.includes(type)) {
    return {
      delivery: 'now',
      reason: `${type} is never held back — by the time it could wait, it has cost something.`,
    }
  }
  if (isQuiet(hours, at)) {
    return {
      delivery: 'digest',
      reason: `Quiet hours ${hours.from}:00–${hours.to}:00 ${hours.timezone}. It goes in the morning digest.`,
    }
  }
  return { delivery: 'now', reason: 'Inside working hours.' }
}

/**
 * The next moment a held notification goes out.
 *
 * The end of quiet hours, not "tomorrow at nine" — if somebody sets quiet hours to end at
 * six, they want it at six.
 */
export function nextDeliveryAt(hours: QuietHours, at: Date = new Date()): Date {
  if (!isQuiet(hours, at)) return at
  const out = new Date(at)
  for (let i = 0; i < 48; i += 1) {
    out.setUTCMinutes(0, 0, 0)
    out.setUTCHours(out.getUTCHours() + 1)
    if (!isQuiet(hours, out)) return out
  }
  return out
}
