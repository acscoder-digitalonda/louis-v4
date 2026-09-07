/**
 * In-memory provider.
 *
 * Active whenever Airtable credentials are absent (`DATA_BACKEND=mock`, or no key).
 * It exists so the app is reviewable — and CI is runnable — with zero credentials,
 * and so a reviewer can click every screen before the base is provisioned.
 *
 * Writes persist for the life of the server process only. That is deliberate: nothing
 * about this provider should ever feel like a real database.
 */

import { defaultThemeSettings } from '../theme'
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
  ApiToken,
  Fulfillment,
  PastClient,
  DealLineItem,
  Product,
  RateCard,
  Testimonial,
  Template,
  User,
} from '../types'
import { defaultNotificationPrefs } from '../rbac'
import { buildSeed, NEW_DEAL_FIELDS, type SeedData } from './mock-seed'
import type {
  DataProvider,
  DealFilter,
  DraftFilter,
  NewRecord,
  TaskFilter,
} from './provider'

interface Store extends SeedData {
  researchBriefs: ResearchBrief[]
  mirrorState: MirrorState[]
  usage: UsageLogRow[]
  settings: Settings
  counter: number
}

const GLOBAL_KEY = Symbol.for('louis.mock.store')

function freshStore(): Store {
  return {
    ...buildSeed(),
    researchBriefs: [],
    mirrorState: [],
    usage: [],
    settings: {
      theme: defaultThemeSettings,
      ai: {
        backend: 'claude-code',
        tierModels: {
          haiku: 'claude-haiku-4-5',
          sonnet: 'claude-sonnet-5',
          opus: 'claude-opus-5',
        },
        fallbackModels: {
          haiku: 'google/gemini-2.5-flash',
          sonnet: 'google/gemini-2.5-pro',
          opus: 'google/gemini-2.5-pro',
        },
        monthlyCapUsd: 150,
        pauseNonCriticalAtCap: true,
      },
      updatedAt: new Date().toISOString(),
    },
    counter: 0,
  }
}

function store(): Store {
  const g = globalThis as unknown as Record<symbol, Store | undefined>
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = freshStore()
  return g[GLOBAL_KEY]!
}

/** Test/CLI helper — drops all mutations. */
export function resetMockStore(): void {
  const g = globalThis as unknown as Record<symbol, Store | undefined>
  g[GLOBAL_KEY] = freshStore()
}

