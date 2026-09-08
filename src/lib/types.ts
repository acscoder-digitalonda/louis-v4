/**
 * Domain types — the shared vocabulary of app + workers.
 *
 * These describe the five domains of `Louis-v3-Data-Holding-Map.md`:
 * CRM / Deals / Journal / Money / Assets. Airtable field IDs never appear here —
 * the data provider translates. Components speak this language only.
 */

import type { StageKey } from '~/speaker.config'

export type { StageKey }
export type { Template } from './templates'

export type Role = 'owner' | 'admin' | 'ops' | 'accountant'

export type DealSource = 'direct' | 'bureau'

export type DealTypeKey = 'keynote' | 'speaker-coaching' | 'executive-coaching'

/** In-person or virtual. Half of the List Amount formula (WP1.1). */
export type SecondaryDealType = 'in-person' | 'virtual'

/**
 * The four rate bands, as Decisions Log §4 defines them — geographic groupings, not
 * countries. The amounts live in Rate Cards; this is only the key that looks them up.
 *
 * Virtual is deliberately *not* a band. It is a Secondary Deal Type, and its rate card
 * row matches any region — a virtual talk costs the same whether the client is in Ohio
 * or Oman, because nobody travels.
 */
export type RateRegion =
  /** US and non-remote Canada. */
  | 'us-canada'
  /** Mexico, Caribbean, Central America, remote Canada. */
  | 'near-international'
  /** Europe, South America, Japan. */
  | 'europe-samerica-japan'
  /** Middle East, India, Africa, Asia, Australia. */
  | 'far-international'

/** How a rate card decides whether the weekend surcharge applies. */
export type WeekendRule = 'none' | 'event-date' | 'travel-days'

/** Ben's read on temperature. Drives nothing automatic; it is for the humans. */
export type DealStatus = 'cold' | 'warm' | 'hot'

/** Why a deal was lost. The key the twelve-month re-engagement segments on (WP1.7). */
export type ClosedLostReason =
  | 'budget'
  | 'date-unavailable'
  | 'chose-another-speaker'
  | 'no-speaker'
  | 'postponed'
  | 'went-quiet'
  | 'other'

/** Who owns the next chase. A formula, not a choice: 0-1 touches Liezel, 2+ Ben. */
export type NextActionOwner = 'ops' | 'owner'

export type ContactType = 'bureau-agent' | 'meeting-planner' | 'decision-maker' | 'onsite'

export type PaymentStatus = 'unbilled' | 'invoiced' | 'partial' | 'paid' | 'overdue'

export type ContractStatus = 'none' | 'out' | 'signed'

export type DraftType =
  | 'ack'
  | 'proposal'
  | 'follow-up'
  | 'forcing'
  | 'kit'
  | 'journal'
  | 'debrief'
  | 'chase'

export type DraftStatus = 'proposed' | 'approved' | 'sent' | 'dismissed'

export type JournalStatus =
  | 'mentioned'
  | 'promo-sent'
  | 'received'
  | 'interested'
  | 'bulk-ordered'
  | 'shipped'
  | 'dropship'

export type TaskSource = 'stage-packet' | 'timer' | 'manual'

export type ModelTier = 'haiku' | 'sonnet' | 'opus'

export type NotificationType =
  | 'review-item'
  | 'red-alert'
  | 'worker-failure'
  | 'payment-confirmed'
  | 'contract-signed'
  | 'cap-warning'
  | 'qa-digest'
  | 'mention'

export type MirrorSurface = 'calendar' | 'doc' | 'sheet' | 'drive'

export interface Ref {
  id: string
  name: string
}

/** Domain 2 — the core object. One record from first inquiry to debrief. */
export interface Deal {
  id: string
  name: string
  stage: StageKey
  source: DealSource
  dealType: DealTypeKey | null
  secondaryType: SecondaryDealType | null
  dealStatus: DealStatus | null
  client: Ref | null
  bureauAgent: Ref | null
  owner: string | null

  // sales
  listFee: number | null
  negotiatedFee: number | null
  decisionDate: string | null
  proposalSent: boolean
  holdDate: string | null
  holdOrder: number | null

  // pricing (WP0.1; the engine that fills these is WP1.1)
  rateRegion: RateRegion | null
  travelStipend: number | null
  /** Saturday or Sunday event date. Whether it costs extra is the rate card's call. */
  weekendEvent: boolean
  pricingNote: string | null
  /** Rollup of Deal Line Items. Read-only — the line items own it. */
  addOnAmount: number | null
  /** negotiated ?? list, plus travel, plus add-ons. Read-only. */
  amount: number | null

