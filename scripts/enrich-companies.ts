#!/usr/bin/env tsx
/**
 * Company enrichment — industry, address and logo, from each company's own website.
 *
 *   npm run enrich:companies                      dry run, no model calls, no writes
 *   npm run enrich:companies -- --fetch           fetch the sites and classify
 *   npm run enrich:companies -- --fetch --apply   and write what passed
 *   npm run enrich:companies -- --limit=20        stop after twenty companies
 *
 * Three stages, and each one costs more than the last, so each is opt-in:
 *
 *   1. **Domain.** Free. Derived from the website field, or from a work domain that two
 *      or more of the company's contacts share. Runs always, including on a dry run.
 *   2. **The site.** One HTTP request per company, to the company. Title, description,
 *      the logo the site nominates for link previews, and a postal address only where the
 *      site publishes one as structured data.
 *   3. **Classification.** One Haiku call per company that got a readable page, choosing
 *      one of the eighteen industries. Refused unless it comes back inside the taxonomy
 *      and above the confidence floor.
 *
 * Nothing is written without `--apply`, and everything written carries a batch ID, so the
 * whole run reverses with `npm run revert:batch`.
 *
 * ── Why the address is only ever read, never asked for ─────────────────────
 *
 * A model with no browser produces a plausible headquarters for a company it has never
 * heard of, and a plausible wrong address is worse than a blank one because nobody
 * re-checks a filled field. So the address comes from schema.org data the company
 * publishes about itself, or it stays empty.
 */

import { db } from '../src/lib/data'
import { complete } from '../src/lib/gateway'
import { parseJson } from '../src/workers/f7-drafts'
import { recordChangesMany, agentActor } from '../src/lib/audit'
import {
  acceptClassification,
  classifyPrompt,
  deriveDomain,
  logoUrl,
  parseSite,
  type SiteFacts,
} from '../src/lib/enrichment'
import { NOT_AN_INDUSTRY } from '../src/lib/social-proof'
import type { Client } from '../src/lib/types'

const DEFAULT_BATCH_ID = 'enrich-companies-2026-09'
const FETCH_TIMEOUT_MS = 8_000
/** Enough for a head section. A homepage that needs more than this is not worth more. */
const MAX_BYTES = 400_000

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
}

/** A company nobody has classified. Placeholders count as unclassified — that is the point. */
function needsIndustry(client: Client): boolean {
  return !client.industry || NOT_AN_INDUSTRY.includes(client.industry)
}

/**
 * One homepage, fetched defensively.
 *
 * Every failure mode here is normal: dead domains, parked domains, sites that block
 * robots, sites that hang. None of them is an error worth stopping a run for.
 */
async function fetchSite(domain: string): Promise<SiteFacts | { error: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`https://${domain}/`, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        // Named honestly. A site that would rather not be read can say so.
        'User-Agent': 'LouisBot/1.0 (+company enrichment; contact team@digitalonda.com)',
        Accept: 'text/html',
      },
    })
    if (!res.ok) return { error: `HTTP ${res.status}` }

    const reader = res.body?.getReader()
    if (!reader) return { error: 'no body' }
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.length
      if (size >= MAX_BYTES) {
        await reader.cancel()
        break
      }
    }
    const html = Buffer.concat(chunks).toString('utf8')
    return parseSite(html, domain)
  } catch (err) {
    return { error: String((err as Error)?.message ?? err).slice(0, 80) }
  } finally {
    clearTimeout(timer)
  }
}

interface Plan {
  client: Client
  domain: string | null
  facts: SiteFacts | null
  error: string | null
  industry: string | null
  because: string
  patch: Partial<Client>
}

