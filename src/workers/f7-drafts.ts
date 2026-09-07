/**
 * F7 — DRAFTS ENGINE.
 *
 * Trigger: a Draft is requested (by a stage packet, a timer, or a person).
 * Action: Sonnet fills the script-bank template with deal context in the speaker's
 * voice → Haiku checks it (names right? numbers match the record? nothing invented?
 * tone?) → status `proposed`, and a Gmail draft is created for the human to send.
 *
 * The gate is structural: client-facing copy only ever reaches "draft". The single
 * exception in the whole system is the inquiry acknowledgement (F1), which the packet
 * marks `autoSend`.
 */

import { db } from '@/lib/data'
import { complete, GatewayPaused } from '@/lib/gateway'
import { loadTemplate, missingPlaceholders, render } from '@/lib/templates'
import { createGmailDraft } from '@/lib/mailer'
import { notify } from '@/lib/notify'
import { recordEvent, agentActor } from '@/lib/audit'
import { money, shortDate, daysUntil } from '@/lib/format'
import { dealValue } from '@/lib/forecast'
import { speaker } from '~/speaker.config'
import { checkVoice } from '@/lib/voice'
import { resolveSocialProof } from '@/lib/social-proof'
import { priceDeal } from '@/lib/pricing'
import type { CheckerVerdict, Deal, Draft, DraftType } from '@/lib/types'

const WORKER = 'F7'

export interface DraftRequest {
  deal: Deal
  type: DraftType
  templateKey: string
  /** Skips the model and uses the rendered template verbatim. */
  literal?: boolean
  /** Only F1's acknowledgement passes this. */
  autoSend?: boolean
  toEmail?: string | null
}

export async function composeDraft(req: DraftRequest): Promise<Draft> {
  const provider = db()
  // The Airtable table when it has rows, the shipped bank when it does not. Until
  // `loadTemplates` existed this read the bank unconditionally, so the 31 templates
  // seeded into Airtable were never used and editing copy there did nothing.
  const template = await loadTemplate(req.templateKey)
  if (!template) throw new Error(`Unknown template ${req.templateKey}`)

  const values = await templateValues(req.deal)
  const baseSubject = render(template.subject, values)
  const baseBody = render(template.body, values)
  const recipient = req.toEmail ?? (await primaryRecipient(req.deal))

  let subject = baseSubject
  let body = baseBody
  let verdict: CheckerVerdict | null = null

  if (!req.literal) {
    try {
      const written = await complete({
        worker: WORKER,
        task: 'draft',
        dealId: req.deal.id,
        system: voiceSystemPrompt(),
        input: [
          'Rewrite this email so it reads as if the speaker wrote it. Keep every fact exactly as given.',
          'Do not invent names, dates, numbers or commitments. If a placeholder is still unfilled, leave it visible.',
          'Return the subject on the first line prefixed "Subject: ", then a blank line, then the body.',
          '',
          `Deal context: ${JSON.stringify(values)}`,
          '',
          `Draft:\nSubject: ${baseSubject}\n\n${baseBody}`,
        ].join('\n'),
      })
      const parsed = splitSubject(written.text)
      subject = parsed.subject || baseSubject
      body = parsed.body || baseBody
      verdict = await checkDraft({ deal: req.deal, subject, body, values })
    } catch (err) {
      if (err instanceof GatewayPaused) {
        // Cap reached: fall back to the template verbatim rather than dropping the draft.
        verdict = {
          ok: true,
          model: 'template',
          issues: ['Written from the template — the AI cap was reached, so no model pass ran.'],
          checkedAt: new Date().toISOString(),
        }
      } else {
        throw err
      }
    }
  }

  const draft = await provider.createDraft({
    dealId: req.deal.id,
    type: req.type,
    subject,
    body,
    status: 'proposed',
    toEmail: recipient,
    approver: null,
    sentAt: null,
    threadId: null,
    checkerVerdict: verdict,
    revisions: [],
    createdAt: new Date().toISOString(),
  })

  if (req.autoSend && recipient) {
    // The one whitelisted auto-send. Still logged, still auditable.
    const sent = await createGmailDraft({ to: recipient, subject, text: body })
    await provider.updateDraft(draft.id, {
      status: 'sent',
      approver: 'auto',
      sentAt: new Date().toISOString(),
      threadId: sent.threadId,
    })
    await recordEvent({
      table: 'drafts',
      recordId: draft.id,
      what: 'Auto-sent',
      detail: `${req.type} → ${recipient}`,
      actor: agentActor(WORKER),
      source: 'stage-packet',
    })
  } else {
    // Put it in the mailbox as a draft too, so a human can send from Gmail if they prefer.
    if (recipient) {
      try {
        const gmail = await createGmailDraft({ to: recipient, subject, text: body })
        await provider.updateDraft(draft.id, { threadId: gmail.threadId })
      } catch (err) {
        console.warn('[F7] Gmail draft creation failed; the record still exists', err)
      }
    }
    await notify({
      type: 'review-item',
      title: `New ${req.type} draft — ${req.deal.name}`,
      body: subject,
      link: `/queue?draft=${draft.id}`,
      roles: ['ops', 'admin'],
    })
  }

  return draft
}