  // follow-up mechanics (WP0.1; the engine that drives them is WP1.2)
  nextActionDate: string | null
  followUpCount: number
  /** Formula: 0-1 touches Liezel, 2+ escalates to Ben. Read-only. */
  nextActionOwner: NextActionOwner | null
  muted: boolean
  muteUntil: string | null

  // outcome
  closedLostReason: ClosedLostReason | null

  // event
  eventDate: string | null
  location: string | null
  avCheckTime: string | null
  stageTime: string | null
  eventUrl: string | null

  // questionnaire
  questionnaireReceived: boolean
  audienceProfile: string | null
  desiredOutcomes: string | null
  kickoffNotes: string | null
  postKeynoteNotes: string | null

  // logistics
  hotel: string | null
  travelNotes: string | null
  logisticsComplete: boolean
  eventTimezone: string | null
  kickoffDate: string | null
  /** Travel departs the day before by default; Road Warrior (WP3.3) fires off this. */
  travelDepartureDate: string | null
  outboundFlight: string | null
  returnFlight: string | null
  /** Ben ticks this once, onsite, and the handoff alert goes out. */
  postKeynoteAlert: boolean
  /** Opaque token in the hosted welcome-kit URL. */
  kitToken: string | null

  // money chips — lookups from the Money tables, read-only everywhere (Data Map, Domain 4)
  paymentStatus: PaymentStatus
  contractStatus: ContractStatus

  // assets
  driveFolderUrl: string | null

  // provenance — `source` above is the lane (direct/bureau), not where the row came from
  historical: boolean
  importBatch: string | null
  sourceRef: string | null

  // meta
  createdAt: string
  lastModified: string
}

/** Weighted forecast is derived, never stored by hand (Rebuild Spec §2.3). */
export interface DealWithDerived extends Deal {
  forecastWeight: number
  forecastValue: number
}

/** Domain 1 — CRM. */
export interface Client {
  id: string
  name: string
  domain: string | null
  industry: string | null
  website: string | null
  hq: string | null
  notes: string | null
  dealIds: string[]
  contactIds: string[]
}

export interface Contact {
  id: string
  name: string
  email: string | null
  phone: string | null
  type: ContactType
  title: string | null
  agency: string | null
  keyAgent: boolean
  clientId: string | null
  dealIds: string[]
  notes: string | null
}

/** Domain 3 — the sidecar. Deal link is deliberately optional. */
export interface JournalOrder {
  id: string
  reference: string
  status: JournalStatus
  quantity: number | null
  shipTo: string | null
  shipByDate: string | null
  warehouseNotes: string | null
  inserts: boolean
  dealId: string | null
  clientId: string | null
}

/** Domain 4 — money owns these; nothing outside the money group writes them. */
export interface Payment {
  id: string
  dealId: string | null
  invoiceNumber: string | null
  amount: number
  status: 'proposed' | 'confirmed'
  method: string | null
  receivedDate: string | null
  confirmedBy: string | null
  note: string | null
}

export interface ScheduleLeg {
  id: string
  dealId: string
  label: string
  amount: number
  dueDate: string | null
  paid: boolean
}

export interface Task {
  id: string
  dealId: string | null
  title: string
  assignee: string | null
  dueDate: string | null
  source: TaskSource
  /** Which stage packet produced it — mini pipelines are Tasks filtered by deal+stage. */
  stage: StageKey | null
  done: boolean
  createdAt: string
}

export interface Draft {
  id: string
  dealId: string | null
  type: DraftType
  subject: string
  body: string
  status: DraftStatus
  toEmail: string | null
  approver: string | null
  sentAt: string | null
  threadId: string | null
  /** Checker pass result — every AI output is checked before a human sees it. */
  checkerVerdict: CheckerVerdict | null
  /** Edits Liezel made before send, kept for outbound versioning (Open Question 1, both readings). */
  revisions: DraftRevision[]
  createdAt: string
}

export interface DraftRevision {
  at: string
  by: string
  subject: string
  body: string
}

export interface CheckerVerdict {
  ok: boolean
  model: string
  issues: string[]
  checkedAt: string
}

export interface EmailRecord {
  id: string
  dealId: string | null
  from: string
  to: string
  subject: string
  threadId: string | null
  /**
   * The RFC Message-ID, normalised. The dedupe key across mailboxes — the Gmail `id` is
   * per mailbox and cannot do this job.
   */
  messageId: string | null
  /** Which mailbox this copy was read from. */
  mailbox: string | null
  receivedAt: string
  bodyRef: string | null
  classification: 'inquiry' | 'update' | 'noise' | 'unclassified'
  extractionStatus: 'pending' | 'extracted' | 'error'
}

