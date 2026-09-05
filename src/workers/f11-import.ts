/**
 * F11 — IMPORT.
 *
 * CSV in (old projects, the five-year scrape, a raw HubSpot export) → mapping →
 * **dry-run diff** → human approves → records created with `source:import` and an audit
 * entry each. Nothing is written until someone has read the merge report.
 *
 * Dedupe candidates are found by the same keys the exports use — company domain, contact
 * email, and company+date for deals — so a round-trip through HubSpot lands back on the
 * same records rather than doubling them.
 */

import { db } from '@/lib/data'
import { agentActor, recordEvent } from '@/lib/audit'
import { invalidateSearchCache } from '@/lib/search'
import { speaker } from '~/speaker.config'

const WORKER = 'F11'

export type ImportTarget = 'companies' | 'contacts' | 'deals'

export interface ImportRow {
  raw: Record<string, string>
  action: 'create' | 'update' | 'skip'
  matchId: string | null
  reason: string
}

export interface MergeReport {
  target: ImportTarget
  total: number
  creates: number
  updates: number
  skips: number
  rows: ImportRow[]
}

/** Minimal RFC4180 parser — quotes, embedded commas, CRLF. */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i]!
    if (quoted) {
      if (char === '"') {
        if (clean[i + 1] === '"') {
          field += '"'
          i += 1
        } else quoted = false
      } else field += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else if (char !== '\r') field += char
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  const [headers, ...body] = rows
  if (!headers) return []
  return body
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(headers.map((h, i) => [h.trim(), (r[i] ?? '').trim()])))
}

/** Recognises a raw HubSpot export by its headers, so no mapping screen is needed. */
export function detectTarget(headers: string[]): ImportTarget | null {
  const set = new Set(headers.map((h) => h.trim()))
  if (set.has('Company Domain Name') && set.has('Company Name') && !set.has('Email')) return 'companies'
  if (set.has('Email')) return 'contacts'
  if (set.has('Deal Name') || set.has('Deal Stage')) return 'deals'
  return null
}

export async function dryRun(target: ImportTarget, rows: Record<string, string>[]): Promise<MergeReport> {
  const provider = db()
  const [clients, contacts, deals] = await Promise.all([
    provider.listClients(),
    provider.listContacts(),
    provider.listDeals(),
  ])

  const report: MergeReport = { target, total: rows.length, creates: 0, updates: 0, skips: 0, rows: [] }

  for (const raw of rows) {
    let action: ImportRow['action'] = 'create'
    let matchId: string | null = null
    let reason = 'New record.'

    const recordId = raw['Airtable Record ID']
    if (recordId) {
      // Round-trip: match on ID, never guess.
      const exists =
        clients.some((c) => c.id === recordId) ||
        contacts.some((c) => c.id === recordId) ||
        deals.some((d) => d.id === recordId)
      if (exists) {
        action = 'update'
        matchId = recordId
        reason = 'Matched on Airtable Record ID.'
      }
    }

    if (!matchId) {
      if (target === 'companies') {
        const domain = raw['Company Domain Name']?.toLowerCase()
        const found = domain
          ? clients.find((c) => c.domain?.toLowerCase() === domain)
          : clients.find((c) => c.name.toLowerCase() === raw['Company Name']?.toLowerCase())
        if (found) {
          action = 'update'
          matchId = found.id
          reason = domain ? 'Matched on company domain.' : 'Matched on company name.'
        } else if (!raw['Company Name']) {
          action = 'skip'
          reason = 'No company name.'
        }
      }
      if (target === 'contacts') {
        const email = raw.Email?.toLowerCase()
        if (!email) {
          action = 'skip'
          reason = 'No email — the dedupe key is missing.'
        } else {
          const found = contacts.find((c) => c.email?.toLowerCase() === email)
          if (found) {
            action = 'update'
            matchId = found.id
            reason = 'Matched on email.'
          }
        }
      }
      if (target === 'deals') {
        const name = raw['Deal Name']
        const date = raw['Event Date'] || raw['Close Date']
        if (!name) {
          action = 'skip'
          reason = 'No deal name.'
        } else {
          const found = deals.find(
            (d) => d.name.toLowerCase() === name.toLowerCase() && (!date || d.eventDate === date),
          )
          if (found) {
            action = 'update'
            matchId = found.id
            reason = 'Matched on deal name and date — likely the same event.'
          } else {
            const sameEvent = deals.filter(
              (d) => date && d.eventDate === date && d.client?.name === raw['Associated Company Domain'],
            )
            if (sameEvent.length > 0) {
              reason = 'Dedupe candidate: another deal exists for this company on this date.'
            }
          }
        }
      }
    }

    report.rows.push({ raw, action, matchId, reason })
    if (action === 'create') report.creates += 1
    else if (action === 'update') report.updates += 1
    else report.skips += 1
  }

  return report
}