async function main() {
  const doFetch = process.argv.includes('--fetch')
  const apply = process.argv.includes('--apply')
  const limit = Number(arg('limit') ?? '0') || Infinity
  const batch = arg('batch') ?? DEFAULT_BATCH_ID

  const provider = db()
  const [clients, contacts] = await Promise.all([provider.listClients(), provider.listContacts()])

  const emailsByClient = new Map<string, string[]>()
  for (const contact of contacts) {
    if (!contact.clientId || !contact.email) continue
    emailsByClient.set(contact.clientId, [
      ...(emailsByClient.get(contact.clientId) ?? []),
      contact.email,
    ])
  }

  const unclassified = clients.filter(needsIndustry)
  console.log(`${clients.length} companies, ${unclassified.length} without an industry.\n`)

  const plans: Plan[] = []
  for (const client of unclassified.slice(0, limit === Infinity ? undefined : limit)) {
    const domain = deriveDomain({
      name: client.name,
      domain: client.domain,
      website: client.website,
      emails: emailsByClient.get(client.id),
    })

    const plan: Plan = {
      client,
      domain,
      facts: null,
      error: null,
      industry: null,
      because: '',
      patch: {},
    }
    // Free, and worth doing on its own: a company with a domain can be enriched later
    // even if this run never gets to the model.
    if (domain && !client.domain) plan.patch.domain = domain

    if (doFetch && domain) {
      const result = await fetchSite(domain)
      if ('error' in result) {
        plan.error = result.error
      } else {
        plan.facts = result
        if (result.address && !client.hq) plan.patch.hq = result.address
        if (!client.website) plan.patch.website = `https://${domain}`

        try {
          const answer = await complete({
            worker: 'ENRICH',
            task: 'classify',
            json: true,
            system:
              'You classify companies into a fixed taxonomy from what their own homepage ' +
              'says. You refuse rather than guess.',
            input: classifyPrompt(result),
          })
          const parsed = parseJson<{ industry?: unknown; confidence?: unknown; because?: unknown }>(
            answer.text,
          )
          const decision = acceptClassification(parsed ?? {}, result)
          plan.industry = decision.industry
          plan.because = decision.because
          if (decision.industry) plan.patch.industry = decision.industry
        } catch (err) {
          plan.error = `classify: ${String((err as Error)?.message ?? err).slice(0, 60)}`
        }
      }
    }

    plans.push(plan)
    process.stdout.write(
      `  ${plan.client.name.slice(0, 34).padEnd(36)}${(plan.domain ?? '—').padEnd(28)}` +
        `${plan.industry ?? (plan.error ? `· ${plan.error}` : '—')}\n`,
    )
  }

  const withDomain = plans.filter((p) => p.domain).length
  const classified = plans.filter((p) => p.industry).length
  const addressed = plans.filter((p) => p.patch.hq).length
  const logos = plans.filter((p) => p.facts).map((p) => logoUrl(p.facts!)).length

  console.log(`\nLooked at         ${plans.length}`)
  console.log(`Domain resolved   ${withDomain}`)
  if (doFetch) {
    console.log(`Site read         ${plans.filter((p) => p.facts).length}`)
    console.log(`Industry decided  ${classified}`)
    console.log(`Address published ${addressed}   (the office the site advertises, which`)
    console.log(`                        is not always the headquarters)`)
    console.log(`Logo available    ${logos}`)
    const refused = plans.filter((p) => p.facts && !p.industry)
    if (refused.length > 0) {
      console.log(`\nRefused to guess (${refused.length}) — for a person to look at:`)
      for (const p of refused.slice(0, 12)) {
        console.log(`  · ${p.client.name} — ${p.because}`)
      }
      if (refused.length > 12) console.log(`  … and ${refused.length - 12} more`)
    }
  } else {
    console.log('\nNo sites fetched and no model called. Re-run with --fetch to do that.')
  }

  const writes = plans.filter((p) => Object.keys(p.patch).length > 0)
  console.log(`\n${writes.length} company/ies would change.`)

  if (!apply) {
    console.log('Dry run. Re-run with --fetch --apply to write.')
    return
  }

  for (const plan of writes) {
    await provider.updateClient(plan.client.id, plan.patch)
  }
  // One audit call for the whole run rather than one per company: the batched helper
  // exists because the unbatched version is what exhausted a month of Airtable quota.
  await recordChangesMany(
    writes.map((p) => ({
      table: 'clients' as const,
      recordId: p.client.id,
      before: p.client as unknown as Record<string, unknown>,
      after: p.patch as Record<string, unknown>,
      actor: agentActor('ENRICH'),
      source: p.because || 'company enrichment',
      batchId: batch,
    })),
  )
  console.log(`Written. Batch ${batch} — reversible with revert:batch.`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
