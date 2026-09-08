/**
 * The data seam.
 *
 * The Vercel app holds zero state (Data Map: "Vercel app — holds **nothing**").
 * Everything goes through this interface, which has exactly two implementations:
 * `airtable` (production) and `mock` (local dev / CI / demo, no credentials).
 *
 * Workers use the same interface, so a worker never depends on the front-end —
 * which is what makes the Airtable-interface fallback real.
 */

import type {
  AuditEntry,
  Client,
  Contact,
  DateConflict,
  Deal,
  StageKey,
  DealProposal,
  Draft,
  EmailRecord,
  FieldProposal,
  JournalOrder,
  MirrorState,
  Notification,
  Payment,
  ResearchBrief,
  ScheduleLeg,
  Settings,
  Task,
  UsageLogRow,
  ApiToken,
  Fulfillment,
  PastClient,
  DealLineItem,
  MailAccount,
  CoachingSession,
  Product,
  RateCard,
  Testimonial,
  Template,
  User,
} from '../types'

export type NewRecord<T> = Omit<T, 'id'>

export interface DealFilter {
  stage?: string
  clientId?: string
  q?: string
}

export interface TaskFilter {
  dealId?: string
  stage?: string
  done?: boolean
  assignee?: string
}

export interface DraftFilter {
  dealId?: string
  status?: Draft['status']
}

export interface DataProvider {
  readonly kind: 'airtable' | 'mock'

  // Domain 2 — Deals
  listDeals(filter?: DealFilter): Promise<Deal[]>
  getDeal(id: string): Promise<Deal | null>
  createDeal(input: Partial<Deal> & { name: string }): Promise<Deal>
  updateDeal(id: string, patch: Partial<Deal>): Promise<Deal>

  // Domain 1 — CRM
  listClients(): Promise<Client[]>
  getClient(id: string): Promise<Client | null>
  createClient(input: Partial<Client> & { name: string }): Promise<Client>
  updateClient(id: string, patch: Partial<Client>): Promise<Client>
  listContacts(): Promise<Contact[]>
  getContact(id: string): Promise<Contact | null>
  createContact(input: Partial<Contact> & { name: string }): Promise<Contact>
  updateContact(id: string, patch: Partial<Contact>): Promise<Contact>

  // Domain 3 — Journal
  listJournalOrders(): Promise<JournalOrder[]>
  createJournalOrder(input: NewRecord<JournalOrder>): Promise<JournalOrder>
  updateJournalOrder(id: string, patch: Partial<JournalOrder>): Promise<JournalOrder>

  // Domain 4 — Money
  listPayments(): Promise<Payment[]>
  createPayment(input: NewRecord<Payment>): Promise<Payment>
  updatePayment(id: string, patch: Partial<Payment>): Promise<Payment>
  listScheduleLegs(): Promise<ScheduleLeg[]>

  // Operations
  listTasks(filter?: TaskFilter): Promise<Task[]>
  createTask(input: NewRecord<Task>): Promise<Task>
  updateTask(id: string, patch: Partial<Task>): Promise<Task>

  listDrafts(filter?: DraftFilter): Promise<Draft[]>
  getDraft(id: string): Promise<Draft | null>
  createDraft(input: NewRecord<Draft>): Promise<Draft>
  updateDraft(id: string, patch: Partial<Draft>): Promise<Draft>

  listEmails(dealId?: string): Promise<EmailRecord[]>
  createEmail(input: NewRecord<EmailRecord>): Promise<EmailRecord>
  updateEmail(id: string, patch: Partial<EmailRecord>): Promise<EmailRecord>

  /** Phase C seed output — whole deals awaiting a human, reviewed in batch. */
  listDealProposals(status?: DealProposal['status']): Promise<DealProposal[]>
  createDealProposal(input: NewRecord<DealProposal>): Promise<DealProposal>
  updateDealProposal(id: string, patch: Partial<DealProposal>): Promise<DealProposal>

  listDateConflicts(status?: DateConflict['status']): Promise<DateConflict[]>
  createDateConflict(input: NewRecord<DateConflict>): Promise<DateConflict>
  updateDateConflict(id: string, patch: Partial<DateConflict>): Promise<DateConflict>

  listProposals(status?: FieldProposal['status']): Promise<FieldProposal[]>
  getProposal(id: string): Promise<FieldProposal | null>
  createProposal(input: NewRecord<FieldProposal>): Promise<FieldProposal>
  updateProposal(id: string, patch: Partial<FieldProposal>): Promise<FieldProposal>