/** Only ever called after a human has read the dry-run report. */
export async function commit(report: MergeReport, approver: string): Promise<{ written: number }> {
  const provider = db()
  let written = 0

  for (const row of report.rows) {
    if (row.action === 'skip') continue

    if (report.target === 'companies') {
      const patch = {
        name: row.raw['Company Name'] ?? 'Untitled',
        domain: row.raw['Company Domain Name'] || null,
        industry: row.raw.Industry || null,
        hq: row.raw.City || null,
        notes: row.raw.Description || null,
      }
      const record = row.matchId
        ? await provider.updateClient(row.matchId, patch)
        : await provider.createClient(patch)
      await logImport('clients', record.id, approver)
      written += 1
    }

    if (report.target === 'contacts') {
      const name = [row.raw['First Name'], row.raw['Last Name']].filter(Boolean).join(' ').trim()
      const patch = {
        name: name || row.raw.Email || 'Unknown',
        email: row.raw.Email || null,
        phone: row.raw['Phone Number'] || null,
        title: row.raw['Job Title'] || null,
        type: normaliseContactType(row.raw['Contact Type']),
        keyAgent: row.raw['Key Agent']?.toLowerCase() === 'true',
      }
      const record = row.matchId
        ? await provider.updateContact(row.matchId, patch)
        : await provider.createContact(patch)
      await logImport('contacts', record.id, approver)
      written += 1
    }

    if (report.target === 'deals') {
      const amount = Number(String(row.raw.Amount ?? '').replace(/[^\d.]/g, ''))
      const patch = {
        name: row.raw['Deal Name'] ?? 'Untitled deal',
        stage: normaliseStage(row.raw['Deal Stage']),
        negotiatedFee: Number.isFinite(amount) && amount > 0 ? amount : null,
        eventDate: row.raw['Event Date'] || null,
        location: row.raw.Location || null,
        dealType: row.raw['Deal Type'] || null,
      }
      const record = row.matchId
        ? await provider.updateDeal(row.matchId, patch)
        : await provider.createDeal(patch)
      await logImport('deals', record.id, approver)
      written += 1
    }
  }

  invalidateSearchCache()
  console.info(`[${WORKER}] wrote ${written} record(s)`)
  return { written }
}

async function logImport(table: 'deals' | 'clients' | 'contacts', id: string, approver: string) {
  await recordEvent({
    table,
    recordId: id,
    what: 'Imported',
    detail: `source:import approved by ${approver}`,
    actor: agentActor(WORKER),
    source: 'import',
  })
}

function normaliseContactType(value: string | undefined) {
  const v = (value ?? '').toLowerCase()
  if (v.includes('bureau')) return 'bureau-agent' as const
  if (v.includes('planner')) return 'meeting-planner' as const
  if (v.includes('onsite')) return 'onsite' as const
  return 'decision-maker' as const
}

function normaliseStage(value: string | undefined) {
  const v = (value ?? '').toLowerCase().replace(/\s+/g, '-')
  const match = speaker.stages.find(
    (s) => s.key === v || s.label.toLowerCase().replace(/\s+/g, '-') === v,
  )
  return match?.key ?? 'inquiry'
}