function id(prefix: string): string {
  const s = store()
  s.counter += 1
  return `${prefix}${String(s.counter).padStart(4, '0')}${Math.random().toString(36).slice(2, 6)}`
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function patchInto<T extends { id: string }>(list: T[], recordId: string, patch: Partial<T>): T {
  const idx = list.findIndex((r) => r.id === recordId)
  if (idx === -1) throw new Error(`Record ${recordId} not found`)
  const next = { ...list[idx]!, ...patch } as T
  list[idx] = next
  return clone(next)
}

export class MockProvider implements DataProvider {
  readonly kind = 'mock' as const

  // ── Deals ────────────────────────────────────────────────────────────────
  async listDeals(filter: DealFilter = {}): Promise<Deal[]> {
    let out = clone(store().deals)
    if (filter.stage) out = out.filter((d) => d.stage === filter.stage)
    if (filter.clientId) out = out.filter((d) => d.client?.id === filter.clientId)
    if (filter.q) {
      const q = filter.q.toLowerCase()
      out = out.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          (d.location ?? '').toLowerCase().includes(q) ||
          (d.client?.name ?? '').toLowerCase().includes(q),
      )
    }
    return out.sort((a, b) => (a.eventDate ?? '9999').localeCompare(b.eventDate ?? '9999'))
  }

  async getDeal(dealId: string): Promise<Deal | null> {
    return clone(store().deals.find((d) => d.id === dealId) ?? null)
  }

  async createDeal(input: Partial<Deal> & { name: string }): Promise<Deal> {
    const now = new Date().toISOString()
    const record: Deal = {
      ...NEW_DEAL_FIELDS,
      id: id('recDEAL'),
      stage: 'inquiry',
      source: 'direct',
      dealType: 'keynote',
      client: null,
      bureauAgent: null,
      owner: null,
      holdOrder: null,
      historical: false,
      importBatch: null,
      sourceRef: null,
      listFee: null,
      negotiatedFee: null,
      decisionDate: null,
      proposalSent: false,
      holdDate: null,
      eventDate: null,
      location: null,
      avCheckTime: null,
      stageTime: null,
      eventUrl: null,
      questionnaireReceived: false,
      audienceProfile: null,
      desiredOutcomes: null,
      kickoffNotes: null,
      postKeynoteNotes: null,
      hotel: null,
      travelNotes: null,
      logisticsComplete: false,
      paymentStatus: 'unbilled',
      contractStatus: 'none',
      driveFolderUrl: null,
      createdAt: now,
      lastModified: now,
      ...input,
    }
    store().deals.push(record)
    return clone(record)
  }

  async updateDeal(dealId: string, patch: Partial<Deal>): Promise<Deal> {
    return patchInto(store().deals, dealId, {
      ...patch,
      lastModified: new Date().toISOString(),
    })
  }

  // ── CRM ──────────────────────────────────────────────────────────────────
  async listClients(): Promise<Client[]> {
    return clone(store().clients)
  }
  async getClient(clientId: string): Promise<Client | null> {
    return clone(store().clients.find((c) => c.id === clientId) ?? null)
  }
  async createClient(input: Partial<Client> & { name: string }): Promise<Client> {
    const record: Client = {
      id: id('recCLI'),
      domain: null,
      industry: null,
      website: null,
      hq: null,
      notes: null,
      dealIds: [],
      contactIds: [],
      ...input,
    }
    store().clients.push(record)
    return clone(record)
  }
  async updateClient(clientId: string, patch: Partial<Client>): Promise<Client> {
    return patchInto(store().clients, clientId, patch)
  }

  async listContacts(): Promise<Contact[]> {
    return clone(store().contacts)
  }
  async getContact(contactId: string): Promise<Contact | null> {
    return clone(store().contacts.find((c) => c.id === contactId) ?? null)
  }
  async createContact(input: Partial<Contact> & { name: string }): Promise<Contact> {
    const record: Contact = {
      id: id('recCON'),
      email: null,
      phone: null,
      type: 'decision-maker',
      title: null,
      agency: null,
      keyAgent: false,
      clientId: null,
      dealIds: [],
      notes: null,
      ...input,
    }
    store().contacts.push(record)
    return clone(record)
  }
  async updateContact(contactId: string, patch: Partial<Contact>): Promise<Contact> {
    return patchInto(store().contacts, contactId, patch)
  }

  // ── Journal ──────────────────────────────────────────────────────────────
  async listJournalOrders(): Promise<JournalOrder[]> {
    return clone(store().journalOrders)
  }
  async createJournalOrder(input: NewRecord<JournalOrder>): Promise<JournalOrder> {
    const record: JournalOrder = { id: id('recJRN'), ...input }
    store().journalOrders.push(record)
    return clone(record)
  }
  async updateJournalOrder(orderId: string, patch: Partial<JournalOrder>): Promise<JournalOrder> {
    return patchInto(store().journalOrders, orderId, patch)
  }

  // ── Money ────────────────────────────────────────────────────────────────
  async listPayments(): Promise<Payment[]> {
    return clone(store().payments)
  }
  async createPayment(input: NewRecord<Payment>): Promise<Payment> {
    const record: Payment = { id: id('recPAY'), ...input }
    store().payments.push(record)
    return clone(record)
  }
  async updatePayment(paymentId: string, patch: Partial<Payment>): Promise<Payment> {
    return patchInto(store().payments, paymentId, patch)
  }
  async listScheduleLegs(): Promise<ScheduleLeg[]> {
    return clone(store().scheduleLegs)
  }

  // ── Operations ───────────────────────────────────────────────────────────
  async listTasks(filter: TaskFilter = {}): Promise<Task[]> {
    let out = clone(store().tasks)
    if (filter.dealId) out = out.filter((t) => t.dealId === filter.dealId)
    if (filter.stage) out = out.filter((t) => t.stage === filter.stage)
    if (filter.done !== undefined) out = out.filter((t) => t.done === filter.done)
    if (filter.assignee) out = out.filter((t) => t.assignee === filter.assignee)
    return out.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
  }
  async createTask(input: NewRecord<Task>): Promise<Task> {
    const record: Task = { id: id('recTSK'), ...input }
    store().tasks.push(record)
    return clone(record)
  }
  async updateTask(taskId: string, patch: Partial<Task>): Promise<Task> {
    return patchInto(store().tasks, taskId, patch)
  }

  async listDrafts(filter: DraftFilter = {}): Promise<Draft[]> {
    let out = clone(store().drafts)
    if (filter.dealId) out = out.filter((d) => d.dealId === filter.dealId)
    if (filter.status) out = out.filter((d) => d.status === filter.status)
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  async getDraft(draftId: string): Promise<Draft | null> {
    return clone(store().drafts.find((d) => d.id === draftId) ?? null)
  }
  async createDraft(input: NewRecord<Draft>): Promise<Draft> {
    const record: Draft = { id: id('recDRF'), ...input }
    store().drafts.push(record)
    return clone(record)
  }
  async updateDraft(draftId: string, patch: Partial<Draft>): Promise<Draft> {
    return patchInto(store().drafts, draftId, patch)
  }

  async listEmails(dealId?: string): Promise<EmailRecord[]> {
    const out = clone(store().emails)
    return (dealId ? out.filter((e) => e.dealId === dealId) : out).sort((a, b) =>
      b.receivedAt.localeCompare(a.receivedAt),
    )
  }
  async createEmail(input: NewRecord<EmailRecord>): Promise<EmailRecord> {
    const record: EmailRecord = { id: id('recEML'), ...input }
    store().emails.push(record)
    return clone(record)
  }
  async updateEmail(emailId: string, patch: Partial<EmailRecord>): Promise<EmailRecord> {
    return patchInto(store().emails, emailId, patch)
  }

  async listProposals(status?: FieldProposal['status']): Promise<FieldProposal[]> {
    const out = clone(store().proposals)
    return (status ? out.filter((p) => p.status === status) : out).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )
  }
  async getProposal(proposalId: string): Promise<FieldProposal | null> {
    return clone(store().proposals.find((p) => p.id === proposalId) ?? null)
  }
  async createProposal(input: NewRecord<FieldProposal>): Promise<FieldProposal> {
    const record: FieldProposal = { id: id('recPRP'), ...input }
    store().proposals.push(record)
    return clone(record)
  }
  async updateProposal(proposalId: string, patch: Partial<FieldProposal>): Promise<FieldProposal> {
    return patchInto(store().proposals, proposalId, patch)
  }

  async listDealProposals(status?: DealProposal['status']): Promise<DealProposal[]> {
    const out = clone(store().dealProposals)
    return (status ? out.filter((p) => p.status === status) : out).sort((a, b) =>
      (a.eventDate ?? '9999').localeCompare(b.eventDate ?? '9999'),
    )
  }
  async createDealProposal(input: NewRecord<DealProposal>): Promise<DealProposal> {
    const record: DealProposal = { id: id('recDPR'), ...input }
    store().dealProposals.push(record)
    return clone(record)
  }
  async updateDealProposal(pid: string, patch: Partial<DealProposal>): Promise<DealProposal> {
    return patchInto(store().dealProposals, pid, patch)
  }

  async listDateConflicts(status?: DateConflict['status']): Promise<DateConflict[]> {
    const out = clone(store().dateConflicts)
    return (status ? out.filter((c) => c.status === status) : out).sort((a, b) =>
      (a.date ?? '9999').localeCompare(b.date ?? '9999'),
    )
  }
  async createDateConflict(input: NewRecord<DateConflict>): Promise<DateConflict> {
    const record: DateConflict = { id: id('recDCF'), ...input }
    store().dateConflicts.push(record)
    return clone(record)
  }
  async updateDateConflict(cid: string, patch: Partial<DateConflict>): Promise<DateConflict> {
    return patchInto(store().dateConflicts, cid, patch)
  }

  async listAudit(entityId?: string, limit = 100): Promise<AuditEntry[]> {
    const out = clone(store().audit)
      .filter((a) => !entityId || a.entityId === entityId)
      .sort((a, b) => b.at.localeCompare(a.at))
    return out.slice(0, limit)
  }
  async appendAudit(entry: NewRecord<AuditEntry>): Promise<AuditEntry> {
    const record: AuditEntry = { id: id('recAUD'), ...entry }
    store().audit.push(record)
    return clone(record)
  }

  async appendAuditMany(entries: NewRecord<AuditEntry>[]): Promise<AuditEntry[]> {
    const out: AuditEntry[] = []
    for (const e of entries) out.push(await this.appendAudit(e))
    return out
  }

  async listNotifications(user: string, limit = 50): Promise<Notification[]> {
    return clone(store().notifications)
      .filter((n) => n.user === user)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
  }
  async createNotification(input: NewRecord<Notification>): Promise<Notification> {
    const record: Notification = { id: id('recNTF'), ...input }
    store().notifications.push(record)
    return clone(record)
  }
  async markNotificationsRead(user: string, ids: string[]): Promise<void> {
    for (const n of store().notifications) {
      if (n.user === user && (ids.length === 0 || ids.includes(n.id))) n.read = true
    }
  }

  async listDealsModifiedSince(since: string): Promise<Deal[]> {
    return clone(store().deals.filter((d: Deal) => d.lastModified > since))
  }

  async listRateCards(): Promise<RateCard[]> {
    return clone(store().rateCards)
  }

  async listTestimonials(): Promise<Testimonial[]> {
    return clone(store().testimonials)
  }

  async listPastClients(): Promise<PastClient[]> {
    return clone(store().pastClients)
  }

  async listFulfillment(): Promise<Fulfillment[]> {
    return clone(store().fulfillment)
  }

  async createFulfillment(input: NewRecord<Fulfillment>): Promise<Fulfillment> {
    const record = { id: id('recFUL'), ...input } as Fulfillment
    store().fulfillment.push(record)
    return clone(record)
  }

  async listProducts(): Promise<Product[]> {
    return clone(store().products)
  }

  async listLineItems(dealId?: string): Promise<DealLineItem[]> {
    const all = store().lineItems
    return clone(dealId ? all.filter((l: DealLineItem) => l.dealId === dealId) : all)
  }

  async createLineItem(input: NewRecord<DealLineItem>): Promise<DealLineItem> {
    const record = { id: id('recLIN'), ...input } as DealLineItem
    store().lineItems.push(record)
    return clone(record)
  }

  async deleteLineItem(lineId: string): Promise<void> {
    const list = store().lineItems
    const i = list.findIndex((l: DealLineItem) => l.id === lineId)
    if (i >= 0) list.splice(i, 1)
  }

  async listApiTokens(): Promise<ApiToken[]> {
    return clone(store().apiTokens)
  }

  async createApiToken(input: NewRecord<ApiToken>): Promise<ApiToken> {
    const record: ApiToken = { id: id('recTOK'), ...input } as ApiToken
    store().apiTokens.push(record)
    return clone(record)
  }

  async touchApiToken(tokenId: string, at: string): Promise<void> {
    const found = store().apiTokens.find((t: ApiToken) => t.id === tokenId)
    if (found) found.lastUsedAt = at
  }

  async revokeApiToken(tokenId: string): Promise<void> {
    const found = store().apiTokens.find((t: ApiToken) => t.id === tokenId)
    if (found) found.revoked = true
  }

  async listTemplates(): Promise<Template[]> {
    return clone(store().templates)
  }

  async upsertTemplate(key: string, patch: Partial<Template>): Promise<Template> {
    const list = store().templates
    const found = list.find((t: Template) => t.key === key)
    if (found) Object.assign(found, patch)
    else list.push({ key, label: key, subject: '', body: '', ...patch })
    return clone(list.find((t: Template) => t.key === key)!)
  }

  async listUsers(): Promise<User[]> {
    return clone(store().users)
  }
  async getUserByEmail(email: string): Promise<User | null> {
    const found = store().users.find((u) => u.email.toLowerCase() === email.toLowerCase())
    return clone(found ?? null)
  }
  async upsertUser(input: Partial<User> & { email: string }): Promise<User> {
    const s = store()
    const existing = s.users.find((u) => u.email.toLowerCase() === input.email.toLowerCase())
    if (existing) return patchInto(s.users, existing.id, input)
    const role = input.role ?? 'ops'
    const record: User = {
      id: id('recUSR'),
      name: null,
      role,
      active: true,
      landingPage: '/pipeline',
      notificationPrefs: defaultNotificationPrefs(role),
      showMoneyAmounts: role !== 'owner',
      theme: 'system',
      ...input,
    }
    s.users.push(record)
    return clone(record)
  }

  async listResearchBriefs(dealId?: string): Promise<ResearchBrief[]> {
    const out = clone(store().researchBriefs)
    return dealId ? out.filter((r) => r.dealId === dealId) : out
  }
  async createResearchBrief(input: NewRecord<ResearchBrief>): Promise<ResearchBrief> {
    const record: ResearchBrief = { id: id('recRSB'), ...input }
    store().researchBriefs.push(record)
    return clone(record)
  }

  async listMirrorState(): Promise<MirrorState[]> {
    return clone(store().mirrorState)
  }
  async upsertMirrorState(input: NewRecord<MirrorState>): Promise<MirrorState> {
    const s = store()
    const existing = s.mirrorState.find(
      (m) => m.surface === input.surface && m.entityId === input.entityId,
    )
    if (existing) return patchInto(s.mirrorState, existing.id, input)
    const record: MirrorState = { id: id('recMIR'), ...input }
    s.mirrorState.push(record)
    return clone(record)
  }

  async listUsage(sinceIso?: string): Promise<UsageLogRow[]> {
    const out = clone(store().usage)
    return sinceIso ? out.filter((u) => u.at >= sinceIso) : out
  }
  async appendUsage(row: NewRecord<UsageLogRow>): Promise<UsageLogRow> {
    const record: UsageLogRow = { id: id('recUSG'), ...row }
    store().usage.push(record)
    return clone(record)
  }

  async getSettings(): Promise<Settings> {
    return clone(store().settings)
  }
  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const s = store()
    s.settings = {
      ...s.settings,
      ...patch,
      theme: { ...s.settings.theme, ...(patch.theme ?? {}) },
      ai: { ...s.settings.ai, ...(patch.ai ?? {}) },
      updatedAt: new Date().toISOString(),
    }
    return clone(s.settings)
  }
}
