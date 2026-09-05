/**
 * F12 — EXPORT. The platform-exit guarantee.
 *
 * Two shapes:
 *  - **native** — Louis's own field names, one file per table. The backup shape.
 *  - **hubspot** — companies / contacts / deals with HubSpot's header labels, ISO dates,
 *    semicolon multi-values, plain-number amounts, and an `Airtable Record ID` column on
 *    every file so exports round-trip. HubSpot shape is the lingua franca: Attio,
 *    Pipedrive and Salesforce importers take it with minimal remapping.
 *
 * The mapping is defined once, here, and read in both directions — F11 uses the same
 * table to import a raw HubSpot export.
 */

import { db } from '@/lib/data'
import { dealValue } from '@/lib/forecast'
import { stageByKey } from '~/speaker.config'
import type { Client, Contact, Deal, JournalOrder } from '@/lib/types'

export type ExportProfile = 'native' | 'hubspot'
export type HubspotFile = 'companies' | 'contacts' | 'deals'

export interface CsvFile {
  filename: string
  csv: string
  rows: number
}

/** HubSpot header ⇄ domain field. Read both ways; F11 imports with the same map. */
export const HUBSPOT_MAP = {
  companies: {
    'Company Name': 'name',
    'Company Domain Name': 'domain',
    Industry: 'industry',
    City: 'hq',
    'Country/Region': '',
    Description: 'notes',
    'Airtable Record ID': 'id',
  },
  contacts: {
    'First Name': 'firstName',
    'Last Name': 'lastName',
    Email: 'email',
    'Phone Number': 'phone',
    'Job Title': 'title',
    'Company Name': 'companyName',
    'Company Domain Name': 'companyDomain',
    'Contact Type': 'type',
    'Key Agent': 'keyAgent',
    'Airtable Record ID': 'id',
  },
  deals: {
    'Deal Name': 'name',
    Pipeline: 'pipeline',
    'Deal Stage': 'stage',
    Amount: 'amount',
    'Close Date': 'closeDate',
    'Deal Type': 'dealType',
    'Associated Company Domain': 'companyDomain',
    'Associated Contact Emails': 'contactEmails',
    'Event Date': 'eventDate',
    Location: 'location',
    'Airtable Record ID': 'id',
  },
} as const

export const PIPELINE_NAME = 'Keynote'

export async function exportHubspot(file: HubspotFile): Promise<CsvFile> {
  const provider = db()
  const [deals, clients, contacts] = await Promise.all([
    provider.listDeals(),
    provider.listClients(),
    provider.listContacts(),
  ])

  switch (file) {
    case 'companies': {
      const headers = Object.keys(HUBSPOT_MAP.companies)
      const rows = clients.map((c: Client) => [
        c.name,
        c.domain ?? '',
        c.industry ?? '',
        c.hq ?? '',
        '',
        c.notes ?? '',
        c.id,
      ])
      return csvFile('companies.csv', headers, rows)
    }
    case 'contacts': {
      const headers = Object.keys(HUBSPOT_MAP.contacts)
      const rows = contacts.map((c: Contact) => {
        const client = clients.find((cl) => cl.id === c.clientId)
        const { first, last } = splitName(c.name)
        return [
          first,
          last,
          c.email ?? '',
          c.phone ?? '',
          c.title ?? '',
          client?.name ?? c.agency ?? '',
          client?.domain ?? '',
          c.type,
          c.keyAgent ? 'true' : 'false',
          c.id,
        ]
      })
      return csvFile('contacts.csv', headers, rows)
    }
    case 'deals': {
      const headers = Object.keys(HUBSPOT_MAP.deals)
      const rows = deals.map((d: Deal) => {
        const client = d.client ? clients.find((c) => c.id === d.client!.id) : undefined
        const emails = contacts
          .filter((c) => c.dealIds.includes(d.id) && c.email)
          .map((c) => c.email!)
          .join(';')
        return [
          d.name,
          PIPELINE_NAME,
          stageByKey.get(d.stage)?.label ?? d.stage,
          String(dealValue(d) || ''),
          isoDate(d.decisionDate ?? d.eventDate),
          d.dealType ?? '',
          client?.domain ?? '',
          emails,
          isoDate(d.eventDate),
          d.location ?? '',
          d.id,
        ]
      })
      return csvFile('deals.csv', headers, rows)
    }
  }
}

/** Journal orders have no native HubSpot object, so they travel as their own file. */
export async function exportJournal(): Promise<CsvFile> {
  const orders = await db().listJournalOrders()
  const headers = [
    'Reference',
    'Status',
    'Quantity',
    'Ship To',
    'Ship By',
    'Inserts',
    'Warehouse Notes',
    'Deal Record ID',
    'Client Record ID',
    'Airtable Record ID',
  ]
  const rows = orders.map((o: JournalOrder) => [
    o.reference,
    o.status,
    o.quantity === null ? '' : String(o.quantity),
    o.shipTo ?? '',
    isoDate(o.shipByDate),
    o.inserts ? 'true' : 'false',
    o.warehouseNotes ?? '',
    o.dealId ?? '',
    o.clientId ?? '',
    o.id,
  ])
  return csvFile('journal-orders.csv', headers, rows)
}

export async function exportNative(table: 'deals' | 'clients' | 'contacts' | 'journalOrders'): Promise<CsvFile> {
  const provider = db()
  if (table === 'journalOrders') return exportJournal()

  const records =
    table === 'deals'
      ? await provider.listDeals()
      : table === 'clients'
        ? await provider.listClients()
        : await provider.listContacts()

  if (records.length === 0) return csvFile(`${table}.csv`, ['Airtable Record ID'], [])

  const headers = Object.keys(records[0]!)
  const rows = records.map((record) =>
    headers.map((h) => {
      const value = (record as unknown as Record<string, unknown>)[h]
      if (value === null || value === undefined) return ''
      if (Array.isArray(value)) return value.map((v) => stringify(v)).join(';')
      return stringify(value)
    }),
  )
  return csvFile(`${table}.csv`, headers, rows)
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    const ref = value as { name?: string; id?: string }
    return ref.name ?? ref.id ?? JSON.stringify(value)
  }
  return String(value)
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return { first: parts[0] ?? '', last: '' }
  return { first: parts.slice(0, -1).join(' '), last: parts.at(-1) ?? '' }
}

function isoDate(value: string | null | undefined): string {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export function csvFile(filename: string, headers: string[], rows: string[][]): CsvFile {
  const lines = [headers.map(escapeCsv).join(','), ...rows.map((r) => r.map(escapeCsv).join(','))]
  // A BOM keeps Excel from mangling UTF-8, which is where most "the export is broken"
  // reports actually come from.
  return { filename, csv: `﻿${lines.join('\r\n')}\r\n`, rows: rows.length }
}

export function escapeCsv(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}
