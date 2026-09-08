/**
 * F14 — the one-hour reply.
 *
 * The only service promise with a number on it. This sweep is what makes it real: it
 * finds inquiries that have gone an hour of working time without a reply and says so,
 * once, while there is still a booking to win.
 *
 * ── Why it is hourly and not every fifteen minutes ─────────────────────────
 *
 * Airtable bills per request, not per record. Hourly means a breach is reported between
 * sixty and a hundred and twenty minutes — later than a fifteen-minute sweep would, and
 * cheap enough to leave running for ever. The narrowing below is the other half of that:
 * quiet hours cost nothing at all, the deal query is filtered server-side to Inquiry, and
 * drafts are only read when something actually looks late.
 *
 * ── Why it never fires twice ───────────────────────────────────────────────
 *
 * A done task on the deal is the marker, the same shape the road-warrior brief uses. An
 * alert repeated hourly for the rest of the week is an alert people mute.
 */

import { db } from '@/lib/data'
import { notify } from '@/lib/notify'
import { DEFAULT_QUIET_HOURS, isQuiet } from '@/lib/quiet-hours'
import { inWindow, slaState, REPLY_SLA_MINUTES } from '@/lib/sla'
import { agentActor, recordEvent } from '@/lib/audit'

const WORKER = 'F14'

/** Marker task title. Prefixed so one `startsWith` finds it whatever the deal is called. */
export const MARKER = 'Reply SLA breached'

export interface SlaReport {
  /** Fresh inquiries the sweep looked at. */
  watched: number
  /** Of those, past the hour with no reply sent. */
  breached: number
  /** Alerts actually raised — breaches already marked are not raised again. */
  alerted: number
  /** True when the sweep stopped at the door because nobody was working. */
  skippedQuiet: boolean
}

/** `now` is injectable so the quiet-hours branch is testable at any hour of the day. */
export async function run(now: Date = new Date()): Promise<SlaReport> {
  const report: SlaReport = { watched: 0, breached: 0, alerted: 0, skippedQuiet: false }

  // The clock does not run at night, so neither does the sweep. This is the difference
  // between fourteen Airtable requests a day and twenty-four.
  if (isQuiet(DEFAULT_QUIET_HOURS, now)) {
    report.skippedQuiet = true
    console.info(`[${WORKER}]`, report)
    return report
  }

  const provider = db()
  // Filtered server-side: on a normal morning this is one request returning three rows.
  const inquiries = (await provider.listDeals({ stage: 'inquiry' })).filter((d) =>
    inWindow(d, now),
  )
  report.watched = inquiries.length
  if (inquiries.length === 0) {
    console.info(`[${WORKER}]`, report)
    return report
  }

  const drafts = await provider.listDrafts()
  const late = inquiries.filter((deal) => slaState(deal, drafts, now).breached)
  report.breached = late.length
  if (late.length === 0) {
    console.info(`[${WORKER}]`, report)
    return report
  }

  const tasks = await provider.listTasks()
  for (const deal of late) {
    const title = `${MARKER} — ${deal.name}`
    if (tasks.some((t) => t.dealId === deal.id && t.title === title)) continue

    const state = slaState(deal, drafts, now)
    try {
      await notify({
        type: 'red-alert',
        title: `No reply yet — ${deal.client?.name ?? deal.name}`,
        body:
          `The inquiry arrived ${Math.round(state.elapsed)} working minutes ago and nothing ` +
          `has been sent. The promise is ${REPLY_SLA_MINUTES}.\n\n` +
          'Speed is most of why this one is winnable.',
        link: `/deals/${deal.id}`,
        roles: ['ops', 'admin'],
      })
      // The marker is written after the alert, so a failed send is retried next hour
      // rather than silently marked as handled.
      await provider.createTask({
        dealId: deal.id,
        title,
        assignee: null,
        dueDate: now.toISOString().slice(0, 10),
        source: 'timer',
        stage: deal.stage,
        done: true,
        createdAt: now.toISOString(),
      })
      await recordEvent({
        table: 'deals',
        recordId: deal.id,
        what: 'Reply SLA breached',
        detail: `${Math.round(state.elapsed)} working minutes with no reply sent.`,
        actor: agentActor(WORKER),
        reversible: false,
      })
      report.alerted += 1
    } catch (err) {
      // One deal that cannot be alerted must not cost the others their sweep.
      console.error(`[${WORKER}] ${deal.name} failed`, err)
    }
  }

  console.info(`[${WORKER}]`, report)
  return report
}
