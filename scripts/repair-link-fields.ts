#!/usr/bin/env tsx
/**
 * Repairs the duplicated link fields left by earlier bootstrap runs.
 *
 *   npm run repair:links            dry run — prints the rename plan
 *   npm run repair:links -- --apply do it, then run `npm run fields:refresh`
 *
 * ── The bug this fixes ─────────────────────────────────────────────────────
 *
 * Every Airtable link field has exactly one `inverseLinkFieldId`. Running the bootstrap
 * more than once created a *second* link for the same relationship, and the app ended up
 * bound to mismatched halves:
 *
 *   writes  Deals.Client        → its inverse is  Clients."Deals 2"
 *   reads   Clients."Deals"     → whose inverse is Deals."Clients", which nothing writes
 *
 * So `Client.dealIds` and `Client.contactIds` read empty no matter how much data is in
 * the base. That silently zeroes the CRM page and, more importantly, the repeat-client
 * rollups the social-proof resolver depends on — on a base with 802 deals in it.
 *
 * ── Why renames and not deletes ────────────────────────────────────────────
 *
 * Airtable's Meta API has no delete-field endpoint (verified: DELETE returns 404, PATCH
 * name works). So the orphan is renamed out of the way, the correct field takes the
 * canonical name, and `fields:refresh` — which binds by name — lands on the field whose
 * inverse the app actually writes. The `(legacy - delete me)` fields are then deleted by
 * hand in the Airtable UI. They are empty, so nothing is lost either way.
 *
 * Renames only. No record is read, written or deleted by this script.
 */

import { listBaseTables, readConfig, type AirtableConfig } from '../src/lib/airtable/rest'

const META = 'https://api.airtable.com/v0/meta'
const GAP_MS = 220

interface Rename {
  table: string
  fieldId: string
  from: string
  to: string
  why: string
}

/**
 * Order matters: an orphan must give up the canonical name before the keeper can take
 * it, because Airtable rejects two fields with the same name in one table.
 */
const PLAN: Rename[] = [
  // ── Clients ↔ Deals. Keeper is the inverse of Deals.Client, which the app writes.
  {
    table: 'Clients',
    fieldId: 'fldS0cBukF0oNCvyT',
    from: 'Deals',
    to: 'Deals (legacy - delete me)',
    why: 'Orphan: its inverse is Deals.Clients, which nothing writes.',
  },
  {
    table: 'Deals',
    fieldId: 'fldXefybYzOfWTRJ6',
    from: 'Clients',
    to: 'Clients (legacy - delete me)',
    why: 'Orphan: the other half of the same dead pair.',
  },
  {
    table: 'Clients',
    fieldId: 'fldNfE3HWAZKdGsam',
    from: 'Deals 2',
    to: 'Deals',
    why: 'Keeper: this is the inverse of Deals.Client. Takes the name the app binds.',
  },

  // ── Clients ↔ Contacts. Keeper is the inverse of Contacts.Client.
  {
    table: 'Clients',
    fieldId: 'fldA98HmPqW3GZp02',
    from: 'Contacts',
    to: 'Contacts (legacy - delete me)',
    why: 'Orphan: its inverse is Contacts.Clients, which nothing writes.',
  },
  {
    table: 'Contacts',
    fieldId: 'fldhWzihHwRxBtIBE',
    from: 'Clients',
    to: 'Clients (legacy - delete me)',
    why: 'Orphan: the other half of the same dead pair.',
  },
  {
    table: 'Clients',
    fieldId: 'fldanT7s8zbN8rZsy',
    from: 'Contacts 2',
    to: 'Contacts',
    why: 'Keeper: this is the inverse of Contacts.Client. Takes the name the app binds.',
  },

  // ── Deal Proposals ↔ Date Conflicts. My own bootstrap run made the same mistake:
  // two independent links for one relationship. Keep the pair anchored on
  // Deal Proposals."Date Conflict", which `conflictId` binds.
  {
    table: 'Date Conflicts',
    fieldId: 'fld2iLcB6srsjr8tT',
    from: 'Proposals',
    to: 'Proposals (legacy - delete me)',
    why: 'Orphan: second, redundant link for the same relationship.',
  },
  {
    table: 'Deal Proposals',
    fieldId: 'fldJQn0RKue3sIy8V',
    from: 'Date Conflicts',
    to: 'Date Conflicts (legacy - delete me)',
    why: 'Orphan: the other half of that redundant pair.',
  },
  {
    table: 'Date Conflicts',
    fieldId: 'fldMw6ZQ2QfwqTOa4',
    from: 'Deal Proposals',
    to: 'Proposals',
    why: 'Keeper: inverse of Deal Proposals."Date Conflict". Takes the name proposalIds binds.',
  },

  // ── Cosmetic: this one is a real inverse (of Deals."Bureau Agent"), just badly named.
  {
    table: 'Contacts',
    fieldId: 'fld0UnZH33ataAQAZ',
    from: 'Deals 2',
    to: 'Deals (as bureau agent)',
    why: 'Not an orphan — the inverse of Deals."Bureau Agent". Renamed so it reads as one.',
  },

  // ── Mine. Left behind by the capability probe that proved DELETE is unsupported.
  {
    table: 'Date Conflicts',
    fieldId: 'fldawSHu2AXmzj985',
    from: '__delete_test_renamed',
    to: 'ZZ delete me (API test)',
    why: 'Throwaway field from testing whether the API can delete fields. It cannot.',
  },
]

