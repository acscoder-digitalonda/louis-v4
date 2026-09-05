#!/usr/bin/env tsx
/**
 * Creates an empty v3 base in a workspace — step one of stamping a new speaker.
 *
 *   AIRTABLE_WORKSPACE_ID=wsp... npm run base:create -- --name "Louis v3"
 *
 * Airtable requires at least one table when a base is created, so we seed it with the
 * real `Clients` table rather than a throwaway — there is no delete-table endpoint in
 * the public API, and a junk table would be permanent.
 *
 * Prints the new base id. Feed that to `base:bootstrap` for the other seventeen tables.
 */

import { TABLES } from '../src/lib/airtable/schema'
import { creatableFields } from '../src/lib/airtable/meta-fields'

async function main() {
  const key = process.env.AIRTABLE_API_KEY
  const workspaceId = process.env.AIRTABLE_WORKSPACE_ID
  if (!key) throw new Error('AIRTABLE_API_KEY is not set')
  if (!workspaceId) throw new Error('AIRTABLE_WORKSPACE_ID is not set (looks like wsp...)')

  const nameFlag = process.argv.indexOf('--name')
  const name = nameFlag > -1 ? process.argv[nameFlag + 1] : 'Louis v3'

  const seed = TABLES.clients
  const res = await fetch('https://api.airtable.com/v0/meta/bases', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      workspaceId,
      tables: [
        {
          name: seed.name,
          description: seed.description,
          fields: creatableFields(seed.fields),
        },
      ],
    }),
  })

  if (!res.ok) throw new Error(`create base failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { id: string; tables?: { name: string }[] }

  console.info(`Created base "${name}"`)
  console.info(`  id: ${json.id}`)
  console.info(`\nNext:`)
  console.info(`  AIRTABLE_BASE_ID=${json.id} npm run base:bootstrap -- --apply`)
  console.info(`  AIRTABLE_BASE_ID=${json.id} npm run fields:refresh`)
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
