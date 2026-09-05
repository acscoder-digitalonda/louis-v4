/**
 * F3 — RESEARCH AGENT.
 *
 * Trigger: a deal enters Inquiry. Sonnet writes a cursory brief (company, mission,
 * budget signals, recent news). Haiku then verifies that **every claim carries a source
 * link** and flags anything it cannot trace — the checker is the deliverable, not a
 * nicety. Escalates to Opus only when Sonnet self-reports low confidence or the client
 * is flagged high-value.
 */

import { db } from '@/lib/data'
import { complete, GatewayPaused } from '@/lib/gateway'
import { notify } from '@/lib/notify'
import { parseJson } from './f7-drafts'
import { dealValue } from '@/lib/forecast'
import { speaker } from '~/speaker.config'
import type { CheckerVerdict, Deal, ResearchBrief } from '@/lib/types'

const WORKER = 'F3'

/** A deal worth more than this gets the Opus pass regardless of self-reported confidence. */
const HIGH_VALUE_MULTIPLIER = 1.5

interface BriefPayload {
  companyFacts?: string
  mvv?: string
  budgetSignals?: string
  notes?: string
  sources?: string[]
  confidence?: number
}

export async function runResearch(deal: Deal): Promise<ResearchBrief | null> {
  const provider = db()

  const existing = await provider.listResearchBriefs(deal.id)
  if (existing.length > 0) return existing[0]!

  const client = deal.client ? await provider.getClient(deal.client.id) : null
  const context = {
    company: client?.name ?? deal.client?.name ?? 'unknown',
    domain: client?.domain ?? null,
    website: client?.website ?? null,
    event: deal.name,
    date: deal.eventDate,
    location: deal.location,
  }

  let payload: BriefPayload | null = null
  let model = ''

  try {
    const first = await complete({
      worker: WORKER,
      task: 'research',
      dealId: deal.id,
      json: true,
      system: `You prepare briefing notes for ${speaker.speakerName} before a keynote conversation. You are careful and you cite.`,
      input: researchPrompt(context),
    })
    payload = parseJson<BriefPayload>(first.text)
    model = first.model

    const highValue = dealValue(deal) > speaker.fees.defaultList * HIGH_VALUE_MULTIPLIER
    const lowConfidence = (payload?.confidence ?? 1) < 0.6

    if (highValue || lowConfidence) {
      const escalated = await complete({
        worker: WORKER,
        task: 'escalate',
        dealId: deal.id,
        json: true,
        escalate: true,
        system: `You are reviewing and deepening a briefing note for ${speaker.speakerName}. Correct anything thin or unsupported.`,
        input: [
          researchPrompt(context),
          '',
          `A first pass produced this. Improve it; drop anything you cannot source.`,
          JSON.stringify(payload ?? {}),
        ].join('\n'),
      })
      const better = parseJson<BriefPayload>(escalated.text)
      if (better) {
        payload = better
        model = escalated.model
      }
    }
  } catch (err) {
    if (err instanceof GatewayPaused) {
      console.warn('[F3] paused at the AI cap — no brief written.')
      return null
    }
    throw err
  }

  if (!payload) return null

  const verdict = await checkSources(deal, payload)

  const brief = await provider.createResearchBrief({
    dealId: deal.id,
    companyFacts: payload.companyFacts ?? '',
    mvv: payload.mvv ?? null,
    budgetSignals: payload.budgetSignals ?? null,
    notes: payload.notes ?? null,
    sources: payload.sources ?? [],
    model,
    checkedBy: verdict.model,
    checkerVerdict: verdict,
    createdAt: new Date().toISOString(),
  })

  await notify({
    type: 'review-item',
    title: `Research brief — ${deal.name}`,
    body: [
      payload.companyFacts?.slice(0, 400),
      verdict.ok ? null : `Checker flagged: ${verdict.issues.join(' · ')}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    link: `/deals/${deal.id}`,
    roles: ['owner', 'ops', 'admin'],
  })

  return brief
}

function researchPrompt(context: Record<string, unknown>): string {
  return [
    'Write a short briefing note about this company for a first sales conversation.',
    '',
    'Cover: what the company does, its stated mission/vision/values, any signal about budget or',
    'scale (headcount, revenue, funding, size of past events), and anything recent that would',
    'matter in the room.',
    '',
    'Rules: every factual claim must have a source URL in "sources". If you cannot source a claim,',
    'leave it out. Do not speculate about budget from nothing. Report your own confidence honestly.',
    '',
    `Context: ${JSON.stringify(context)}`,
    '',
    'Return {"companyFacts":"...","mvv":"...","budgetSignals":"...","notes":"...","sources":["url"],"confidence":0-1}.',
  ].join('\n')
}

/** The cheap verification pass: does every claim trace to a link? */
async function checkSources(deal: Deal, payload: BriefPayload): Promise<CheckerVerdict> {
  const issues: string[] = []
  if (!payload.sources || payload.sources.length === 0) {
    issues.push('No sources at all — treat every claim as unverified.')
  }

  try {
    const result = await complete({
      worker: WORKER,
      task: 'check',
      dealId: deal.id,
      json: true,
      system: 'You verify that claims are sourced. You do not add information.',
      input: [
        'Check this briefing note. List any claim that is not supported by one of the sources,',
        'and any source that does not plausibly support the claim it is attached to.',
        '',
        JSON.stringify(payload),
        '',
        'Return {"ok":boolean,"issues":string[]}.',
      ].join('\n'),
    })
    const parsed = parseJson<{ ok?: boolean; issues?: string[] }>(result.text)
    if (parsed?.issues?.length) issues.push(...parsed.issues)
    return { ok: issues.length === 0, model: result.model, issues, checkedAt: new Date().toISOString() }
  } catch {
    issues.push('Checker pass did not run.')
    return { ok: false, model: 'none', issues, checkedAt: new Date().toISOString() }
  }
}

/** Sweep entry point: brief any Inquiry deal that has none. */
export async function run(): Promise<{ written: number }> {
  const deals = await db().listDeals({ stage: 'inquiry' })
  let written = 0
  for (const deal of deals) {
    // One unresearchable company must not cost the rest of the batch its briefs.
    try {
      const brief = await runResearch(deal)
      if (brief) written += 1
    } catch (err) {
      console.error(`[${WORKER}] ${deal.name} failed`, err)
    }
  }
  console.info(`[${WORKER}] wrote ${written} brief(s)`)
  return { written }
}