async function renameField(
  cfg: AirtableConfig,
  tableId: string,
  fieldId: string,
  name: string,
): Promise<void> {
  const res = await fetch(`${META}/bases/${cfg.baseId}/tables/${tableId}/fields/${fieldId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  await new Promise((r) => setTimeout(r, GAP_MS))
}

async function main() {
  const apply = process.argv.includes('--apply')
  const cfg = readConfig()
  if (!cfg) {
    console.error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set (try .env.local).')
    process.exitCode = 1
    return
  }

  const tables = await listBaseTables(cfg)
  const byName = new Map(tables.map((t) => [t.name, t]))

  console.info(`Base ${cfg.baseId}`)
  console.info(`Mode: ${apply ? 'APPLY' : 'dry run'}\n`)

  let done = 0
  let skipped = 0

  for (const step of PLAN) {
    const table = byName.get(step.table)
    if (!table) {
      console.warn(`  ! ${step.table}: table not found, skipped.`)
      skipped += 1
      continue
    }
    const field = table.fields.find((f) => f.id === step.fieldId)
    if (!field) {
      console.warn(`  ! ${step.table}.${step.from}: field ${step.fieldId} not found, skipped.`)
      skipped += 1
      continue
    }
    if (field.name === step.to) {
      console.info(`  = ${step.table}.${step.to} already named correctly.`)
      skipped += 1
      continue
    }
    // Guard: only rename what we expect to be renaming.
    if (field.name !== step.from) {
      console.warn(
        `  ! ${step.table}.${step.fieldId}: expected "${step.from}", found "${field.name}". Skipped.`,
      )
      skipped += 1
      continue
    }

    console.info(`  ${step.table}."${step.from}" → "${step.to}"`)
    console.info(`      ${step.why}`)
    if (apply) {
      try {
        await renameField(cfg, table.id, step.fieldId, step.to)
        done += 1
      } catch (err) {
        console.warn(`      ! failed: ${err instanceof Error ? err.message : err}`)
        skipped += 1
      }
    }
  }

  console.info('')
  if (!apply) {
    console.info(`Dry run. ${PLAN.length - skipped} rename(s) would run. Re-run with --apply.`)
    return
  }

  console.info(`Renamed ${done} field(s), skipped ${skipped}.`)
  console.info('Now run `npm run fields:refresh` to rebind, then delete the')
  console.info('"(legacy - delete me)" and "ZZ delete me" fields by hand in Airtable.')
}

main().catch((err) => {
  console.error('[repair:links] failed', err)
  process.exitCode = 1
})