/** F4 — a conflicting value is NEVER written silently. It becomes one of these. */
export interface FieldProposal {
  id: string
  dealId: string
  field: string
  fieldLabel: string
  oldValue: string | null
  newValue: string
  sourceEmailId: string | null
  status: 'proposed' | 'accepted' | 'dismissed'
  createdAt: string
  resolvedBy: string | null
  confidence: number | null
}

/**
 * Phase C seed output: a whole deal a machine believes exists, awaiting a human.
 * `FieldProposal` is the narrow shape — one field on a deal that already exists.
 */
export interface DealProposal {
  id: string
  title: string
  seedSource: SeedSource
  batchId: string | null
  status: 'proposed' | 'accepted' | 'merged' | 'dismissed'
  confidence: number | null

  /** What the source literally said, kept alongside the fuzzy match so C5 can judge both. */
  clientName: string | null
  clientId: string | null
  contactName: string | null
  contactId: string | null

  stage: StageKey
  /** Set only on a proposal that arrives already lost — a released inquiry from C3. */
  closedLostReason: ClosedLostReason | null
  lane: DealSource
  eventDate: string | null
  holdDate: string | null
  holdOrder: number | null
  location: string | null
  negotiatedFee: number | null
  decisionDate: string | null
  historical: boolean

  sourceRef: string | null
  sources: string | null
  notes: string | null
  conflictId: string | null
  dealId: string | null
  resolvedBy: string | null
  createdAt: string
}

export type SeedSource = 'calendar' | 'inbox' | 'sheets' | 'quickbooks'

/** Two or more holds on one date. "Both feasible" is an answer, not an unresolved state. */
export interface DateConflict {
  id: string
  label: string
  date: string | null
  status: 'open' | 'resolved' | 'both-feasible'
  proposalIds: string[]
  dealIds: string[]
  resolution: string | null
  resolvedBy: string | null
  createdAt: string
}

export interface AuditEntry {
  id: string
  entity: string
  entityId: string
  field: string
  oldValue: string | null
  newValue: string | null
  actor: string
  /** 'agent:F2' for automation, an email address for a human. */
  actorKind: 'human' | 'agent'
  source: string | null
  /** Groups a bulk operation so it can be reversed as one unit. */
  batchId: string | null
  at: string
  reversible: boolean
}

export interface Notification {
  id: string
  user: string
  type: NotificationType
  title: string
  body: string | null
  link: string | null
  read: boolean
  createdAt: string
  emailed: boolean
}

export interface User {
  id: string
  email: string
  name: string | null
  role: Role
  active: boolean
  /** Per-user default landing page — Liezel's is the Review Queue (Handoff §3.1). */
  landingPage: string
  notificationPrefs: Record<NotificationType, NotificationChannel>
  /** Owner-only: reveal money amounts rather than chips (Rebuild Spec §5). */
  showMoneyAmounts: boolean
  theme: 'light' | 'dark' | 'system'
}

export type NotificationChannel = 'in-app' | 'email' | 'both' | 'off'

export interface ResearchBrief {
  id: string
  dealId: string
  companyFacts: string
  mvv: string | null
  budgetSignals: string | null
  notes: string | null
  sources: string[]
  model: string
  checkedBy: string | null
  checkerVerdict: CheckerVerdict | null
  createdAt: string
}

export interface MirrorState {
  id: string
  surface: MirrorSurface
  entity: string
  entityId: string
  lastPushed: string | null
  ok: boolean
  error: string | null
}

export interface UsageLogRow {
  id: string
  at: string
  worker: string
  task: string
  model: string
  tier: ModelTier
  tokensIn: number
  tokensOut: number
  estCost: number
  backend: AiBackend
  dealId: string | null
  durationMs: number
  ok: boolean
  error: string | null
  /** Phase 0 subscription runs report estimated-equivalent cost, labelled honestly. */
  estimated: boolean
}

export type AiBackend = 'claude-code' | 'openrouter'

export interface ThemeSettings {
  /** Accent overrides per theme; keys are token names without the leading `--`. */
  light: Record<string, string>
  dark: Record<string, string>
}

export interface AiSettings {
  backend: AiBackend
  /**
   * Which tier map is in force (WP3.1). Absent means Steady, so an install that predates
   * the dial keeps behaving exactly as it did.
   */
  mode?: 'launch' | 'steady' | 'economy'
  tierModels: Record<ModelTier, string>
  fallbackModels: Record<ModelTier, string>
  monthlyCapUsd: number
  /** When the cap is hit: research + QA pause, intake + timers keep running. */
  pauseNonCriticalAtCap: boolean
}

