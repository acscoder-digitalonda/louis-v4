/**
 * F13 — QA SWEEP.
 *
 * Nightly. Finds the things that quietly rot: orphan records, deals with no next task,
 * review items sitting past 48 hours, mirror errors, clients missing the Company Domain
 * that every export dedupes on, and drafts whose checker flagged an issue nobody acted on.
 *
 * The findings are computed deterministically — a date comparison is cheaper and more
 * reliable than asking a model. Haiku is used only to write the digest into a paragraph
 * a human will actually read, and the sweep still reports if that call fails.
 */

import { db } from '@/lib/data'
import { complete } from '@/lib/gateway'
import { notify } from '@/lib/notify'

const WORKER = 'F13'
const STALE_QUEUE_HOURS = 48

export interface Finding {
  kind: string
  detail: string
  link: string | null
}

export interface QaReport {
  findings: Finding[]
  summary: string
}

export async function run(): Promise<QaReport> {
  const provider = db()
  const [deals, tasks, drafts, proposals, clients, contacts, journal, mirror] = await Promise.all([
    provider.listDeals(),
    provider.listTasks(),
    provider.listDrafts({ status: 'proposed' }),
    provider.listProposals('proposed'),
    provider.listClients(),
    provider.listContacts(),
    provider.listJournalOrders(),
    provider.listMirrorState(),
  ])

  const findings: Finding[] = []
  const staleBefore = Date.now() - STALE_QUEUE_HOURS * 3_600_000

  // Deals with nothing queued next — the classic silent stall.
  for (const deal of deals) {
    if (deal.stage === 'dormant' || deal.stage === 'debriefed') continue
    const open = tasks.filter((t) => t.dealId === deal.id && !t.done)
    if (open.length === 0) {
      findings.push({
        kind: 'no-next-task',
        detail: `${deal.name} is in ${deal.stage} with no open task.`,
        link: `/deals/${deal.id}`,
      })
    }
  }

  // Review queue items nobody has touched.
  for (const draft of drafts) {
    if (new Date(draft.createdAt).getTime() < staleBefore) {
      findings.push({
        kind: 'stale-queue',
        detail: `Draft "${draft.subject || draft.type}" has been waiting more than ${STALE_QUEUE_HOURS}h.`,
        link: `/queue?draft=${draft.id}`,
      })
    }
  }
  for (const proposal of proposals) {
    if (new Date(proposal.createdAt).getTime() < staleBefore) {
      findings.push({
        kind: 'stale-queue',
        detail: `Field change on ${proposal.fieldLabel} has been waiting more than ${STALE_QUEUE_HOURS}h.`,
        link: '/queue',
      })
    }
  }

  // Checker flagged, nobody looked.
  for (const draft of drafts) {
    if (draft.checkerVerdict && !draft.checkerVerdict.ok) {
      findings.push({
        kind: 'checker-flag',
        detail: `Draft "${draft.subject || draft.type}": ${draft.checkerVerdict.issues.join(' · ')}`,
        link: `/queue?draft=${draft.id}`,
      })
    }
  }

  // The export dedupe key.
  for (const client of clients) {
    if (!client.domain) {
      findings.push({
        kind: 'missing-domain',
        detail: `${client.name} has no Company Domain — every export dedupes on it.`,
        link: `/crm?view=clients&client=${client.id}`,
      })
    }
  }

  // Orphans: records pointing at nothing, and people linked to nobody.
  const dealIds = new Set(deals.map((d) => d.id))
  for (const task of tasks) {
    if (task.dealId && !dealIds.has(task.dealId)) {
      findings.push({ kind: 'orphan', detail: `Task "${task.title}" points at a missing deal.`, link: null })
    }
  }
  for (const order of journal) {
    if (order.dealId && !dealIds.has(order.dealId)) {
      findings.push({
        kind: 'orphan',
        detail: `Journal order "${order.reference}" points at a missing deal.`,
        link: '/journal',
      })
    }
  }
  for (const contact of contacts) {
    if (!contact.clientId && contact.dealIds.length === 0) {
      findings.push({
        kind: 'orphan',
        detail: `${contact.name} is linked to no company and no deal.`,
        link: `/crm?contact=${contact.id}`,
      })
    }
    if (!contact.email) {
      findings.push({
        kind: 'missing-email',
        detail: `${contact.name} has no email — the contacts export dedupes on it.`,
        link: `/crm?contact=${contact.id}`,
      })
    }
  }

  // Mirror errors.
  for (const state of mirror) {
    if (!state.ok) {
      findings.push({
        kind: 'mirror-error',
        detail: `${state.surface} mirror failed for ${state.entity}: ${state.error ?? 'unknown'}`,
        link: '/settings?tab=mirror',
      })
    }
  }

  const summary = await writeSummary(findings)

  await notify({
    type: 'qa-digest',
    title: findings.length === 0 ? 'QA sweep — all clear' : `QA sweep — ${findings.length} finding(s)`,
    body: [summary, '', ...findings.slice(0, 40).map((f) => `· ${f.detail}`)].join('\n'),
    link: '/settings?tab=mirror',
    roles: ['admin'],
  })

  console.info(`[${WORKER}] ${findings.length} findings`)
  return { findings, summary }
}

async function writeSummary(findings: Finding[]): Promise<string> {
  if (findings.length === 0) return 'Nothing to flag. Every active deal has a next task and the queue is current.'
  const counts = new Map<string, number>()
  for (const f of findings) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1)
  const tally = [...counts.entries()].map(([k, v]) => `${v} ${k}`).join(', ')

  try {
    const result = await complete({
      worker: WORKER,
      task: 'qa',
      system: 'You write a two-sentence morning digest for an operations admin. Plain and specific.',
      input: [
        'Summarise these findings in at most two sentences. Lead with whatever needs a person today.',
        '',
        findings.slice(0, 40).map((f) => `${f.kind}: ${f.detail}`).join('\n'),
      ].join('\n'),
    })
    return result.text.trim() || tally
  } catch {
    // The digest still goes out; it just reads as a tally rather than prose.
    return tally
  }
}
