/**
 * WP1.4 — FULFILLMENT. Getting the journals into the room.
 *
 * Decisions Log §2. One record per *physical* line item, created when the line item is
 * added, and **open until Delivered**. That last part is the design: v3 tracked journal
 * orders as a status on a sidecar record that nobody looked at once the keynote was
 * booked, and the failure mode was always the same — 2,000 journals that needed to ship
 * five weeks out, remembered four weeks out.
 *
 * Money stays on the line item. This holds none, which is what lets it be a checklist a
 * warehouse can work from rather than a thing only finance may touch.
 *
 * ── Why the status list is eleven steps long ───────────────────────────────
 *
 * Because each one is a thing a person actually does, and the gaps between them are where
 * orders die. "Interested" with no quote sent for three weeks is a different problem from
 * "Ordered" with the warehouse never told, and a shorter list would hide both.
 */

import type { Deal, Fulfillment, FulfillmentStatus, Product } from './types'

export const FULFILLMENT_FLOW: FulfillmentStatus[] = [
  'Mentioned',
  'Promo Sent',
  'Promo Received',
  'Interested',
  'Quote Sent',
  'Ordered',
  'Warehouse Notified',
  'Shipped',
  'Delivered',
  'Dropship Pending',
  'Dropship Complete',
]

/** Everything before Delivered is open work. */
export const CLOSED_STATUSES: FulfillmentStatus[] = ['Delivered', 'Dropship Complete']

export function isOpen(record: Pick<Fulfillment, 'status'>): boolean {
  return !CLOSED_STATUSES.includes(record.status)
}

export function stepIndex(status: FulfillmentStatus): number {
  return FULFILLMENT_FLOW.indexOf(status)
}

/** Only physical products get a record. A workshop has nothing to ship. */
export function needsFulfillment(product: Pick<Product, 'physical'>): boolean {
  return product.physical
}

/**
 * Lead time before the event, by quantity.
 *
 * The warehouse needs two days minimum, and more for a big run. Bulk orders want to land
 * about a month out so the client is not opening boxes the morning of. These are the
 * numbers from the v3 canonical doc, kept here rather than in a timer so that changing
 * one is a change to a table of numbers and not to a scheduling rule.
 */
export function leadDays(quantity: number | null): number {
  if (!quantity || quantity <= 0) return 30
  if (quantity > 1_000) return 45
  if (quantity > 200) return 35
  return 30
}

/** The date this has to leave the warehouse by. */
export function shipBy(deal: Pick<Deal, 'eventDate'>, quantity: number | null): string | null {
  if (!deal.eventDate) return null
  const d = new Date(`${deal.eventDate.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - leadDays(quantity))
  return d.toISOString().slice(0, 10)
}

export type NudgeKind = 'promo-no-order' | 'quote-no-order' | 'ordered-not-notified' | 'ship-by-close'

export interface Nudge {
  kind: NudgeKind
  severity: 'red' | 'amber'
  message: string
}

/**
 * What is going wrong with this record today.
 *
 * Returns every applicable nudge rather than the first, because "the ship-by date is in
 * nine days" and "the warehouse has never been told" are both true at once and the second
 * is the reason for the first.
 *
 * Red is for a state that will miss the date if nobody moves. Amber is a reminder.
 */
export function nudgesFor(
  record: Pick<Fulfillment, 'status' | 'shipBy' | 'quantity'>,
  today: string,
): Nudge[] {
  if (!isOpen(record)) return []
  const out: Nudge[] = []
  const daysToShip = record.shipBy
    ? Math.round(
        (new Date(`${record.shipBy}T00:00:00Z`).getTime() -
          new Date(`${today}T00:00:00Z`).getTime()) /
          86_400_000,
      )
    : null

  if (record.status === 'Ordered') {
    // The order exists and the warehouse does not know. This is the one that loses runs.
    out.push({
      kind: 'ordered-not-notified',
      severity: 'red',
      message: 'Ordered, but the warehouse has not been notified.',
    })
  }

  if (daysToShip !== null && daysToShip <= 14 && stepIndex(record.status) < stepIndex('Shipped')) {
    out.push({
      kind: 'ship-by-close',
      severity: daysToShip <= 7 ? 'red' : 'amber',
      message:
        daysToShip < 0
          ? `Ship-by was ${Math.abs(daysToShip)} days ago and nothing has shipped.`
          : `Ship-by is in ${daysToShip} days and the status is still ${record.status}.`,
    })
  }

  if (record.status === 'Promo Received' || record.status === 'Promo Sent') {
    out.push({
      kind: 'promo-no-order',
      severity: 'amber',
      message: 'The promo went out and no interest has been recorded either way.',
    })
  }

  if (record.status === 'Quote Sent') {
    out.push({
      kind: 'quote-no-order',
      severity: 'amber',
      message: 'A quote is out with no order against it.',
    })
  }

  return out
}

/** Records that belong in today's digest: anything open with a red or a close ship-by. */
export function digestFor(records: (Fulfillment & { dealName?: string })[], today: string) {
  return records
    .filter(isOpen)
    .map((r) => ({ record: r, nudges: nudgesFor(r, today) }))
    .filter((x) => x.nudges.length > 0)
    .sort(
      (a, b) =>
        Number(b.nudges.some((n) => n.severity === 'red')) -
          Number(a.nudges.some((n) => n.severity === 'red')) ||
        (a.record.shipBy ?? '9999').localeCompare(b.record.shipBy ?? '9999'),
    )
}