/**
 * Where the mirror keeps its own heartbeat.
 *
 * A section rather than a loose key, because `saveSettings` persists sections and
 * silently drops anything else — which is how F9 spent a month doing a full read of
 * every deal an hour, believing it had recorded the last run.
 */
export interface MirrorSettings {
  /** When F9 last completed. Null means "read everything", the safe direction to fail in. */
  lastRunAt: string | null
}

export interface Settings {
  theme: ThemeSettings
  ai: AiSettings
  mirror: MirrorSettings
  updatedAt: string
}

/** The shape the Review Queue screen consumes — both lists in one payload. */
export interface ReviewQueue {
  drafts: Draft[]
  proposals: FieldProposal[]
}

export interface SearchDoc {
  id: string
  type: 'deal' | 'client' | 'contact' | 'journal' | 'draft' | 'action'
  title: string
  subtitle: string | null
  href: string
  haystack: string
}

/**
 * A row of the rate card (WP1.1, Decisions Log §4).
 *
 * `rateRegion: null` is the any-region row — virtual, where nobody travels so location
 * does not price. `weekendSurcharge: 0` and `weekendRule: 'none'` are different things:
 * the first says the weekend is free, the second says the question does not arise.
 */
export interface RateCard {
  id: string
  label: string
  year: number | null
  dealType: DealTypeKey | null
  secondaryType: SecondaryDealType
  rateRegion: RateRegion | null
  baseFee: number | null
  weekendSurcharge: number | null
  weekendRule: WeekendRule | null
  travelBuyout: number | null
  travelTerms: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
  active: boolean
}

/** A thing that can be added to a deal as a line item (WP1.1). */
export interface Product {
  id: string
  name: string
  kind: 'Journal' | 'Book' | 'Workshop' | 'Dream Wall' | 'Other'
  unitPrice: number | null
  /** Physical products get a Fulfillment record; a workshop does not. */
  physical: boolean
  active: boolean
}

/** One of the 74 archived quotes (WP4.1), tagged so the resolver can match it. */
export interface Testimonial {
  id: string
  quote: string
  shortQuote: string | null
  personName: string
  title: string | null
  company: string | null
  industry: string | null
  format: 'In-person' | 'Virtual' | 'Either'
  category: string | null
  sourceUrl: string | null
  /** Ben retires a quote by unticking this. The resolver honours it. */
  active: boolean
}

/** A (industry, client) row derived from seven years of bookings (WP4.1). */
export interface PastClient {
  id: string
  industry: string
  clientName: string
  bookings: number
  lastYear: number | null
  anyVirtual: boolean
}

export type FulfillmentStatus =
  | 'Mentioned'
  | 'Promo Sent'
  | 'Promo Received'
  | 'Interested'
  | 'Quote Sent'
  | 'Ordered'
  | 'Warehouse Notified'
  | 'Shipped'
  | 'Delivered'
  | 'Dropship Pending'
  | 'Dropship Complete'

/** One per physical line item (WP1.4). Holds status, never money. */
export interface Fulfillment {
  id: string
  lineItemId: string | null
  dealId: string | null
  status: FulfillmentStatus
  quantity: number | null
  shipBy: string | null
  carrier: string | null
  tracking: string | null
  warehouseNotes: string | null
  slackThread: string | null
  notes: string | null
}

/** A revocable per-user token for the MCP endpoint (WP3.4). The token itself is never stored. */
export interface ApiToken {
  id: string
  label: string
  tokenHash: string
  prefix: string
  userEmail: string
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  revoked: boolean
}

/**
 * Where add-on money lives (WP1.1). The deal's Amount is a rollup of these, so a journal
 * order and a workshop are the same kind of thing to the money model and different kinds
 * of thing to the warehouse — which is why Fulfillment is a separate record.
 */
export interface DealLineItem {
  id: string
  dealId: string | null
  productId: string | null
  productName: string | null
  quantity: number
  /** Set to book something at a price other than the product's. Dream fulfilment is 0. */
  priceOverride: number | null
  lineTotal: number | null
  notes: string | null
}

/** A mailbox the intake sweeps, and how much of it (WP1.6). */
export interface MailAccount {
  id: string
  address: string
  label: string
  /** Airtable's label, decoded by `resolveAccounts`. */
  scope: string
  watchedLabel: string | null
  lookbackDays: number | null
  active: boolean
}

/** One of the three sessions a coaching track delivers. */
export interface CoachingSession {
  id: string
  dealId: string | null
  sessionNumber: number
  scheduledFor: string | null
  held: boolean
  notes: string | null
}
