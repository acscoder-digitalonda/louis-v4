/**
 * The welcome kit — a page the client opens (Gap Analysis §1, "Welcome kit").
 *
 * Rendered live from the deal rather than emailed as a PDF, so it is right when they open
 * it in November rather than right on the day it was sent. The token in the URL is the
 * only credential.
 *
 * ── This is the first public surface in the app, and it is treated like one ─
 *
 * Everything in the base is on one deal record: the negotiated fee, the pricing note Ben
 * wrote for himself, the research brief, the audit trail. A page that renders "the deal"
 * would put all of it in front of a client.
 *
 * So the projection below is an **allowlist**, not a redaction. New fields land on `Deal`
 * regularly; if this file filtered things out, every new field would be public by default
 * and somebody would notice a year later. Naming what goes in means a new field is private
 * until a person decides otherwise.
 *
 * ── The token ──────────────────────────────────────────────────────────────
 *
 * 32 random bytes. Not a secret in the password sense — it is emailed, forwarded, and on
 * a bureau deal an agent passes it to their client — but it is the only thing between a
 * URL and the page, so it has to be unguessable rather than merely opaque.
 */

import { randomBytes } from 'node:crypto'
import type { Deal } from './types'
import { speaker } from '~/speaker.config'

export function issueKitToken(): string {
  return randomBytes(24).toString('base64url')
}

/**
 * Whether the kit may go out yet.
 *
 * The sequence is Closed Won, then contract signed, then invoice shared, then the kit.
 * Sending it earlier is not a small mistake: the kit says "delighted this is happening"
 * to somebody who has not signed anything.
 */
export interface KitReadiness {
  ready: boolean
  /** What is still missing, in the order it has to happen. */
  waitingFor: string[]
}

export function kitReadiness(deal: Pick<Deal, 'stage' | 'contractStatus' | 'paymentStatus'>): KitReadiness {
  const waitingFor: string[] = []
  if (!['closed-won', 'pre-event', 'delivered', 'debriefed'].includes(deal.stage)) {
    waitingFor.push('the deal to reach Closed-Won')
  }
  if (deal.contractStatus !== 'signed') waitingFor.push('the contract to be signed')
  // "Invoice shared" is anything past unbilled: the deposit invoice going out is the
  // trigger, not the money arriving.
  if (deal.paymentStatus === 'unbilled') waitingFor.push('the deposit invoice to go out')
  return { ready: waitingFor.length === 0, waitingFor }
}

/** Who receives the kit. On a bureau deal, automation stops at the agent. */
export function kitRecipient(deal: Pick<Deal, 'source'>): 'client' | 'agent' {
  return deal.source === 'bureau' ? 'agent' : 'client'
}

/**
 * Exactly what the public page may show.
 *
 * An allowlist. Read the header comment before adding anything: the test that guards this
 * asserts a fee never appears, and it asserts it by checking the *shape* of what comes
 * out rather than by looking for a number.
 */
export interface PublicKit {
  speakerName: string
  clientName: string | null
  eventName: string
  eventDate: string | null
  location: string | null
  stageTime: string | null
  avCheckTime: string | null
  eventTimezone: string | null
  kickoffDate: string | null
  audienceProfile: string | null
  desiredOutcomes: string | null
  questionnaireUrl: string | null
  assetsUrl: string | null
  /** For the bureau lane, so the page says who to reply to. */
  throughAgent: boolean
}

export function publicKit(deal: Deal): PublicKit {
  return {
    speakerName: speaker.speakerName,
    clientName: deal.client?.name ?? null,
    eventName: deal.name,
    eventDate: deal.eventDate,
    location: deal.location,
    stageTime: deal.stageTime,
    avCheckTime: deal.avCheckTime,
    eventTimezone: deal.eventTimezone,
    kickoffDate: deal.kickoffDate,
    // The client wrote these about their own event. Showing them back is the point of
    // the page: it says we were listening.
    audienceProfile: deal.audienceProfile,
    desiredOutcomes: deal.desiredOutcomes,
    questionnaireUrl: questionnaireUrlFor(deal),
    assetsUrl: process.env.SPEAKER_ASSETS_URL ?? null,
    throughAgent: kitRecipient(deal) === 'agent',
  }
}

/**
 * The questionnaire, pre-populated.
 *
 * SpeakerOS asks for pre-population and calls it required, for a reason anyone who has
 * filled in a form knows: a questionnaire that opens asking "what is your company called"
 * of somebody who has already told us twice reads as nobody having listened.
 *
 * Airtable forms pre-fill from query parameters named after the field.
 */
export function questionnaireUrlFor(deal: Pick<Deal, 'id' | 'name' | 'client' | 'eventDate'>): string | null {
  const base = process.env.QUESTIONNAIRE_URL
  if (!base) return null
  const params = new URLSearchParams()
  params.set('prefill_Deal', deal.id)
  params.set('prefill_Event', deal.name)
  if (deal.client?.name) params.set('prefill_Company', deal.client.name)
  if (deal.eventDate) params.set('prefill_Event Date', deal.eventDate)
  // Hidden so the person filling it in cannot accidentally repoint it at another deal.
  params.set('hide_Deal', 'true')
  return `${base}${base.includes('?') ? '&' : '?'}${params}`
}
