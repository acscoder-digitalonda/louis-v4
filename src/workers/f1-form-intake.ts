/**
 * F1 — FORM INTAKE.
 *
 * Trigger: the website form posts to /api/intake/form.
 * Action: create the Deal at Inquiry + the Contact (and Client if new), fire the Inquiry
 * packet — which sends the one whitelisted auto-acknowledgement — and notify ops.
 *
 * No AI. A form submission is structured already; asking a model to read it would be
 * cost without benefit.
 */

import { z } from 'zod'
import { db } from '@/lib/data'
import { notify } from '@/lib/notify'
import { agentActor, recordEvent } from '@/lib/audit'
import { invalidateSearchCache } from '@/lib/search'
import { firePacket } from './f5-stage-engine'
import { runResearch } from './f3-research'
import { speaker } from '~/speaker.config'
import type { Deal } from '@/lib/types'

const WORKER = 'F1'

export const formSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email(),
  phone: z.string().max(60).optional(),
  company: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  eventName: z.string().max(200).optional(),
  eventDate: z.string().max(40).optional(),
  location: z.string().max(200).optional(),
  budget: z.string().max(80).optional(),
  message: z.string().max(4000).optional(),
})

export type FormSubmission = z.infer<typeof formSchema>

export async function handleFormSubmission(input: FormSubmission): Promise<Deal> {
  const provider = db()
  const domain = input.email.split('@')[1]?.toLowerCase() ?? null

  // Match an existing company by domain before creating a new one — the same dedupe key
  // the exports use, applied at the front door.
  const clients = await provider.listClients()
  let client =
    clients.find((c) => c.domain && domain && c.domain.toLowerCase() === domain) ??
    (input.company
      ? clients.find((c) => c.name.toLowerCase() === input.company!.toLowerCase())
      : undefined)

  if (!client && (input.company || domain)) {
    client = await provider.createClient({
      name: input.company ?? domain ?? 'Unknown company',
      domain: domain ?? null,
      notes: 'Created from the website form.',
    })
  }

  const dealName = input.eventName
    ? `${client?.name ?? input.company ?? 'Inquiry'} — ${input.eventName}`
    : `${client?.name ?? input.company ?? input.name} — Inquiry`

  const deal = await provider.createDeal({
    name: dealName,
    stage: 'inquiry',
    source: 'direct',
    client: client ? { id: client.id, name: client.name } : null,
    eventDate: normaliseDate(input.eventDate),
    location: input.location ?? null,
    listFee: speaker.fees.defaultList,
    kickoffNotes: [input.message, input.budget ? `Budget signal: ${input.budget}` : null]
      .filter(Boolean)
      .join('\n\n') || null,
    owner: process.env.OPS_EMAIL ?? null,
  })

  const contacts = await provider.listContacts()
  const existing = contacts.find((c) => c.email?.toLowerCase() === input.email.toLowerCase())
  if (existing) {
    await provider.updateContact(existing.id, {
      dealIds: [...new Set([...existing.dealIds, deal.id])],
    })
  } else {
    await provider.createContact({
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      title: input.title ?? null,
      type: 'decision-maker',
      clientId: client?.id ?? null,
      dealIds: [deal.id],
      notes: 'Created from the website form.',
    })
  }

  await recordEvent({
    table: 'deals',
    recordId: deal.id,
    what: 'Created from website form',
    detail: `${input.name} <${input.email}>`,
    actor: agentActor(WORKER),
    source: 'form',
  })

  // The Inquiry packet sends the acknowledgement — the single auto-send in the system.
  await firePacket(deal, { source: 'form' })

  await notify({
    type: 'review-item',
    title: `New inquiry — ${deal.name}`,
    body: [input.name, input.email, input.message].filter(Boolean).join(' · ').slice(0, 500),
    link: `/deals/${deal.id}`,
    roles: ['ops', 'admin'],
  })

  invalidateSearchCache()

  // Research runs behind the response; a slow model must never make the form feel slow.
  void runResearch(deal).catch((err) => console.error('[F1] research kickoff failed', err))

  return deal
}

/** Accepts an ISO date or a loose "July 2026" and stores only what it can trust. */
function normaliseDate(value: string | undefined): string | null {
  if (!value) return null
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/)
  if (iso) return iso[1]!
  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10)
  return null
}
