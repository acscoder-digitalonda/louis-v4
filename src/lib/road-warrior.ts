/**
 * WP3.3 — ROAD WARRIOR. Everything Ben needs on his phone the day before.
 *
 * One page, sent at T-1 from the travel departure date, and re-sent whenever the
 * logistics change with an "updated" header so the newest one is obviously the newest.
 *
 * ── Why it is assembled rather than linked ─────────────────────────────────
 *
 * Because it is read in an airport. A link needs signal, a login and a working screen;
 * the brief needs to survive being read at 5am on a phone with one bar. So every fact is
 * in the body, in the order it will be needed, and nothing is behind a tap.
 *
 * ── Why it says what is missing ────────────────────────────────────────────
 *
 * A brief with a blank hotel line reads as "no hotel needed". A brief that says **hotel
 * not recorded** tells Ben to phone Liezel before he is in a taxi. The gaps are the most
 * valuable thing on the page, so they are printed, not omitted.
 */

import type { Deal, Task } from './types'

export interface BriefSection {
  heading: string
  lines: string[]
  /** Facts the record does not have. Printed, never hidden. */
  missing: string[]
}

export interface RoadWarriorBrief {
  dealId: string
  title: string
  /** True when this replaces one already sent. */
  updated: boolean
  sections: BriefSection[]
  /** Everything absent, gathered, so the covering line can lead with it. */
  gaps: string[]
  text: string
}

/**
 * The day travel starts.
 *
 * The explicit field when someone filled it in, the day before the event otherwise.
 * Falling back rather than refusing matters: most deals will never have the field set,
 * and a brief that only fires for the tidy ones is a brief nobody relies on.
 */
export function departureDate(deal: Pick<Deal, 'travelDepartureDate' | 'eventDate'>): string | null {
  if (deal.travelDepartureDate) return deal.travelDepartureDate.slice(0, 10)
  if (!deal.eventDate) return null
  const d = new Date(`${deal.eventDate.slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** True on the day before travel. The trigger, kept separate so it can be tested alone. */
export function isDueToday(
  deal: Pick<Deal, 'travelDepartureDate' | 'eventDate'>,
  today: string,
): boolean {
  const departs = departureDate(deal)
  if (!departs) return false
  const d = new Date(`${departs}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10) === today
}

function section(heading: string, entries: [string, string | null | undefined][]): BriefSection {
  const lines: string[] = []
  const missing: string[] = []
  for (const [label, value] of entries) {
    if (value && String(value).trim()) lines.push(`${label}: ${value}`)
    else missing.push(label)
  }
  return { heading, lines, missing }
}

export function buildBrief(
  deal: Deal,
  opts: {
    contacts?: { name: string; phone: string | null; email: string | null; type: string }[]
    tasks?: Task[]
    updated?: boolean
  } = {},
): RoadWarriorBrief {
  const onsite = (opts.contacts ?? []).filter((c) => c.type === 'onsite' || c.phone)
  const openTasks = (opts.tasks ?? []).filter((t) => !t.done)

  const sections: BriefSection[] = [
    section('Travel', [
      ['Departs', departureDate(deal)],
      ['Outbound', deal.outboundFlight],
      ['Return', deal.returnFlight],
      ['Hotel', deal.hotel],
      ['Notes', deal.travelNotes],
    ]),
    section('On the day', [
      ['Event date', deal.eventDate],
      ['Location', deal.location],
      ['Timezone', deal.eventTimezone],
      ['AV check', deal.avCheckTime],
      ['Stage time', deal.stageTime],
    ]),
    section('The room', [
      ['Client', deal.client?.name],
      ['Audience', deal.audienceProfile],
      ['They asked for', deal.desiredOutcomes],
    ]),
    {
      heading: 'Who to call',
      lines: onsite.length
        ? onsite.map((c) => `${c.name}: ${c.phone ?? c.email ?? 'no number on file'}`)
        : [],
      // Named as a gap rather than left blank: arriving at a venue with nobody's number
      // is the single most recoverable problem on this list, and only before you leave.
      missing: onsite.length ? [] : ['An onsite contact with a phone number'],
    },
    {
      heading: 'Still open',
      lines: openTasks.slice(0, 6).map((t) => t.title),
      missing: [],
    },
  ]

  const gaps = sections.flatMap((s) => s.missing)

  const body: string[] = [
    opts.updated ? 'UPDATED — this replaces the brief sent earlier.' : '',
    deal.name,
    '',
  ]
  if (gaps.length > 0) {
    body.push(`Not on file: ${gaps.join(', ')}.`, '')
  }
  for (const s of sections) {
    if (s.lines.length === 0 && s.missing.length === 0) continue
    body.push(s.heading.toUpperCase())
    for (const l of s.lines) body.push(`  ${l}`)
    for (const m of s.missing) body.push(`  ${m}: not recorded`)
    body.push('')
  }

  return {
    dealId: deal.id,
    title: `${opts.updated ? 'Updated brief' : 'Road warrior'} — ${deal.name}`,
    updated: Boolean(opts.updated),
    sections,
    gaps,
    text: body.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n').trim(),
  }
}

/**
 * Whether a change to the deal is worth re-sending the brief for.
 *
 * Only the fields the brief prints. Re-sending because somebody edited the audience
 * profile teaches Ben to stop opening it, which costs more than the stale line would.
 */
export const BRIEF_FIELDS: (keyof Deal)[] = [
  'travelDepartureDate',
  'outboundFlight',
  'returnFlight',
  'hotel',
  'travelNotes',
  'eventDate',
  'location',
  'eventTimezone',
  'avCheckTime',
  'stageTime',
]

export function shouldResend(changed: (keyof Deal)[]): boolean {
  return changed.some((f) => BRIEF_FIELDS.includes(f))
}
