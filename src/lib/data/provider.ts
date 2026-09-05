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

  listNotifications(user: string, limit?: number): Promise<Notification[]>
  createNotification(input: NewRecord<Notification>): Promise<Notification>
  markNotificationsRead(user: string, ids: string[]): Promise<void>

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