/** The second, cheaper pass. Structural, not aspirational. */
export async function checkDraft(params: {
  deal: Deal
  subject: string
  body: string
  values: Record<string, string>
}): Promise<CheckerVerdict> {
  const issues: string[] = []

  // Deterministic checks first — cheaper and more reliable than asking a model.
  const unfilled = missingPlaceholders(`${params.subject}\n${params.body}`)
  if (unfilled.length) issues.push(`Unfilled placeholders: ${unfilled.join(', ')}`)

  // The voice pass (WP1.5). Advisory by design: `must` issues are the ones Jordan's
  // acceptance list names and they read as problems; the rest are noted and not argued
  // about, because a checker that blocks drafts teaches people to route around it.
  for (const issue of checkVoice(params.subject, params.body)) {
    issues.push(`${issue.severity === 'must' ? 'Voice' : 'Voice (advisory)'}: ${issue.message}`)
  }

  const fee = dealValue(params.deal)
  if (fee > 0) {
    const numbers = [...params.body.matchAll(/\$\s?([\d,]+)/g)].map((m) =>
      Number(m[1]!.replace(/,/g, '')),
    )
    const wrong = numbers.filter((n) => n >= 1000 && n !== fee)
    if (wrong.length) {
      issues.push(`Money in the copy (${wrong.join(', ')}) does not match the deal fee (${fee}).`)
    }
  }

  try {
    const result = await complete({
      worker: WORKER,
      task: 'check',
      dealId: params.deal.id,
      system:
        'You are a copy checker. You verify emails against a record. You never rewrite; you report.',
      json: true,
      input: [
        'Check this email against the record. Report only real problems.',
        'Look for: wrong or invented names, dates or numbers; claims not present in the record;',
        'a tone that is pushy or obsequious; a missing recipient.',
        '',
        `Record: ${JSON.stringify(params.values)}`,
        `Subject: ${params.subject}`,
        `Body:\n${params.body}`,
        '',
        'Return {"ok": boolean, "issues": string[]}.',
      ].join('\n'),
    })
    const parsed = parseJson<{ ok?: boolean; issues?: string[] }>(result.text)
    if (parsed?.issues?.length) issues.push(...parsed.issues)
    return {
      ok: issues.length === 0,
      model: result.model,
      issues,
      checkedAt: new Date().toISOString(),
    }
  } catch {
    // A failed checker must not block the draft — it downgrades to the deterministic pass.
    issues.push('Automated checker did not run; deterministic checks only.')
    return { ok: false, model: 'none', issues, checkedAt: new Date().toISOString() }
  }
}

export function voiceSystemPrompt(): string {
  return [
    `You write email as ${speaker.speakerName}'s office.`,
    'Plain, warm, direct. Short sentences. No exclamation marks, no superlatives, no "excited to".',
    'Never invent a fact. Never promise anything that is not in the record.',
    'A question you ask should be a real question the reader can answer with one word.',
  ].join(' ')
}

