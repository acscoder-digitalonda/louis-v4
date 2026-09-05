/**
 * Global search (Handoff §5).
 *
 * Airtable has no search endpoint worth using, so the honest middle path is a small
 * server-side cache of searchable fields refreshed every 60s (and invalidated on write),
 * with fuzzy matching over it. At hundreds-to-low-thousands of records this is instant
 * and adds no infrastructure. If the base grows 10×, swap the innards of `search()` for
 * a real index — nothing outside this file needs to know.
 *
 * The palette also searches *actions*, so ⌘K is a command palette rather than a finder.
 */

import Fuse from 'fuse.js'
import { db } from './data'
import type { SearchDoc } from './types'
import { stageByKey } from '~/speaker.config'

const TTL_MS = 60_000

interface CacheEntry {
  at: number
  docs: SearchDoc[]
  fuse: Fuse<SearchDoc>
}

const GLOBAL_KEY = Symbol.for('louis.search.cache')

function slot(): { cache: CacheEntry | null } {
  const g = globalThis as unknown as Record<symbol, { cache: CacheEntry | null } | undefined>
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = { cache: null }
  return g[GLOBAL_KEY]!
}

/** Call after any write so the next search sees fresh data. */
export function invalidateSearchCache(): void {
  slot().cache = null
}

export const ACTIONS: SearchDoc[] = [
  { id: 'act-pipeline', type: 'action', title: 'Pipeline', subtitle: 'The board', href: '/pipeline', haystack: 'pipeline board home kanban stages' },
  { id: 'act-deals', type: 'action', title: 'Deals', subtitle: 'All deals', href: '/deals', haystack: 'deals list table all' },
  { id: 'act-queue', type: 'action', title: 'Review Queue', subtitle: 'Drafts and proposals', href: '/queue', haystack: 'review queue approve drafts proposals inbox' },
  { id: 'act-crm', type: 'action', title: 'CRM', subtitle: 'Clients and contacts', href: '/crm', haystack: 'crm contacts clients people companies bureau agents' },
  { id: 'act-journal', type: 'action', title: 'Journal', subtitle: 'Orders sidecar', href: '/journal', haystack: 'journal orders merch shipping warehouse' },
  { id: 'act-money', type: 'action', title: 'Money', subtitle: 'Owed, paid, weighted', href: '/money', haystack: 'money payments owed paid forecast invoices cash' },
  { id: 'act-settings', type: 'action', title: 'Settings', subtitle: 'Appearance, users, AI', href: '/settings', haystack: 'settings preferences theme appearance users roles ai tier map' },
  { id: 'act-appearance', type: 'action', title: 'Settings → Appearance', subtitle: 'Theme and accents', href: '/settings?tab=appearance', haystack: 'theme dark light accent hex colors appearance' },
  { id: 'act-ai', type: 'action', title: 'Settings → AI', subtitle: 'Backend, tier map, usage meter', href: '/settings?tab=ai', haystack: 'ai backend openrouter claude usage meter cost cap tokens' },
  { id: 'act-import', type: 'action', title: 'Import / Export', subtitle: 'CSV, HubSpot profile', href: '/settings?tab=data', haystack: 'import export csv hubspot mapping snapshot backup' },
  { id: 'act-new-deal', type: 'action', title: 'New deal', subtitle: 'Create an inquiry', href: '/deals?new=1', haystack: 'new deal create add inquiry' },
]

async function build(): Promise<CacheEntry> {
  const provider = db()
  const [deals, clients, contacts, journal, drafts] = await Promise.all([
    provider.listDeals(),
    provider.listClients(),
    provider.listContacts(),
    provider.listJournalOrders(),
    provider.listDrafts({ status: 'proposed' }),
  ])

  const docs: SearchDoc[] = [
    ...deals.map<SearchDoc>((d) => ({
      id: d.id,
      type: 'deal',
      title: d.name,
      subtitle: [stageByKey.get(d.stage)?.label, d.location, d.eventDate].filter(Boolean).join(' · '),
      href: `/deals/${d.id}`,
      haystack: [d.name, d.client?.name, d.location, d.eventDate, d.dealType, d.stage]
        .filter(Boolean)
        .join(' '),
    })),
    ...clients.map<SearchDoc>((c) => ({
      id: c.id,
      type: 'client',
      title: c.name,
      subtitle: [c.industry, c.hq].filter(Boolean).join(' · ') || null,
      href: `/crm?client=${c.id}`,
      haystack: [c.name, c.domain, c.industry, c.hq].filter(Boolean).join(' '),
    })),
    ...contacts.map<SearchDoc>((c) => ({
      id: c.id,
      type: 'contact',
      title: c.name,
      subtitle: [c.title, c.agency, c.email].filter(Boolean).join(' · ') || null,
      href: `/crm?contact=${c.id}`,
      haystack: [c.name, c.email, c.phone, c.agency, c.title, c.type].filter(Boolean).join(' '),
    })),
    ...journal.map<SearchDoc>((o) => ({
      id: o.id,
      type: 'journal',
      title: o.reference,
      subtitle: [o.status, o.quantity ? `${o.quantity} copies` : null].filter(Boolean).join(' · '),
      href: `/journal?order=${o.id}`,
      haystack: [o.reference, o.status, o.shipTo, o.warehouseNotes].filter(Boolean).join(' '),
    })),
    ...drafts.map<SearchDoc>((d) => ({
      id: d.id,
      type: 'draft',
      title: d.subject || `${d.type} draft`,
      subtitle: `Draft · ${d.status}`,
      href: `/queue?draft=${d.id}`,
      haystack: [d.subject, d.body.slice(0, 400), d.type, d.toEmail].filter(Boolean).join(' '),
    })),
    ...ACTIONS,
  ]

  const fuse = new Fuse(docs, {
    keys: [
      { name: 'title', weight: 0.6 },
      { name: 'subtitle', weight: 0.15 },
      { name: 'haystack', weight: 0.25 },
    ],
    threshold: 0.38,
    ignoreLocation: true,
    minMatchCharLength: 2,
  })

  return { at: Date.now(), docs, fuse }
}

async function entry(): Promise<CacheEntry> {
  const s = slot()
  if (s.cache && Date.now() - s.cache.at < TTL_MS) return s.cache
  s.cache = await build()
  return s.cache
}

export async function search(query: string, limit = 20): Promise<SearchDoc[]> {
  const { docs, fuse } = await entry()
  const q = query.trim()
  // Empty query = the palette's resting state: the commands, not a data dump.
  if (!q) return docs.filter((d) => d.type === 'action').slice(0, limit)
  return fuse.search(q, { limit }).map((r) => r.item)
}