  listAudit(entityId?: string, limit?: number): Promise<AuditEntry[]>
  appendAudit(entry: NewRecord<AuditEntry>): Promise<AuditEntry>
  /**
   * Writes many audit rows in as few requests as the backend allows.
   *
   * Airtable bills per request, so a bulk script that calls `appendAudit` in a loop
   * spends one request per row. On the Airtable backend this batches ten to a request.
   */
  appendAuditMany(entries: NewRecord<AuditEntry>[]): Promise<AuditEntry[]>

  listNotifications(user: string, limit?: number): Promise<Notification[]>
  createNotification(input: NewRecord<Notification>): Promise<Notification>
  markNotificationsRead(user: string, ids: string[]): Promise<void>

  /**
   * Deals touched since a timestamp.
   *
   * Exists so a sweep can cost one request in a quiet hour instead of reading the whole
   * table to discover nothing happened.
   */
  listDealsModifiedSince(since: string): Promise<Deal[]>

  /**
   * The deal a welcome-kit token belongs to.
   *
   * Its own method because the public kit page would otherwise read all 802 deals to find
   * one — nine Airtable requests, on an unauthenticated URL anyone can hit.
   */
  getDealByKitToken(token: string): Promise<Deal | null>

  /**
   * One page of deals, filtered server-side.
   *
   * Separate from `listDeals` because the two want opposite things: a worker needs every
   * deal and a screen needs twenty. Search and stage go into the Airtable formula rather
   * than being applied after the fact, so a search costs one request instead of nine.
   */
  listDealsPage(opts: DealPageQuery): Promise<DealPage>

  /**
   * One proposal, read past the cache.
   *
   * The read cache is per process, so on serverless an accept on one instance does not
   * clear the entry on another. Two people working the same review queue would both see
   * `proposed` and both accept — two deals from one proposal, with no error anywhere.
   * Accepting is a decision acted on, so it reads fresh.
   */
  getDealProposalFresh(id: string): Promise<DealProposal | null>

  /** One page of companies, searched server-side. */
  listClientsPage(opts: ListPageQuery): Promise<ClientPage>
  /** One page of people, searched server-side, optionally only bureau agents. */
  listContactsPage(opts: ListPageQuery & { bureauOnly?: boolean; directOnly?: boolean }): Promise<ContactPage>

  listRateCards(): Promise<RateCard[]>
  listTestimonials(): Promise<Testimonial[]>
  listPastClients(): Promise<PastClient[]>
  listFulfillment(): Promise<Fulfillment[]>
  createFulfillment(input: NewRecord<Fulfillment>): Promise<Fulfillment>
  listCoachingSessions(dealId?: string): Promise<CoachingSession[]>
  createCoachingSession(input: NewRecord<CoachingSession>): Promise<CoachingSession>
  updateCoachingSession(id: string, patch: Partial<CoachingSession>): Promise<CoachingSession>

  listProducts(): Promise<Product[]>
  listMailAccounts(): Promise<MailAccount[]>
  listLineItems(dealId?: string): Promise<DealLineItem[]>
  createLineItem(input: NewRecord<DealLineItem>): Promise<DealLineItem>
  deleteLineItem(id: string): Promise<void>

  listApiTokens(): Promise<ApiToken[]>
  createApiToken(input: NewRecord<ApiToken>): Promise<ApiToken>
  /** Records that a token was used. Never throws into the caller's path. */
  touchApiToken(id: string, at: string): Promise<void>
  revokeApiToken(id: string): Promise<void>

  listTemplates(): Promise<Template[]>
  upsertTemplate(key: string, patch: Partial<Template>): Promise<Template>

  listUsers(): Promise<User[]>
  getUserByEmail(email: string): Promise<User | null>
  upsertUser(input: Partial<User> & { email: string }): Promise<User>

  listResearchBriefs(dealId?: string): Promise<ResearchBrief[]>
  createResearchBrief(input: NewRecord<ResearchBrief>): Promise<ResearchBrief>

  listMirrorState(): Promise<MirrorState[]>
  upsertMirrorState(input: NewRecord<MirrorState>): Promise<MirrorState>

  listUsage(sinceIso?: string): Promise<UsageLogRow[]>
  appendUsage(row: NewRecord<UsageLogRow>): Promise<UsageLogRow>

  getSettings(): Promise<Settings>
  saveSettings(patch: Partial<Settings>): Promise<Settings>
}

export interface DealPageQuery {
  q?: string
  stage?: StageKey
  /** Imported history is excluded unless this is set. */
  includeHistorical?: boolean
  cursor?: string
  pageSize?: number
}

export interface DealPage {
  deals: Deal[]
  /** Pass back to fetch the next page. Absent means there are no more. */
  cursor?: string
}

export interface ListPageQuery {
  q?: string
  cursor?: string
  pageSize?: number
}

export interface ClientPage {
  clients: Client[]
  cursor?: string
}

export interface ContactPage {
  contacts: Contact[]
  cursor?: string
}