export async function templateValues(deal: Deal): Promise<Record<string, string>> {
  const provider = db()
  const contacts = await provider.listContacts()
  const contact = contacts.find((c) => c.dealIds.includes(deal.id))
  const days = daysUntil(deal.eventDate)
  const proof = await socialProofFor(deal)
  const priced = await priceFor(deal)

  return {
    speakerName: speaker.speakerName,
    eventName: deal.name,
    clientName: deal.client?.name ?? '',
    contactFirstName: contact?.name?.split(/\s+/)[0] ?? '',
    eventDate: shortDate(deal.eventDate),
    holdDate: shortDate(deal.holdDate),
    decisionDate: shortDate(deal.decisionDate),
    location: deal.location ?? '',
    stageTime: deal.stageTime ?? '60-minute',
    audienceProfile: deal.audienceProfile ?? '',
    desiredOutcomes: deal.desiredOutcomes ?? '',
    fee: dealValue(deal) ? money(dealValue(deal)) : '',
    daysToEvent: days === null ? '' : String(days),
    questionnaireLink: process.env.QUESTIONNAIRE_URL ?? '',
    assetsLink: process.env.SPEAKER_ASSETS_URL ?? '',
    overviewLink: process.env.OVERVIEW_URL ?? '',
    reelLink: process.env.REEL_URL ?? '',

    // WP1.5 — the proof block for E01b. Empty when nothing honest could be matched, and
    // `render` leaves an unfilled placeholder visible rather than blanking it, so a
    // reviewer sees the gap instead of a sentence that quietly says less than it looks.
    industryLine: proof.industryLine ?? '',
    relatedClients: proof.relatedClientsLine ?? '',
    testimonial: proof.testimonial?.shortQuote ?? proof.testimonial?.quote ?? '',
    testimonialName: proof.testimonial?.personName ?? '',
    testimonialTitle: [proof.testimonial?.title, proof.testimonial?.company]
      .filter(Boolean)
      .join(', '),

    // WP1.1 — the rate card's number, so a proposal quotes the list price rather than
    // whatever the drafter remembered.
    listFee: priced.listAmount !== null ? money(priced.listAmount) : '',
    travelTerms: priced.travelTerms ?? '',
  }
}

/**
 * The social-proof block for one deal.
 *
 * Resolves against the company's industry, never the deal's, because the industry is a
 * property of who is buying. Failures are swallowed: a first reply that goes out without
 * the proof block is a smaller problem than a first reply that does not go out.
 */
async function socialProofFor(deal: Deal) {
  const empty = { industryLine: null, relatedClientsLine: null, testimonial: null } as const
  try {
    const provider = db()
    const client = deal.client ? await provider.getClient(deal.client.id) : null
    const [clients, testimonials] = await Promise.all([
      provider.listPastClients(),
      provider.listTestimonials(),
    ])
    return resolveSocialProof(
      {
        industry: client?.industry ?? null,
        speakerName: speaker.speakerName,
        virtual: deal.secondaryType === 'virtual',
        excludeCompany: deal.client?.name ?? null,
      },
      { clients, testimonials },
    )
  } catch (err) {
    console.warn('[F7] social proof unavailable:', err)
    return empty
  }
}

/** The rate card's view of this deal. Silent on failure, for the same reason. */
async function priceFor(deal: Deal) {
  try {
    return priceDeal(deal, await db().listRateCards())
  } catch (err) {
    console.warn('[F7] pricing unavailable:', err)
    return { listAmount: null, travelTerms: null } as ReturnType<typeof priceDeal>
  }
}

async function primaryRecipient(deal: Deal): Promise<string | null> {
  const contacts = await db().listContacts()
  const linked = contacts.filter((c) => c.dealIds.includes(deal.id))
  // Bureau deals go through the agent; direct deals go to the decision maker.
  const preferredType = deal.source === 'bureau' ? 'bureau-agent' : 'decision-maker'
  const match =
    linked.find((c) => c.type === preferredType && c.email) ??
    linked.find((c) => c.email) ??
    null
  return match?.email ?? null
}

function splitSubject(text: string): { subject: string; body: string } {
  const match = text.match(/^\s*Subject:\s*(.+?)\s*\n+([\s\S]*)$/)
  if (!match) return { subject: '', body: text.trim() }
  return { subject: match[1]!.trim(), body: match[2]!.trim() }
}

export function parseJson<T>(text: string): T | null {
  const trimmed = text.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
