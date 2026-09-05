/**
 * Domain types — the shared vocabulary of app + workers.
 *
 * These describe the five domains of `Louis-v3-Data-Holding-Map.md`:
 * CRM / Deals / Journal / Money / Assets. Airtable field IDs never appear here —
 * the data provider translates. Components speak this language only.
 */

import type { StageKey } from '~/speaker.config'

export type { StageKey }

export type Role = 'owner' | 'admin' | 'ops' | 'accountant'

export type DealSource = 'direct' | 'bureau'

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
  dealType: string | null
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
  tierModels: Record<ModelTier, string>
  fallbackModels: Record<ModelTier, string>
  monthlyCapUsd: number
  /** When the cap is hit: research + QA pause, intake + timers keep running. */
  pauseNonCriticalAtCap: boolean
}

export interface Settings {
  theme: ThemeSettings
  ai: AiSettings
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
