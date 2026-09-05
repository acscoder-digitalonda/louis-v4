#!/usr/bin/env tsx
/**
 * Demo seed — Jordan's brief, built as data.
 *
 * Seven deals, five clients, eleven contacts, spread across the pipeline so that a
 * walkthrough hits every function: stage packets, timers, the review queue (both lists),
 * red alerts, the journal sidecar, money chips, the audit trail and the cost meter.
 *
 *   npm run seed:demo             # dry run — prints the plan
 *   npm run seed:demo -- --apply  # write it
 *   npm run seed:demo -- --undo   # delete exactly what was written
 *
 * **No mail leaves the machine.** Drafts are written straight into Airtable rather than
 * through `composeDraft`, which is the function that would create a Gmail draft. Every
 * address uses the reserved `.example` TLD, so even a mis-wired worker has nothing to
 * deliver to.
 *
 * Written record ids land in `scripts/demo-seed-ids.json`, so the seed can be removed
 * without touching the sixteen deals migrated from v2 that live in the same base.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fieldRef } from '../src/lib/airtable/fields'
import type { TableKey } from '../src/lib/airtable/schema'
import { createRecords, deleteRecord, readConfig, type AirtableConfig } from '../src/lib/airtable/rest'
import {
  actorKindCodec,
  classificationCodec,
  contactTypeCodec,
  contractStatusCodec,
  draftStatusCodec,
  draftTypeCodec,
  extractionStatusCodec,
  journalStatusCodec,
  notificationTypeCodec,
  paymentRecordStatusCodec,
  paymentStatusCodec,
  proposalStatusCodec,
  stageCodec,
  taskSourceCodec,
} from '../src/lib/data/airtable-codec'

const APPLY = process.argv.includes('--apply')
const UNDO = process.argv.includes('--undo')
const IDS_FILE = join(process.cwd(), 'scripts/demo-seed-ids.json')

const DAY = 86_400_000
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10)
const at = (offset: number) => new Date(Date.now() + offset * DAY).toISOString()

// ── the cast ────────────────────────────────────────────────────────────────
// Three direct clients, two booked through two different bureaus, and one client
// running two events in different cities — the pattern Jordan asked for.

const CLIENTS = [
  {
    key: 'northwind',
    name: 'Northwind Logistics',
    domain: 'northwindlogistics.example',
    industry: 'Transportation & Logistics',
    hq: 'Chicago, IL',
    notes: 'Direct. Two events this year in different regions — Chicago and Reno.',
  },
  {
    key: 'cascade',
    name: 'Cascade Grove Foods',
    domain: 'cascadegrove.example',
    industry: 'Food & Beverage',
    hq: 'Portland, OR',
    notes: 'Direct. Decision date has passed with no reply — the follow-up timer has fired.',
  },
  {
    key: 'bluepeak',
    name: 'Bluepeak Health Alliance',
    domain: 'bluepeakhealth.example',
    industry: 'Healthcare',
    hq: 'Minneapolis, MN',
    notes: 'Direct. Hold placed in July and never moved.',
  },
  {
    key: 'aldergate',
    name: 'Aldergate Financial Group',
    domain: 'aldergate.example',
    industry: 'Financial Services',
    hq: 'Charlotte, NC',
    notes: 'Booked through Summit Stage Speakers. Two engagements: one delivered, one signing.',
  },
  {
    key: 'vantage',
    name: 'Vantage Rail Group',
    domain: 'vantagerail.example',
    industry: 'Rail & Infrastructure',
    hq: 'Kansas City, MO',
    notes: 'Booked through Northlight Talent. Brand-new inquiry.',
  },
] as const

type ClientKey = (typeof CLIENTS)[number]['key']

const DEALS = [
  {
    key: 'vantage-summit',
    client: 'vantage' as ClientKey,
    name: 'Vantage Rail Group — Frontline Leaders Summit',
    stage: 'inquiry' as const,
    source: 'Bureau',
    eventDate: day(146),
    location: 'Kansas City, MO',
    listFee: 35000,
    negotiatedFee: null,
    kickoffNotes:
      'Inbound through the website form. 400 frontline supervisors. Northlight asked for availability across the whole week.',
    demoes: 'form intake · auto-acknowledgement · research brief + checker',
  },
  {
    key: 'cascade-sales',
    client: 'cascade' as ClientKey,
    name: 'Cascade Grove Foods — Regional Managers Meeting',
    stage: 'sales' as const,
    source: 'Direct',
    eventDate: day(96),
    holdDate: day(96),
    decisionDate: day(-3),
    proposalSent: true,
    location: 'Portland, OR',
    listFee: 35000,
    negotiatedFee: 32000,
    kickoffNotes: 'Proposal went out on the call. Rachel said she needed board sign-off.',
    demoes: 'decision date passed → soft follow-up sitting in the review queue',
  },
  {
    key: 'bluepeak-stale',
    client: 'bluepeak' as ClientKey,
    name: 'Bluepeak Health Alliance — Nursing Leadership Forum',
    stage: 'sales' as const,
    source: 'Direct',
    eventDate: day(131),
    holdDate: day(-24),
    location: 'Minneapolis, MN',
    listFee: 35000,
    negotiatedFee: 29500,
    kickoffNotes: 'Hold placed in July. Two chase calls, no reply. Another enquiry is asking about the same week.',
    demoes: 'stale hold → red alert + forcing email in the queue',
  },
  {
    key: 'aldergate-signing',
    client: 'aldergate' as ClientKey,
    name: 'Aldergate Financial Group — Advisor Kickoff',
    stage: 'closed-won' as const,
    source: 'Bureau',
    eventDate: day(78),
    location: 'Charlotte, NC',
    listFee: 40000,
    negotiatedFee: 38000,
    contractStatus: 'out' as const,
    paymentStatus: 'invoiced' as const,
    kickoffNotes: 'Contract out with Aldergate legal. Deposit invoice raised; the bank feed has a candidate match.',
    demoes: 'welcome kit already sent · proposed payment awaiting human confirmation',
  },
  {
    key: 'northwind-chicago',
    client: 'northwind' as ClientKey,
    name: 'Northwind Logistics — Safety Leadership Summit (Chicago)',
    stage: 'pre-event' as const,
    source: 'Direct',
    eventDate: day(11),
    location: 'Chicago, IL',
    listFee: 38000,
    negotiatedFee: 36000,
    contractStatus: 'signed' as const,
    paymentStatus: 'partial' as const,
    questionnaireReceived: true,
    avCheckTime: '7:30 AM CT, Grand Ballroom',
    stageTime: '9:00 AM CT, 50 min + 10 Q&A',
    hotel: 'Hyatt Regency — conf #NW88231',
    audienceProfile:
      '620 dispatchers, terminal managers and safety leads. Two years into a zero-incident push that has plateaued.',
    desiredOutcomes: 'Everyone leaves with one personal commitment. Reconnect safety with why people do the work.',
    demoes: 'T-11 red alert · questionnaire in · journal sidecar · AV-time conflict proposal',
  },
  {
    key: 'northwind-reno',
    client: 'northwind' as ClientKey,
    name: 'Northwind Logistics — Safety Leadership Summit (Reno)',
    stage: 'pre-event' as const,
    source: 'Direct',
    eventDate: day(25),
    location: 'Reno, NV',
    listFee: 38000,
    negotiatedFee: 34000,
    contractStatus: 'signed' as const,
    paymentStatus: 'partial' as const,
    questionnaireReceived: true,
    avCheckTime: '8:00 AM PT, Silver Hall',
    stageTime: '9:30 AM PT, 50 min + 10 Q&A',
    audienceProfile: 'Same programme, western region. 380 people, heavier on long-haul drivers.',
    demoes: 'the second event for the same client, different city',
  },
  {
    key: 'aldergate-delivered',
    client: 'aldergate' as ClientKey,
    name: 'Aldergate Financial Group — Partner Retreat',
    stage: 'delivered' as const,
    source: 'Bureau',
    eventDate: day(-9),
    location: 'Asheville, NC',
    listFee: 40000,
    negotiatedFee: 40000,
    contractStatus: 'signed' as const,
    paymentStatus: 'paid' as const,
    questionnaireReceived: true,
    postKeynoteNotes:
      'Standing ovation. Elena asked about running the same session for the advisor network in Q2. Journal came up twice in the room.',
    demoes: 'delivered · debrief + testimonial draft waiting · paid in full',
  },
] as const

type DealKey = (typeof DEALS)[number]['key']

/** Eleven contacts, each attached to a deal with a job to do. */
const CONTACTS = [
  {
    name: 'Marguerite Vaillancourt',
    email: 'marguerite@summitstage.example',
    phone: '+1 704 555 0148',
    type: 'bureau-agent' as const,
    title: 'Senior Agent',
    agency: 'Summit Stage Speakers',
    keyAgent: true,
    client: null,
    deals: ['aldergate-signing', 'aldergate-delivered'] as DealKey[],
    notes: 'Books two to three a year. Flagged Key Agent — her mail forwards to Ben on arrival.',
  },
  {
    name: 'Dev Ramanathan',
    email: 'dev@northlighttalent.example',
    phone: '+1 816 555 0192',
    type: 'bureau-agent' as const,
    title: 'Talent Agent',
    agency: 'Northlight Talent',
    keyAgent: false,
    client: null,
    deals: ['vantage-summit'] as DealKey[],
    notes: 'Brought the Vantage inquiry in. First time working with us.',
  },
  {
    name: 'Priya Kelleher',
    email: 'pkelleher@northwindlogistics.example',
    phone: '+1 312 555 0117',
    type: 'meeting-planner' as const,
    title: 'Director of Events',
    agency: null,
    keyAgent: false,
    client: 'northwind' as ClientKey,
    deals: ['northwind-chicago', 'northwind-reno'] as DealKey[],
    notes: 'Runs both summits. One person, two deals — the CRM links her to each.',
  },
  {
    name: 'Tomas Okafor',
    email: 'tokafor@northwindlogistics.example',
    phone: '+1 775 555 0131',
    type: 'onsite' as const,
    title: 'Regional Safety Manager',
    agency: null,
    keyAgent: false,
    client: 'northwind' as ClientKey,
    deals: ['northwind-reno'] as DealKey[],
    notes: 'Day-of contact in Reno only. Priya is not travelling to that one.',
  },
  {
    name: 'Rachel Lindqvist',
    email: 'rlindqvist@cascadegrove.example',
    phone: '+1 503 555 0164',
    type: 'decision-maker' as const,
    title: 'VP People & Culture',
    agency: null,
    keyAgent: false,
    client: 'cascade' as ClientKey,
    deals: ['cascade-sales'] as DealKey[],
    notes: 'Holds the budget. The decision date on the deal is hers, and it has passed.',
  },
  {
    name: 'Marcus Feldt',
    email: 'mfeldt@cascadegrove.example',
    phone: '+1 503 555 0166',
    type: 'meeting-planner' as const,
    title: 'Events Coordinator',
    agency: null,
    keyAgent: false,
    client: 'cascade' as ClientKey,
    deals: ['cascade-sales'] as DealKey[],
    notes: 'Handles logistics once Rachel signs off. Copied on the follow-up.',
  },
  {
    name: 'Sofia Brandt-Aguilar',
    email: 'sbrandt@bluepeakhealth.example',
    phone: '+1 612 555 0179',
    type: 'decision-maker' as const,
    title: 'Chief Nursing Officer',
    agency: null,
    keyAgent: false,
    client: 'bluepeak' as ClientKey,
    deals: ['bluepeak-stale'] as DealKey[],
    notes: 'Went quiet after the hold. The forcing email is addressed to her.',
  },
  {
    name: 'Jonah Whitlock',
    email: 'jwhitlock@aldergate.example',
    phone: '+1 704 555 0155',
    type: 'meeting-planner' as const,
    title: 'Head of Internal Events',
    agency: null,
    keyAgent: false,
    client: 'aldergate' as ClientKey,
    deals: ['aldergate-signing'] as DealKey[],
    notes: 'Received the welcome kit and the questionnaire link.',
  },
  {
    name: 'Elena Sokolova',
    email: 'esokolova@aldergate.example',
    phone: '+1 704 555 0158',
    type: 'decision-maker' as const,
    title: 'Managing Partner',
    agency: null,
    keyAgent: false,
    client: 'aldergate' as ClientKey,
    deals: ['aldergate-delivered'] as DealKey[],
    notes: 'Asked about a Q2 repeat in the room. The debrief draft is addressed to her.',
  },
  {
    name: 'Nadia El-Amin',
    email: 'nelamin@vantagerail.example',
    phone: '+1 816 555 0143',
    type: 'decision-maker' as const,
    title: 'SVP Operations',
    agency: null,
    keyAgent: false,
    client: 'vantage' as ClientKey,
    deals: ['vantage-summit'] as DealKey[],
    notes: 'Submitted the website form. Received the automatic acknowledgement.',
  },
  {
    name: 'Grady Mulholland',
    email: 'gmulholland@vantagerail.example',
    phone: '+1 816 555 0147',
    type: 'onsite' as const,
    title: 'Terminal Operations Lead',
    agency: null,
    keyAgent: false,
    client: 'vantage' as ClientKey,
    deals: ['vantage-summit'] as DealKey[],
    notes: 'Named on the form as the on-the-ground contact if it goes ahead.',
  },
]

