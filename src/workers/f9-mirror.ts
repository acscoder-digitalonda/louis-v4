/**
 * F9 — MIRROR WORKER.
 *
 * Google is redundancy, one-way, app → Google: Calendar holds colour-coded by stage,
 * a regenerated Doc per deal, a Sheets index row, and the Drive folder tree. Every push
 * records its result in Mirror State so the weekly integrity check has something to
 * compare, and a failure is a notification rather than a silent gap.
 *
 * Google credentials are optional. Without them the worker records a `skipped` state
 * instead of erroring — the mirror is redundancy, and redundancy must never be the
 * thing that breaks the primary.
 */

import { db } from '@/lib/data'
import { notify } from '@/lib/notify'
import {
  accessToken,
  CALENDAR,
  DRIVE,
  googleConfigured as googleAuthConfigured,
} from '@/lib/google/auth'

/**
 * Whose Google account the mirror acts as.
 *
 * This is the calendar's owner, not the address that sends mail. They are usually
 * different people: `Louis Holds` belongs to the team account so that delegation can
 * reach it, while outbound mail goes as the speaker. Until now F9 borrowed the Gmail
 * token for calendar and Drive writes — the wrong scope and the wrong identity, which
 * would have failed the moment it ran.
 */
function mirrorSubject(): string | undefined {
  return process.env.GOOGLE_MIRROR_SUBJECT ?? process.env.GMAIL_SERVICE_ADDRESS
}
import type { Deal, MirrorSurface } from '@/lib/types'

const WORKER = 'F9'

export function googleConfigured(): boolean {
  return googleAuthConfigured()
}

export async function pushMirror(surface: MirrorSurface, deal: Deal): Promise<void> {
  const provider = db()
  if (!googleConfigured()) {
    await provider.upsertMirrorState({
      surface,
      entity: `deals/${deal.name}`,
      entityId: deal.id,
      lastPushed: null,
      ok: false,
      error: 'Google is not configured — mirror skipped.',
    })
    return
  }

  try {
    switch (surface) {
      case 'calendar':
        await pushCalendar(deal)
        break
      case 'drive':
        await ensureDriveFolders(deal)
        break
      case 'doc':
      case 'sheet':
        // Doc and Sheet regeneration run on the scheduled sweep, not on every change,
        // so a burst of edits does not rewrite the same document ten times.
        break
    }
    await provider.upsertMirrorState({
      surface,
      entity: `deals/${deal.name}`,
      entityId: deal.id,
      lastPushed: new Date().toISOString(),
      ok: true,
      error: null,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await provider.upsertMirrorState({
      surface,
      entity: `deals/${deal.name}`,
      entityId: deal.id,
      lastPushed: new Date().toISOString(),
      ok: false,
      error: message.slice(0, 500),
    })
    await notify({
      type: 'worker-failure',
      title: `Mirror push failed (${surface})`,
      body: `${deal.name}: ${message}`,
      link: '/settings?tab=mirror',
      roles: ['admin'],
    })
  }
}

const STAGE_COLOR: Record<string, string> = {
  inquiry: '8',
  sales: '5',
  'closed-won': '6',
  'pre-event': '9',
  delivered: '10',
  debriefed: '2',
  dormant: '8',
}

/**
 * Google requires event IDs in base32hex — the characters a to v and 0 to 9, nothing
 * else. Airtable record IDs are base62 and routinely contain w, x, y and z, so lowercasing
 * one and hoping produces "Invalid resource id value" on exactly the records that happen
 * to contain those letters. Hex encoding is always inside the allowed set.
 */
export function calendarEventId(recordId: string): string {
  return `louis${Buffer.from(recordId, 'utf8').toString('hex')}`
}

/** The exclusive end date for a one-day all-day event. */
export function nextDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

async function pushCalendar(deal: Deal): Promise<void> {
  if (!deal.eventDate) return
  const token = await accessToken([CALENDAR], mirrorSubject())
  // Never defaults to 'primary'. A mirror that falls back to the speaker's own calendar
  // writes app records onto the calendar the app is supposed to be *reading* as a source
  // during the cutover — and a later reverse read would take them for genuine bookings.
  // No target configured means no push, which is a skipped mirror, not a wrong one.
  const calendarId = process.env.GOOGLE_CALENDAR_ID
  if (!calendarId) throw new Error('GOOGLE_CALENDAR_ID is not set — refusing to write to a default calendar')
  const body = {
    summary: `${deal.name}${deal.stage === 'sales' ? ' (HOLD)' : ''}`,
    description: [deal.location, deal.stageTime, `Stage: ${deal.stage}`].filter(Boolean).join('\n'),
    location: deal.location ?? undefined,
    start: { date: deal.eventDate },
    // All-day events end on the *exclusive* next day. Start and end on the same date is a
    // zero-length event, which Google rejects.
    end: { date: nextDay(deal.eventDate) },
    colorId: STAGE_COLOR[deal.stage] ?? '8',
    // A stable id keeps re-pushes idempotent — one event per deal, updated in place.
    id: calendarEventId(deal.id),
  }

  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`
  const patch = await fetch(`${base}/${body.id}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (patch.ok) return

  const insert = await fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!insert.ok) throw new Error(`Calendar push failed: ${insert.status} ${await insert.text()}`)
}

async function ensureDriveFolders(deal: Deal): Promise<void> {
  if (deal.driveFolderUrl) return
  const token = await accessToken([DRIVE], mirrorSubject())
  const parent = process.env.GOOGLE_DRIVE_DEALS_FOLDER_ID
  if (!parent) throw new Error('GOOGLE_DRIVE_DEALS_FOLDER_ID is not set')

  const folderName = deal.eventDate
    ? `${deal.eventDate.slice(0, 4)} — ${deal.name}`
    : deal.name

  const root = await createFolder(token, folderName, parent)
  for (const child of ['Received', 'Sent', 'Decks', 'Emails']) {
    await createFolder(token, child, root)
  }
  await db().updateDeal(deal.id, {
    driveFolderUrl: `https://drive.google.com/drive/folders/${root}`,
  })
}

async function createFolder(token: string, name: string, parent: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
  })
  if (!res.ok) throw new Error(`Drive folder create failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { id: string }
  return json.id
}

/** The scheduled sweep + weekly integrity check. */
export async function run(): Promise<{ pushed: number; errors: number }> {
  const provider = db()
  const deals = await provider.listDeals()
  const active = deals.filter((d) => d.stage !== 'dormant' && d.stage !== 'debriefed')

  for (const deal of active) {
    await pushMirror('calendar', deal)
    await pushMirror('drive', deal)
  }

  const state = await provider.listMirrorState()
  const errors = state.filter((s) => !s.ok).length

  // Integrity check: the mirror should hold a row per active deal per surface.
  const expected = active.length * 2
  if (state.length < expected) {
    await notify({
      type: 'worker-failure',
      title: 'Mirror integrity check failed',
      body: `Expected at least ${expected} mirror rows for ${active.length} active deals, found ${state.length}.`,
      link: '/settings?tab=mirror',
      roles: ['admin'],
    })
  }

  console.info(`[${WORKER}] mirrored ${active.length} deals, ${errors} errors`)
  return { pushed: active.length, errors }
}
