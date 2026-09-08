/**
 * Every field the schema declares must be written by its encoder.
 *
 * This test reads source rather than behaviour, which is unusual and is the point: the
 * bug it exists for is invisible to behaviour. `updateDeal` accepted fifteen fields,
 * dropped them in the encoder, and returned a decoded record that read them back from
 * Airtable — where they had never been written. Nothing threw. Nothing logged.
 *
 * It could not be caught by the rest of the suite either, because those tests run on the
 * in-memory provider, which stores the object exactly as given and never passes it
 * through an encoder at all.
 *
 * Five separate faults today had this shape. So the rule gets asserted directly: if
 * `schema.ts` says a field exists and is writable, some encoder has to mention it.
 */

import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { TABLES, type TableKey } from '@/lib/airtable/schema'

const SOURCE = readFileSync(new URL('./airtable.ts', import.meta.url), 'utf8')

/** Airtable owns these; nothing in the app may write them. */
const READ_ONLY = /^(created|createdAt|lastModified|updatedAt)$/

/**
 * Declared on the table but not on the domain type yet.
 *
 * A schema may run ahead of the code — these two were added for per-draft senders, which
 * the template library needs (22 templates go from Ben, 5 from Liezel) and the mailer
 * does not do yet. Listed rather than ignored, so adding the feature means deleting a
 * line here.
 */
const NOT_YET_MODELLED: Partial<Record<TableKey, string[]>> = {
  drafts: ['messageId', 'mailbox'],
}

function encodedKeys(): Map<TableKey, Set<string>> {
  const out = new Map<TableKey, Set<string>>()
  for (const match of SOURCE.matchAll(/private encode\w+\([^)]*\)[^{]*\{([\s\S]*?)\n  \}/g)) {
    const body = match[1]!
    const table = body.match(/this\.w\('(\w+)'/)?.[1] as TableKey | undefined
    if (!table) continue
    const keys = new Set(out.get(table) ?? [])
    for (const m of body.matchAll(/out\.(\w+)\s*=/g)) keys.add(m[1]!)
    for (const m of body.matchAll(/out\[['"](\w+)['"]\]\s*=/g)) keys.add(m[1]!)
    for (const m of body.matchAll(/\bset\(\s*['"](\w+)['"]/g)) keys.add(m[1]!)
    out.set(table, keys)
  }
  return out
}

describe('the Airtable encoders', () => {
  const encoders = encodedKeys()

  it('finds an encoder to inspect for every table it claims to cover', () => {
    // If the regex above stops matching, this test would pass by finding nothing.
    assert.ok(encoders.size >= 8, `only ${encoders.size} encoder(s) parsed — the matcher broke`)
    assert.ok(encoders.get('deals')?.has('stage'), 'the deals encoder was not parsed')
  })

  for (const [table, written] of encoders) {
    it(`writes every writable field on ${TABLES[table].name}`, () => {
      const exempt = new Set(NOT_YET_MODELLED[table] ?? [])
      const missing = TABLES[table].fields
        .filter((f) => !f.computed && !READ_ONLY.test(f.key) && !exempt.has(f.key))
        .filter((f) => !written.has(f.key))
        .map((f) => `${f.key} ("${f.name}")`)

      assert.deepEqual(
        missing,
        [],
        `${TABLES[table].name}: declared, decoded, and silently never written`,
      )
    })
  }
})