// ── writing ─────────────────────────────────────────────────────────────────

type Ids = Partial<Record<TableKey, string[]>>

function row(table: TableKey, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue
    out[fieldRef(table, key)] = value
  }
  return out
}

async function seed(cfg: AirtableConfig) {
  const ids: Ids = {}
  const track = (table: TableKey, created: { id: string }[]) => {
    ids[table] = [...(ids[table] ?? []), ...created.map((r) => r.id)]
    return created.map((r) => r.id)
  }

  // Clients
  const clientRows = CLIENTS.map((c) =>
    row('clients', {
      name: c.name,
      domain: c.domain,
      industry: c.industry,
      hq: c.hq,
      notes: c.notes,
    }),
  )
  const clientIds = track('clients', await createRecords(cfg, 'clients', clientRows))
  const clientId = (key: ClientKey) => clientIds[CLIENTS.findIndex((c) => c.key === key)]!
  console.info(`  Clients        ${clientIds.length}`)

  // Deals
  const dealRows = DEALS.map((d) =>
    row('deals', {
      name: d.name,
      stage: stageCodec.toAirtable(d.stage),
      source: d.source,
      dealType: 'Keynote',
      client: [clientId(d.client)],
      owner: process.env.OPS_EMAIL ?? null,
      listFee: d.listFee,
      negotiatedFee: 'negotiatedFee' in d ? d.negotiatedFee : null,
      holdDate: 'holdDate' in d ? d.holdDate : null,
      decisionDate: 'decisionDate' in d ? d.decisionDate : null,
      proposalSent: 'proposalSent' in d ? d.proposalSent : false,
      eventDate: d.eventDate,
      location: d.location,
      avCheckTime: 'avCheckTime' in d ? d.avCheckTime : null,
      stageTime: 'stageTime' in d ? d.stageTime : null,
      questionnaireReceived: 'questionnaireReceived' in d ? d.questionnaireReceived : false,
      audienceProfile: 'audienceProfile' in d ? d.audienceProfile : null,
      desiredOutcomes: 'desiredOutcomes' in d ? d.desiredOutcomes : null,
      kickoffNotes: 'kickoffNotes' in d ? d.kickoffNotes : null,
      postKeynoteNotes: 'postKeynoteNotes' in d ? d.postKeynoteNotes : null,
      hotel: 'hotel' in d ? d.hotel : null,
      logisticsComplete: false,
      // These are single-selects today and rollups in the production design. Seeding
      // them keeps the money chips honest in the demo; converting them to rollups is
      // the documented next step.
      paymentStatus: 'paymentStatus' in d ? paymentStatusCodec.toAirtable(d.paymentStatus) : null,
      contractStatus: 'contractStatus' in d ? contractStatusCodec.toAirtable(d.contractStatus) : null,
    }),
  )
  const dealIds = track('deals', await createRecords(cfg, 'deals', dealRows))
  const dealId = (key: DealKey) => dealIds[DEALS.findIndex((d) => d.key === key)]!
  console.info(`  Deals          ${dealIds.length}`)

  // Contacts
  const contactRows = CONTACTS.map((c) =>
    row('contacts', {
      name: c.name,
      email: c.email,
      phone: c.phone,
      type: contactTypeCodec.toAirtable(c.type),
      title: c.title,
      agency: c.agency,
      keyAgent: c.keyAgent,
      clientId: c.client ? [clientId(c.client)] : null,
      dealIds: c.deals.map(dealId),
      notes: c.notes,
    }),
  )
  console.info(`  Contacts       ${track('contacts', await createRecords(cfg, 'contacts', contactRows)).length}`)

  // Drafts — what has already gone out, and what is waiting for a human.
  const drafts = [
    {
      deal: 'vantage-summit' as DealKey,
      type: 'ack' as const,
      status: 'sent' as const,
      to: 'nelamin@vantagerail.example',
      sentAt: at(-2),
      subject: 'Thanks for reaching out about the Frontline Leaders Summit',
      body: `Hi Nadia,\n\nThank you for getting in touch about the Frontline Leaders Summit. I have your details and will come back to you within one business day with availability and next steps.\n\nBest,\nThe Ben Nemtin team`,
      verdict: { ok: true, issues: [] },
    },
    {
      deal: 'cascade-sales' as DealKey,
      type: 'follow-up' as const,
      status: 'proposed' as const,
      to: 'rlindqvist@cascadegrove.example',
      subject: 'Checking in — Regional Managers Meeting',
      body: `Hi Rachel,\n\nJust a short note to check in on the Regional Managers Meeting. We are still holding the date, and I wanted to make sure you have everything you need for the board conversation.\n\nAnything I can answer?\n\nBest,\nBen`,
      verdict: { ok: true, issues: [] },
    },
    {
      deal: 'bluepeak-stale' as DealKey,
      type: 'forcing' as const,
      status: 'proposed' as const,
      to: 'sbrandt@bluepeakhealth.example',
      subject: 'Should we release the hold?',
      body: `Hi Sofia,\n\nWe have been holding the week for the Nursing Leadership Forum. Another enquiry has come in for the same dates, so before I let them go I wanted to check whether this is still live on your side.\n\nA yes, a no, or a "not yet" are all genuinely useful — I would rather know than guess.\n\nBest,\nBen`,
      verdict: { ok: true, issues: [] },
    },
    {
      deal: 'aldergate-signing' as DealKey,
      type: 'kit' as const,
      status: 'sent' as const,
      to: 'jwhitlock@aldergate.example',
      sentAt: at(-6),
      subject: 'Welcome aboard — a few things for the Advisor Kickoff',
      body: `Hi Jonah,\n\nDelighted this is happening. Three things to get us moving:\n\n1. The questionnaire — it takes about ten minutes and shapes the whole session.\n2. Speaker assets (bio, headshots, AV rider).\n3. A planning call about four weeks out.\n\nWe will take care of the rest.\n\nBest,\nThe Ben Nemtin team`,
      verdict: { ok: true, issues: [] },
    },
    {
      deal: 'northwind-chicago' as DealKey,
      type: 'chase' as const,
      status: 'sent' as const,
      to: 'pkelleher@northwindlogistics.example',
      sentAt: at(-4),
      subject: 'Quick nudge — run-of-show for Chicago',
      body: `Hi Priya,\n\nWe are eleven days out and I do not have the run-of-show yet. It is the last piece we need to lock the AV window.\n\nBest,\nThe Ben Nemtin team`,
      verdict: { ok: true, issues: [] },
    },
    {
      deal: 'aldergate-delivered' as DealKey,
      type: 'debrief' as const,
      status: 'proposed' as const,
      to: 'esokolova@aldergate.example',
      subject: 'Thank you — and one small ask',
      body: `Hi Elena,\n\nThank you for having me at the Partner Retreat. The room was generous and the questions were excellent.\n\nIf the session landed, a short testimonial would mean a great deal — two or three sentences is plenty.\n\nAnd you mentioned a Q2 session for the advisor network; I would love to talk about it whenever suits.\n\nBest,\nBen`,
      verdict: { ok: true, issues: [] },
    },
    {
      deal: 'northwind-reno' as DealKey,
      type: 'chase' as const,
      status: 'proposed' as const,
      to: 'tokafor@northwindlogistics.example',
      subject: 'Reno — AV window and onsite contact',
      body: `Hi Tomas,\n\nAhead of Reno I want to confirm the AV check window and who I should look for on the morning.\n\nBest,\nThe Ben Nemtin team`,
      // A flagged draft, so the checker's warning is visible in the queue.
      verdict: {
        ok: false,
        issues: ['Stage time is not set on the deal — confirm the slot before sending.'],
      },
    },
  ]

  const draftRows = drafts.map((d) =>
    row('drafts', {
      dealId: [dealId(d.deal)],
      type: draftTypeCodec.toAirtable(d.type),
      subject: d.subject,
      body: d.body,
      status: draftStatusCodec.toAirtable(d.status),
      toEmail: d.to,
      approver: d.status === 'sent' ? (d.type === 'ack' ? 'auto' : 'liezel@bennemtin.com') : null,
      sentAt: 'sentAt' in d ? d.sentAt : null,
      checkerVerdict: JSON.stringify({
        ...d.verdict,
        model: 'claude-haiku-4-5',
        checkedAt: at(-1),
      }),
      revisions: JSON.stringify([]),
    }),
  )
  console.info(`  Drafts         ${track('drafts', await createRecords(cfg, 'drafts', draftRows)).length}`)

  // Tasks — what each stage packet left behind.
  const tasks = [
    { deal: 'vantage-summit' as DealKey, title: 'Review research brief and qualify', due: day(1), stage: 'inquiry' as const, source: 'stage-packet' as const, done: false },
    { deal: 'cascade-sales' as DealKey, title: 'Follow up — decision date passed', due: day(0), stage: 'sales' as const, source: 'timer' as const, done: false },
    { deal: 'cascade-sales' as DealKey, title: 'Send proposal', due: day(-12), stage: 'sales' as const, source: 'stage-packet' as const, done: true },
    { deal: 'bluepeak-stale' as DealKey, title: 'Decide whether to release the hold', due: day(1), stage: 'sales' as const, source: 'timer' as const, done: false },
    { deal: 'aldergate-signing' as DealKey, title: 'Chase countersigned contract', due: day(2), stage: 'closed-won' as const, source: 'stage-packet' as const, done: false },
    { deal: 'aldergate-signing' as DealKey, title: 'Invoice the deposit', due: day(-3), stage: 'closed-won' as const, source: 'stage-packet' as const, done: true },
    { deal: 'northwind-chicago' as DealKey, title: 'Chase run-of-show from Priya', due: day(1), stage: 'pre-event' as const, source: 'stage-packet' as const, done: false },
    { deal: 'northwind-chicago' as DealKey, title: 'Book ground transport ORD → hotel', due: day(3), stage: 'pre-event' as const, source: 'stage-packet' as const, done: false },
    { deal: 'northwind-chicago' as DealKey, title: 'Confirm AV check window with the venue', due: day(-1), stage: 'pre-event' as const, source: 'stage-packet' as const, done: true },
    { deal: 'northwind-reno' as DealKey, title: 'Book travel and hotel', due: day(6), stage: 'pre-event' as const, source: 'stage-packet' as const, done: false },
    { deal: 'northwind-reno' as DealKey, title: 'Confirm journal quantities with the warehouse', due: day(4), stage: 'pre-event' as const, source: 'timer' as const, done: false },
    { deal: 'aldergate-delivered' as DealKey, title: 'Send debrief + testimonial ask', due: day(-2), stage: 'delivered' as const, source: 'stage-packet' as const, done: false },
    { deal: 'aldergate-delivered' as DealKey, title: 'Write post-keynote notes', due: day(-7), stage: 'delivered' as const, source: 'stage-packet' as const, done: true },
  ]
  const taskRows = tasks.map((t) =>
    row('tasks', {
      dealId: [dealId(t.deal)],
      title: t.title,
      assignee: process.env.OPS_EMAIL ?? 'liezel@bennemtin.example',
      dueDate: t.due,
      stage: stageCodec.toAirtable(t.stage),
      source: taskSourceCodec.toAirtable(t.source),
      done: t.done,
    }),
  )
  console.info(`  Tasks          ${track('tasks', await createRecords(cfg, 'tasks', taskRows)).length}`)

  // Emails — the raw material behind the field-change proposal.
  const emails = [
    {
      deal: 'northwind-chicago' as DealKey,
      from: 'pkelleher@northwindlogistics.example',
      subject: 'Re: run of show — AV moved earlier',
      classification: 'update' as const,
    },
    {
      deal: 'vantage-summit' as DealKey,
      from: 'dev@northlighttalent.example',
      subject: 'Speaking enquiry — Vantage Rail, frontline summit',
      classification: 'inquiry' as const,
    },
  ]
  const emailRows = emails.map((e, i) =>
    row('emails', {
      dealId: [dealId(e.deal)],
      from: e.from,
      to: 'ops@bennemtin.example',
      subject: e.subject,
      threadId: `demo-thread-${i + 1}`,
      receivedAt: at(-2),
      classification: classificationCodec.toAirtable(e.classification),
      extractionStatus: extractionStatusCodec.toAirtable('extracted'),
    }),
  )
  const emailIds = track('emails', await createRecords(cfg, 'emails', emailRows))
  console.info(`  Emails         ${emailIds.length}`)

  // Field proposals — the second half of the review queue.
  const proposalRows = [
    row('proposals', {
      dealId: [dealId('northwind-chicago')],
      field: 'avCheckTime',
      fieldLabel: 'AV Check Time',
      oldValue: '7:30 AM CT, Grand Ballroom',
      newValue: '7:00 AM CT, Grand Ballroom',
      sourceEmailId: [emailIds[0]!],
      status: proposalStatusCodec.toAirtable('proposed'),
      confidence: 0.94,
    }),
    row('proposals', {
      dealId: [dealId('cascade-sales')],
      field: 'negotiatedFee',
      fieldLabel: 'Negotiated Fee',
      oldValue: '32000',
      newValue: '30000',
      status: proposalStatusCodec.toAirtable('proposed'),
      confidence: 0.68,
    }),
  ]
  console.info(`  Proposals      ${track('proposals', await createRecords(cfg, 'proposals', proposalRows)).length}`)

  // Journal sidecar.
  const journalRows = [
    row('journalOrders', {
      reference: 'Northwind Chicago — promo copies',
      status: journalStatusCodec.toAirtable('promo-sent'),
      quantity: 6,
      shipTo: 'Priya Kelleher, Northwind Logistics, Chicago IL',
      shipByDate: day(-18),
      inserts: false,
      dealId: [dealId('northwind-chicago')],
      clientId: [clientId('northwind')],
      warehouseNotes: 'Signed copies for the planning team.',
    }),
    row('journalOrders', {
      reference: 'Northwind Chicago — bulk for attendees',
      status: journalStatusCodec.toAirtable('interested'),
      quantity: 620,
      shipTo: 'Northwind Logistics receiving dock, Chicago IL',
      shipByDate: day(4),
      inserts: true,
      dealId: [dealId('northwind-chicago')],
      clientId: [clientId('northwind')],
      warehouseNotes: 'Needs inserts. Confirm the number before the print run — the T-35 nudge has fired.',
    }),
    row('journalOrders', {
      reference: 'Aldergate retreat — post-event dropship',
      status: journalStatusCodec.toAirtable('bulk-ordered'),
      quantity: 180,
      shipTo: 'Individual partner addresses (CSV supplied)',
      shipByDate: day(9),
      inserts: true,
      dealId: [dealId('aldergate-delivered')],
      clientId: [clientId('aldergate')],
      warehouseNotes: 'Dropship run following the retreat.',
    }),
  ]
  console.info(`  Journal        ${track('journalOrders', await createRecords(cfg, 'journalOrders', journalRows)).length}`)

  // Money.
  const paymentRows = [
    row('payments', {
      dealId: [dealId('northwind-chicago')],
      invoiceNumber: 'INV-2026-118',
      amount: 18000,
      status: paymentRecordStatusCodec.toAirtable('confirmed'),
      method: 'ACH',
      receivedDate: day(-22),
      confirmedBy: 'liezel@bennemtin.example',
      note: 'Deposit, Chicago.',
    }),
    row('payments', {
      dealId: [dealId('northwind-reno')],
      invoiceNumber: 'INV-2026-119',
      amount: 17000,
      status: paymentRecordStatusCodec.toAirtable('confirmed'),
      method: 'ACH',
      receivedDate: day(-22),
      confirmedBy: 'liezel@bennemtin.example',
      note: 'Deposit, Reno.',
    }),
    row('payments', {
      dealId: [dealId('aldergate-delivered')],
      invoiceNumber: 'INV-2026-104',
      amount: 40000,
      status: paymentRecordStatusCodec.toAirtable('confirmed'),
      method: 'Wire',
      receivedDate: day(-5),
      confirmedBy: 'liezel@bennemtin.example',
      note: 'Paid in full after the retreat.',
    }),
    row('payments', {
      dealId: [dealId('aldergate-signing')],
      invoiceNumber: 'INV-2026-131',
      amount: 19000,
      // Left unconfirmed on purpose: this is the human-confirms-payments demo.
      status: paymentRecordStatusCodec.toAirtable('proposed'),
      method: 'ACH',
      receivedDate: day(-1),
      note: 'Matched on invoice number and amount by the bank feed. Awaiting human confirmation.',
    }),
  ]
  console.info(`  Payments       ${track('payments', await createRecords(cfg, 'payments', paymentRows)).length}`)

  const legRows = [
    row('scheduleLegs', { dealId: [dealId('northwind-chicago')], label: 'Deposit 50%', amount: 18000, dueDate: day(-25), paid: true }),
    row('scheduleLegs', { dealId: [dealId('northwind-chicago')], label: 'Balance', amount: 18000, dueDate: day(11), paid: false }),
    row('scheduleLegs', { dealId: [dealId('northwind-reno')], label: 'Deposit 50%', amount: 17000, dueDate: day(-25), paid: true }),
    row('scheduleLegs', { dealId: [dealId('northwind-reno')], label: 'Balance', amount: 17000, dueDate: day(25), paid: false }),
    row('scheduleLegs', { dealId: [dealId('aldergate-signing')], label: 'Deposit 50%', amount: 19000, dueDate: day(2), paid: false }),
    row('scheduleLegs', { dealId: [dealId('aldergate-signing')], label: 'Balance', amount: 19000, dueDate: day(78), paid: false }),
  ]
  console.info(`  Schedule Legs  ${track('scheduleLegs', await createRecords(cfg, 'scheduleLegs', legRows)).length}`)

  // Research brief — F3's output, with its checker verdict.
  const briefRows = [
    row('researchBriefs', {
      dealId: [dealId('vantage-summit')],
      companyFacts:
        'Vantage Rail Group operates regional freight across eight states, roughly 4,000 employees. Public safety record improved two years running, then flattened.',
      mvv: 'Stated values: "Everyone home safe, every day." Safety is the organising idea of the whole business.',
      budgetSignals:
        'Ran a comparable summit last year with an external keynote. Northlight indicated a mid-five-figure range.',
      notes: 'Northlight is a first-time bureau for us — worth confirming commission terms before the proposal.',
      sources: 'https://vantagerail.example/about\nhttps://vantagerail.example/safety-report-2025',
      model: 'claude-sonnet-5',
      checkedBy: 'claude-haiku-4-5',
      checkerVerdict: JSON.stringify({
        ok: false,
        model: 'claude-haiku-4-5',
        issues: ['Budget range is second-hand from the agent — no source link. Treat as unverified.'],
        checkedAt: at(-2),
      }),
    }),
  ]
  console.info(`  Research       ${track('researchBriefs', await createRecords(cfg, 'researchBriefs', briefRows)).length}`)

  // Notifications — what the bell shows.
  const notifRows = [
    row('notifications', {
      user: process.env.OPS_EMAIL ?? 'liezel@bennemtin.example',
      type: notificationTypeCodec.toAirtable('red-alert'),
      title: 'Logistics incomplete at T-11 — Northwind Chicago',
      body: 'Run-of-show and ground transport are still open.',
      link: `/deals/${dealId('northwind-chicago')}?tab=logistics`,
      read: false,
      emailed: true,
    }),
    row('notifications', {
      user: process.env.OPS_EMAIL ?? 'liezel@bennemtin.example',
      type: notificationTypeCodec.toAirtable('red-alert'),
      title: 'Hold going stale — Bluepeak Health Alliance',
      body: 'The hold was placed 24 days ago with no movement. Release it or force a decision.',
      link: `/deals/${dealId('bluepeak-stale')}?tab=sales`,
      read: false,
      emailed: true,
    }),
    row('notifications', {
      user: process.env.OPS_EMAIL ?? 'liezel@bennemtin.example',
      type: notificationTypeCodec.toAirtable('review-item'),
      title: 'AV Check Time conflict — Northwind Chicago',
      body: '7:30 AM CT → 7:00 AM CT, from Priya Kelleher’s email.',
      link: '/queue',
      read: false,
      emailed: false,
    }),
    row('notifications', {
      user: process.env.ADMIN_EMAIL ?? 'team@digitalonda.com',
      type: notificationTypeCodec.toAirtable('qa-digest'),
      title: 'QA sweep — 3 findings',
      body: '1 draft flagged by the checker · 1 stale queue item · 1 client missing Company Domain.',
      link: '/settings?tab=mirror',
      read: false,
      emailed: true,
    }),
  ]
  console.info(`  Notifications  ${track('notifications', await createRecords(cfg, 'notifications', notifRows)).length}`)

  // Audit trail — a few entries so Activity has a story.
  const auditRows = [
    row('auditLog', {
      entity: 'deals',
      entityId: dealId('northwind-chicago'),
      field: 'Hotel',
      oldValue: null,
      newValue: 'Hyatt Regency — conf #NW88231',
      actor: 'agent:F2',
      actorKind: actorKindCodec.toAirtable('agent'),
      source: emailIds[0]!,
      at: at(-2),
      reversible: true,
    }),
    row('auditLog', {
      entity: 'deals',
      entityId: dealId('aldergate-signing'),
      field: 'Stage',
      oldValue: 'Sales',
      newValue: 'Closed-Won',
      actor: 'liezel@bennemtin.example',
      actorKind: actorKindCodec.toAirtable('human'),
      at: at(-6),
      reversible: true,
    }),
    row('auditLog', {
      entity: 'drafts',
      entityId: dealId('vantage-summit'),
      field: 'Auto-sent',
      newValue: 'ack → nelamin@vantagerail.example',
      actor: 'agent:F1',
      actorKind: actorKindCodec.toAirtable('agent'),
      source: 'form',
      at: at(-2),
      reversible: false,
    }),
    row('auditLog', {
      entity: 'deals',
      entityId: dealId('aldergate-delivered'),
      field: 'Stage',
      oldValue: 'Pre-Event',
      newValue: 'Delivered',
      actor: 'liezel@bennemtin.example',
      actorKind: actorKindCodec.toAirtable('human'),
      at: at(-9),
      reversible: true,
    }),
  ]
  console.info(`  Audit Log      ${track('auditLog', await createRecords(cfg, 'auditLog', auditRows)).length}`)

  // Usage log — so the cost meter has bars rather than an empty state.
  const usage = [
    { worker: 'F2', task: 'classify', tier: 'haiku', model: 'claude-haiku-4-5', tin: 1420, tout: 38, days: -2 },
    { worker: 'F2', task: 'extract', tier: 'sonnet', model: 'claude-sonnet-5', tin: 3180, tout: 260, days: -2 },
    { worker: 'F3', task: 'research', tier: 'sonnet', model: 'claude-sonnet-5', tin: 2100, tout: 900, days: -2 },
    { worker: 'F3', task: 'check', tier: 'haiku', model: 'claude-haiku-4-5', tin: 1100, tout: 120, days: -2 },
    { worker: 'F7', task: 'draft', tier: 'sonnet', model: 'claude-sonnet-5', tin: 1800, tout: 420, days: -1 },
    { worker: 'F7', task: 'check', tier: 'haiku', model: 'claude-haiku-4-5', tin: 900, tout: 90, days: -1 },
    { worker: 'F13', task: 'qa', tier: 'haiku', model: 'claude-haiku-4-5', tin: 2400, tout: 180, days: 0 },
  ]
  const usageRows = usage.map((u) => {
    const price = u.tier === 'haiku' ? { i: 1, o: 5 } : { i: 3, o: 15 }
    return row('usageLog', {
      at: at(u.days),
      worker: u.worker,
      task: u.task,
      model: u.model,
      tier: u.tier,
      tokensIn: u.tin,
      tokensOut: u.tout,
      estCost: Math.round(((u.tin / 1e6) * price.i + (u.tout / 1e6) * price.o) * 1e6) / 1e6,
      backend: 'claude-code',
      durationMs: 1200 + u.tout,
      ok: true,
      estimated: true,
    })
  })
  console.info(`  Usage Log      ${track('usageLog', await createRecords(cfg, 'usageLog', usageRows)).length}`)

  writeFileSync(IDS_FILE, `${JSON.stringify(ids, null, 2)}\n`)
  const total = Object.values(ids).reduce((s, list) => s + list.length, 0)
  console.info(`\nWrote ${total} record(s). Ids saved to scripts/demo-seed-ids.json`)
  console.info('Remove them all with:  npm run seed:demo -- --undo')
}

async function undo(cfg: AirtableConfig) {
  if (!existsSync(IDS_FILE)) throw new Error('No demo-seed-ids.json — nothing recorded to undo.')
  const ids = JSON.parse(readFileSync(IDS_FILE, 'utf8')) as Ids
  // Reverse order so links are removed before their targets.
  const tables = Object.keys(ids).reverse() as TableKey[]
  let removed = 0
  for (const table of tables) {
    for (const id of ids[table] ?? []) {
      try {
        await deleteRecord(cfg, table, id)
        removed += 1
      } catch (err) {
        console.warn(`  ! ${table}/${id}: ${err instanceof Error ? err.message : err}`)
      }
    }
    console.info(`  ${table} cleared`)
  }
  writeFileSync(IDS_FILE, '{}\n')
  console.info(`\nRemoved ${removed} record(s). The migrated v2 data was not touched.`)
}

function plan() {
  console.info('Demo seed plan — Jordan\'s brief\n')
  console.info(`  ${CLIENTS.length} clients · ${DEALS.length} deals · ${CONTACTS.length} contacts`)
  console.info(`  ${CLIENTS.filter((c) => c.key !== 'aldergate' && c.key !== 'vantage').length} direct clients, 2 booked through 2 bureaus\n`)
  for (const d of DEALS) {
    console.info(`  ${stageCodec.toAirtable(d.stage).padEnd(12)} ${d.name}`)
    console.info(`  ${''.padEnd(12)} → ${d.demoes}`)
  }
  console.info('\n  Northwind Logistics runs two of the seven, in Chicago and Reno.')
  console.info('  Every address uses the reserved .example TLD — nothing is deliverable.')
  console.info('\nDry run. Re-run with --apply.')
}

async function main() {
  const cfg = readConfig()
  if (!cfg) throw new Error('AIRTABLE_API_KEY and AIRTABLE_BASE_ID must be set')
  if (UNDO) return undo(cfg)
  if (!APPLY) return plan()
  console.info(`Seeding demo data into ${cfg.baseId}\n`)
  await seed(cfg)
}

void main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exitCode = 1
})
