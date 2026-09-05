/**
 * The Airtable implementation of the data seam.
 *
 * Reads and writes go by field ID (`fieldRef`), so renaming a field in Airtable is a
 * non-event. Rollup/lookup fields (Payment Status, Contract Status) are decoded but
 * never encoded — money owns them, and `rbac.canWrite` refuses them before we get here.
 */

import { fieldRef, refsFor } from '../airtable/fields'
import type { TableKey } from '../airtable/schema'
import {
  createRecords,
  formulaValue,
  getRecord,
  listRecords,
  readConfig,
  updateRecord,
  type AirtableConfig,
  type AirtableRecord,
} from '../airtable/rest'
import { defaultThemeSettings } from '../theme'
import { defaultNotificationPrefs } from '../rbac'
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
  Ref,
  ResearchBrief,
  ScheduleLeg,
  Settings,
  Task,
  UsageLogRow,
  User,
} from '../types'
import type {
  DataProvider,
  DealFilter,
  DraftFilter,
  NewRecord,
  TaskFilter,
} from './provider'
import {
  actorKindCodec,
  backendCodec,
  bool,
  classificationCodec,
  contactTypeCodec,
  contractStatusCodec,
  dateConflictStatusCodec,
  dealProposalStatusCodec,
  draftStatusCodec,
  draftTypeCodec,
  extractionStatusCodec,
  firstLink,
  seedSourceCodec,
  jsonField,
  journalStatusCodec,
  linkIds,
  mirrorSurfaceCodec,
  notificationTypeCodec,
  num,
  paymentRecordStatusCodec,
  paymentStatusCodec,
  proposalStatusCodec,
  reqStr,
  sourceCodec,
  stageCodec,
  str,
  taskSourceCodec,
  tierCodec,
  unwrapRollup,
} from './airtable-codec'

const NAME_CACHE_TTL_MS = 60_000

/** Reads a decoded field off a record, tolerating both ID-keyed and name-keyed payloads. */
function makeReader(table: TableKey, record: AirtableRecord) {
  const refs = refsFor(table)
  return (key: string): unknown => {
    const ref = refs[key]
    if (ref && ref in record.fields) return record.fields[ref]
    return undefined
  }
}

export class AirtableProvider implements DataProvider {
  readonly kind = 'airtable' as const
  private nameCache: { at: number; names: Map<string, string> } | null = null

  constructor(private readonly cfg: AirtableConfig) {}

  static fromEnv(): AirtableProvider | null {
    const cfg = readConfig()
    return cfg ? new AirtableProvider(cfg) : null
  }

  private w(table: TableKey, patch: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue
      out[fieldRef(table, key)] = value
    }
    return out
  }

  /**
   * Link fields carry IDs only. Deal cards want the client's name, so we keep a
   * short-lived name map — the same pragmatic cache the search layer uses, and far
   * cheaper than a lookup field per link.
   */
  private async names(): Promise<Map<string, string>> {
    if (this.nameCache && Date.now() - this.nameCache.at < NAME_CACHE_TTL_MS) {
      return this.nameCache.names
    }
    const names = new Map<string, string>()
    const [clients, contacts] = await Promise.all([
      listRecords(this.cfg, 'clients'),
      listRecords(this.cfg, 'contacts'),
    ])
    for (const r of clients) names.set(r.id, reqStr(makeReader('clients', r)('name'), 'Untitled'))
    for (const r of contacts) names.set(r.id, reqStr(makeReader('contacts', r)('name'), 'Unknown'))
    this.nameCache = { at: Date.now(), names }
    return names
  }

  private ref(id: string | null, names: Map<string, string>): Ref | null {
    if (!id) return null
    return { id, name: names.get(id) ?? id }
  }

  // ── Deals ────────────────────────────────────────────────────────────────

  private decodeDeal(record: AirtableRecord, names: Map<string, string>): Deal {
    const f = makeReader('deals', record)
    return {
      id: record.id,
      name: reqStr(f('name'), 'Untitled deal'),
      stage: stageCodec.fromAirtable(f('stage'), 'inquiry'),
      source: sourceCodec.fromAirtable(f('source'), 'direct'),
      dealType: str(f('dealType')),
      client: this.ref(firstLink(f('client')), names),
      bureauAgent: this.ref(firstLink(f('bureauAgent')), names),
      owner: str(f('owner')),
      listFee: num(f('listFee')),
      negotiatedFee: num(f('negotiatedFee')),
      decisionDate: str(f('decisionDate')),
      proposalSent: bool(f('proposalSent')),
      holdDate: str(f('holdDate')),
      holdOrder: num(f('holdOrder')),
      eventDate: str(f('eventDate')),
      location: str(f('location')),
      avCheckTime: str(f('avCheckTime')),
      stageTime: str(f('stageTime')),
      eventUrl: str(f('eventUrl')),
      questionnaireReceived: bool(f('questionnaireReceived')),
      audienceProfile: str(f('audienceProfile')),
      desiredOutcomes: str(f('desiredOutcomes')),
      kickoffNotes: str(f('kickoffNotes')),
      postKeynoteNotes: str(f('postKeynoteNotes')),
      hotel: str(f('hotel')),
      travelNotes: str(f('travelNotes')),
      logisticsComplete: bool(f('logisticsComplete')),
      paymentStatus: paymentStatusCodec.fromAirtable(unwrapRollup(f('paymentStatus')), 'unbilled'),
      contractStatus: contractStatusCodec.fromAirtable(unwrapRollup(f('contractStatus')), 'none'),
      driveFolderUrl: str(f('driveFolderUrl')),
      historical: bool(f('historical')),
      importBatch: str(f('importBatch')),
      sourceRef: str(f('sourceRef')),
      createdAt: reqStr(f('createdAt'), record.createdTime),
      lastModified: reqStr(f('lastModified'), record.createdTime),
    }
  }

  private encodeDeal(patch: Partial<Deal>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const set = (key: keyof Deal, value: unknown) => {
      if (patch[key] !== undefined) out[key] = value
    }
    set('name', patch.name)
    set('stage', patch.stage && stageCodec.toAirtable(patch.stage))
    set('source', patch.source && sourceCodec.toAirtable(patch.source))
    set('dealType', patch.dealType)
    set('client', patch.client ? [patch.client.id] : [])
    set('bureauAgent', patch.bureauAgent ? [patch.bureauAgent.id] : [])
    set('owner', patch.owner)
    set('listFee', patch.listFee)
    set('negotiatedFee', patch.negotiatedFee)
    set('decisionDate', patch.decisionDate)
    set('proposalSent', patch.proposalSent)
    set('holdDate', patch.holdDate)
    set('holdOrder', patch.holdOrder)
    set('eventDate', patch.eventDate)
    set('location', patch.location)
    set('avCheckTime', patch.avCheckTime)
    set('stageTime', patch.stageTime)
    set('eventUrl', patch.eventUrl)
    set('questionnaireReceived', patch.questionnaireReceived)
    set('audienceProfile', patch.audienceProfile)
    set('desiredOutcomes', patch.desiredOutcomes)
    set('kickoffNotes', patch.kickoffNotes)
    set('postKeynoteNotes', patch.postKeynoteNotes)
    set('hotel', patch.hotel)
    set('travelNotes', patch.travelNotes)
    set('logisticsComplete', patch.logisticsComplete)
    set('driveFolderUrl', patch.driveFolderUrl)
    set('historical', patch.historical)
    set('importBatch', patch.importBatch)
    set('sourceRef', patch.sourceRef)
    // paymentStatus / contractStatus / createdAt / lastModified are owned elsewhere.
    return this.w('deals', out)
  }

  async listDeals(filter: DealFilter = {}): Promise<Deal[]> {
    const names = await this.names()
    const clauses: string[] = []
    if (filter.stage) {
      clauses.push(`{${fieldRef('deals', 'stage')}} = ${formulaValue(stageCodec.toAirtable(filter.stage as Deal['stage']))}`)
    }
    const records = await listRecords(this.cfg, 'deals', {
      filterByFormula: clauses.length ? `AND(${clauses.join(',')})` : undefined,
    })
    let out = records.map((r) => this.decodeDeal(r, names))
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

  async getDeal(id: string): Promise<Deal | null> {
    const [record, names] = await Promise.all([getRecord(this.cfg, 'deals', id), this.names()])
    return record ? this.decodeDeal(record, names) : null
  }

  async createDeal(input: Partial<Deal> & { name: string }): Promise<Deal> {
    const [created] = await createRecords(this.cfg, 'deals', [
      this.encodeDeal({ stage: 'inquiry', source: 'direct', ...input }),
    ])
    if (!created) throw new Error('Airtable returned no record for createDeal')
    return this.decodeDeal(created, await this.names())
  }

  async updateDeal(id: string, patch: Partial<Deal>): Promise<Deal> {
    const updated = await updateRecord(this.cfg, 'deals', id, this.encodeDeal(patch))
    return this.decodeDeal(updated, await this.names())
  }

  // ── CRM ──────────────────────────────────────────────────────────────────

  private decodeClient(record: AirtableRecord): Client {
    const f = makeReader('clients', record)
    return {
      id: record.id,
      name: reqStr(f('name'), 'Untitled'),
      domain: str(f('domain')),
      industry: str(f('industry')),
      website: str(f('website')),
      hq: str(f('hq')),
      notes: str(f('notes')),
      dealIds: linkIds(f('dealIds')),
      contactIds: linkIds(f('contactIds')),
    }
  }

  async listClients(): Promise<Client[]> {
    const records = await listRecords(this.cfg, 'clients')
    return records.map((r) => this.decodeClient(r)).sort((a, b) => a.name.localeCompare(b.name))
  }

  async getClient(id: string): Promise<Client | null> {
    const record = await getRecord(this.cfg, 'clients', id)
    return record ? this.decodeClient(record) : null
  }

  async createClient(input: Partial<Client> & { name: string }): Promise<Client> {
    const [created] = await createRecords(this.cfg, 'clients', [
      this.w('clients', {
        name: input.name,
        domain: input.domain,
        industry: input.industry,
        website: input.website,
        hq: input.hq,
        notes: input.notes,
      }),
    ])
    if (!created) throw new Error('Airtable returned no record for createClient')
    this.nameCache = null
    return this.decodeClient(created)
  }

  async updateClient(id: string, patch: Partial<Client>): Promise<Client> {
    const updated = await updateRecord(
      this.cfg,
      'clients',
      id,
      this.w('clients', {
        name: patch.name,
        domain: patch.domain,
        industry: patch.industry,
        website: patch.website,
        hq: patch.hq,
        notes: patch.notes,
      }),
    )
    this.nameCache = null
    return this.decodeClient(updated)
  }

  private decodeContact(record: AirtableRecord): Contact {
    const f = makeReader('contacts', record)
    return {
      id: record.id,
      name: reqStr(f('name'), 'Unknown'),
      email: str(f('email')),
      phone: str(f('phone')),
      type: contactTypeCodec.fromAirtable(f('type'), 'decision-maker'),
      title: str(f('title')),
      agency: str(f('agency')),
      keyAgent: bool(f('keyAgent')),
      clientId: firstLink(f('clientId')),
      dealIds: linkIds(f('dealIds')),
      notes: str(f('notes')),
    }
  }

  async listContacts(): Promise<Contact[]> {
    const records = await listRecords(this.cfg, 'contacts')
    return records.map((r) => this.decodeContact(r)).sort((a, b) => a.name.localeCompare(b.name))
  }

  async getContact(id: string): Promise<Contact | null> {
    const record = await getRecord(this.cfg, 'contacts', id)
    return record ? this.decodeContact(record) : null
  }

  private encodeContact(patch: Partial<Contact>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (patch.name !== undefined) out.name = patch.name
    if (patch.email !== undefined) out.email = patch.email
    if (patch.phone !== undefined) out.phone = patch.phone
    if (patch.type !== undefined) out.type = contactTypeCodec.toAirtable(patch.type)
    if (patch.title !== undefined) out.title = patch.title
    if (patch.agency !== undefined) out.agency = patch.agency
    if (patch.keyAgent !== undefined) out.keyAgent = patch.keyAgent
    if (patch.clientId !== undefined) out.clientId = patch.clientId ? [patch.clientId] : []
    if (patch.dealIds !== undefined) out.dealIds = patch.dealIds
    if (patch.notes !== undefined) out.notes = patch.notes
    return this.w('contacts', out)
  }

  async createContact(input: Partial<Contact> & { name: string }): Promise<Contact> {
    const [created] = await createRecords(this.cfg, 'contacts', [this.encodeContact(input)])
    if (!created) throw new Error('Airtable returned no record for createContact')
    this.nameCache = null
    return this.decodeContact(created)
  }

  async updateContact(id: string, patch: Partial<Contact>): Promise<Contact> {
    const updated = await updateRecord(this.cfg, 'contacts', id, this.encodeContact(patch))
    this.nameCache = null
    return this.decodeContact(updated)
  }

  // ── Journal ──────────────────────────────────────────────────────────────

  private decodeJournal(record: AirtableRecord): JournalOrder {
    const f = makeReader('journalOrders', record)
    return {
      id: record.id,
      reference: reqStr(f('reference'), 'Order'),
      status: journalStatusCodec.fromAirtable(f('status'), 'mentioned'),
      quantity: num(f('quantity')),
      shipTo: str(f('shipTo')),
      shipByDate: str(f('shipByDate')),
      warehouseNotes: str(f('warehouseNotes')),
      inserts: bool(f('inserts')),
      dealId: firstLink(f('dealId')),
      clientId: firstLink(f('clientId')),
    }
  }

  private encodeJournal(patch: Partial<JournalOrder>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (patch.reference !== undefined) out.reference = patch.reference
    if (patch.status !== undefined) out.status = journalStatusCodec.toAirtable(patch.status)
    if (patch.quantity !== undefined) out.quantity = patch.quantity
    if (patch.shipTo !== undefined) out.shipTo = patch.shipTo
    if (patch.shipByDate !== undefined) out.shipByDate = patch.shipByDate
    if (patch.warehouseNotes !== undefined) out.warehouseNotes = patch.warehouseNotes
    if (patch.inserts !== undefined) out.inserts = patch.inserts
    if (patch.dealId !== undefined) out.dealId = patch.dealId ? [patch.dealId] : []
    if (patch.clientId !== undefined) out.clientId = patch.clientId ? [patch.clientId] : []
    return this.w('journalOrders', out)
  }

  async listJournalOrders(): Promise<JournalOrder[]> {
    const records = await listRecords(this.cfg, 'journalOrders')
    return records.map((r) => this.decodeJournal(r))
  }

  async createJournalOrder(input: NewRecord<JournalOrder>): Promise<JournalOrder> {
    const [created] = await createRecords(this.cfg, 'journalOrders', [this.encodeJournal(input)])
    if (!created) throw new Error('Airtable returned no record for createJournalOrder')
    return this.decodeJournal(created)
  }

  async updateJournalOrder(id: string, patch: Partial<JournalOrder>): Promise<JournalOrder> {
    return this.decodeJournal(
      await updateRecord(this.cfg, 'journalOrders', id, this.encodeJournal(patch)),
    )
  }

  // ── Money ────────────────────────────────────────────────────────────────

  private decodePayment(record: AirtableRecord): Payment {
    const f = makeReader('payments', record)
    return {
      id: record.id,
      dealId: firstLink(f('dealId')),
      invoiceNumber: str(f('invoiceNumber')),
      amount: num(f('amount')) ?? 0,
      status: paymentRecordStatusCodec.fromAirtable(f('status'), 'proposed'),
      method: str(f('method')),
      receivedDate: str(f('receivedDate')),
      confirmedBy: str(f('confirmedBy')),
      note: str(f('note')),
    }
  }

  private encodePayment(patch: Partial<Payment>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (patch.dealId !== undefined) out.dealId = patch.dealId ? [patch.dealId] : []
    if (patch.invoiceNumber !== undefined) out.invoiceNumber = patch.invoiceNumber
    if (patch.amount !== undefined) out.amount = patch.amount
    if (patch.status !== undefined) out.status = paymentRecordStatusCodec.toAirtable(patch.status)
    if (patch.method !== undefined) out.method = patch.method
    if (patch.receivedDate !== undefined) out.receivedDate = patch.receivedDate
    if (patch.confirmedBy !== undefined) out.confirmedBy = patch.confirmedBy
    if (patch.note !== undefined) out.note = patch.note
    return this.w('payments', out)
  }

  async listPayments(): Promise<Payment[]> {
    const records = await listRecords(this.cfg, 'payments')
    return records.map((r) => this.decodePayment(r))
  }

  async createPayment(input: NewRecord<Payment>): Promise<Payment> {
    const [created] = await createRecords(this.cfg, 'payments', [this.encodePayment(input)])
    if (!created) throw new Error('Airtable returned no record for createPayment')
    return this.decodePayment(created)
  }

  async updatePayment(id: string, patch: Partial<Payment>): Promise<Payment> {
    return this.decodePayment(await updateRecord(this.cfg, 'payments', id, this.encodePayment(patch)))
  }

  async listScheduleLegs(): Promise<ScheduleLeg[]> {
    const records = await listRecords(this.cfg, 'scheduleLegs')
    return records.map((record) => {
      const f = makeReader('scheduleLegs', record)
      return {
        id: record.id,
        dealId: firstLink(f('dealId')) ?? '',
        label: reqStr(f('label'), 'Leg'),
        amount: num(f('amount')) ?? 0,
        dueDate: str(f('dueDate')),
        paid: bool(f('paid')),
      }
    })
  }

  // ── Tasks ────────────────────────────────────────────────────────────────

  private decodeTask(record: AirtableRecord): Task {
    const f = makeReader('tasks', record)
    return {
      id: record.id,
      dealId: firstLink(f('dealId')),
      title: reqStr(f('title'), 'Task'),
      assignee: str(f('assignee')),
      dueDate: str(f('dueDate')),
      source: taskSourceCodec.fromAirtable(f('source'), 'manual'),
      stage: f('stage') ? stageCodec.fromAirtable(f('stage'), 'inquiry') : null,
      done: bool(f('done')),
      createdAt: reqStr(f('createdAt'), record.createdTime),
    }
  }

  private encodeTask(patch: Partial<Task>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (patch.title !== undefined) out.title = patch.title
    if (patch.dealId !== undefined) out.dealId = patch.dealId ? [patch.dealId] : []
    if (patch.assignee !== undefined) out.assignee = patch.assignee
    if (patch.dueDate !== undefined) out.dueDate = patch.dueDate
    if (patch.source !== undefined) out.source = taskSourceCodec.toAirtable(patch.source)
    if (patch.stage !== undefined) out.stage = patch.stage ? stageCodec.toAirtable(patch.stage) : null
    if (patch.done !== undefined) out.done = patch.done
    return this.w('tasks', out)
  }

  async listTasks(filter: TaskFilter = {}): Promise<Task[]> {
    const records = await listRecords(this.cfg, 'tasks')
    let out = records.map((r) => this.decodeTask(r))
    if (filter.dealId) out = out.filter((t) => t.dealId === filter.dealId)
    if (filter.stage) out = out.filter((t) => t.stage === filter.stage)
    if (filter.done !== undefined) out = out.filter((t) => t.done === filter.done)
    if (filter.assignee) out = out.filter((t) => t.assignee === filter.assignee)
    return out.sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
  }

  async createTask(input: NewRecord<Task>): Promise<Task> {
    const [created] = await createRecords(this.cfg, 'tasks', [this.encodeTask(input)])
    if (!created) throw new Error('Airtable returned no record for createTask')
    return this.decodeTask(created)
  }

  async updateTask(id: string, patch: Partial<Task>): Promise<Task> {
    return this.decodeTask(await updateRecord(this.cfg, 'tasks', id, this.encodeTask(patch)))
  }

  // ── Drafts ───────────────────────────────────────────────────────────────

  private decodeDraft(record: AirtableRecord): Draft {
    const f = makeReader('drafts', record)
    return {
      id: record.id,
      dealId: firstLink(f('dealId')),
      type: draftTypeCodec.fromAirtable(f('type'), 'follow-up'),
      subject: reqStr(f('subject')),
      body: reqStr(f('body')),
      status: draftStatusCodec.fromAirtable(f('status'), 'proposed'),
      toEmail: str(f('toEmail')),
      approver: str(f('approver')),
      sentAt: str(f('sentAt')),
      threadId: str(f('threadId')),
      checkerVerdict: jsonField(f('checkerVerdict'), null),
      revisions: jsonField(f('revisions'), []),
      createdAt: reqStr(f('createdAt'), record.createdTime),
    }
  }

  private encodeDraft(patch: Partial<Draft>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (patch.dealId !== undefined) out.dealId = patch.dealId ? [patch.dealId] : []
    if (patch.type !== undefined) out.type = draftTypeCodec.toAirtable(patch.type)
    if (patch.subject !== undefined) out.subject = patch.subject
    if (patch.body !== undefined) out.body = patch.body
    if (patch.status !== undefined) out.status = draftStatusCodec.toAirtable(patch.status)
    if (patch.toEmail !== undefined) out.toEmail = patch.toEmail
    if (patch.approver !== undefined) out.approver = patch.approver
    if (patch.sentAt !== undefined) out.sentAt = patch.sentAt
    if (patch.threadId !== undefined) out.threadId = patch.threadId
    if (patch.checkerVerdict !== undefined) {
      out.checkerVerdict = patch.checkerVerdict ? JSON.stringify(patch.checkerVerdict) : null
    }
    if (patch.revisions !== undefined) out.revisions = JSON.stringify(patch.revisions)
    return this.w('drafts', out)
  }

  async listDrafts(filter: DraftFilter = {}): Promise<Draft[]> {
    const records = await listRecords(this.cfg, 'drafts')
    let out = records.map((r) => this.decodeDraft(r))
    if (filter.dealId) out = out.filter((d) => d.dealId === filter.dealId)
    if (filter.status) out = out.filter((d) => d.status === filter.status)
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async getDraft(id: string): Promise<Draft | null> {
    const record = await getRecord(this.cfg, 'drafts', id)
    return record ? this.decodeDraft(record) : null
  }

  async createDraft(input: NewRecord<Draft>): Promise<Draft> {
    const [created] = await createRecords(this.cfg, 'drafts', [this.encodeDraft(input)])
    if (!created) throw new Error('Airtable returned no record for createDraft')
    return this.decodeDraft(created)
  }

  async updateDraft(id: string, patch: Partial<Draft>): Promise<Draft> {
    return this.decodeDraft(await updateRecord(this.cfg, 'drafts', id, this.encodeDraft(patch)))
  }

  // ── Emails ───────────────────────────────────────────────────────────────

  private decodeEmail(record: AirtableRecord): EmailRecord {
    const f = makeReader('emails', record)
    return {
      id: record.id,
      dealId: firstLink(f('dealId')),
      from: reqStr(f('from')),
      to: reqStr(f('to')),
      subject: reqStr(f('subject')),
      threadId: str(f('threadId')),
      receivedAt: reqStr(f('receivedAt'), record.createdTime),
      bodyRef: str(f('bodyRef')),
      classification: classificationCodec.fromAirtable(f('classification'), 'unclassified'),
      extractionStatus: extractionStatusCodec.fromAirtable(f('extractionStatus'), 'pending'),
    }
  }

  private encodeEmail(patch: Partial<EmailRecord>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (patch.dealId !== undefined) out.dealId = patch.dealId ? [patch.dealId] : []
    if (patch.from !== undefined) out.from = patch.from
    if (patch.to !== undefined) out.to = patch.to
    if (patch.subject !== undefined) out.subject = patch.subject
    if (patch.threadId !== undefined) out.threadId = patch.threadId
    if (patch.receivedAt !== undefined) out.receivedAt = patch.receivedAt
    if (patch.bodyRef !== undefined) out.bodyRef = patch.bodyRef
    if (patch.classification !== undefined) {
      out.classification = classificationCodec.toAirtable(patch.classification)
    }
    if (patch.extractionStatus !== undefined) {
      out.extractionStatus = extractionStatusCodec.toAirtable(patch.extractionStatus)
    }
    return this.w('emails', out)
  }

  async listEmails(dealId?: string): Promise<EmailRecord[]> {
    const records = await listRecords(this.cfg, 'emails')
    const out = records.map((r) => this.decodeEmail(r))
    return (dealId ? out.filter((e) => e.dealId === dealId) : out).sort((a, b) =>
      b.receivedAt.localeCompare(a.receivedAt),
    )
  }

  async createEmail(input: NewRecord<EmailRecord>): Promise<EmailRecord> {
    const [created] = await createRecords(this.cfg, 'emails', [this.encodeEmail(input)])
    if (!created) throw new Error('Airtable returned no record for createEmail')
    return this.decodeEmail(created)
  }

  async updateEmail(id: string, patch: Partial<EmailRecord>): Promise<EmailRecord> {
    return this.decodeEmail(await updateRecord(this.cfg, 'emails', id, this.encodeEmail(patch)))
  }


  // ── Deal proposals (Phase C seed) ────────────────────────────────────────

  private decodeDealProposal(record: AirtableRecord): DealProposal {
    const f = makeReader('dealProposals', record)
    return {
      id: record.id,
      title: reqStr(f('title'), 'Untitled proposal'),
      seedSource: seedSourceCodec.fromAirtable(f('seedSource'), 'calendar'),
      batchId: str(f('batchId')),
      status: dealProposalStatusCodec.fromAirtable(f('status'), 'proposed'),
      confidence: num(f('confidence')),
      clientName: str(f('clientName')),
      clientId: firstLink(f('clientId')),
      contactName: str(f('contactName')),
      contactId: firstLink(f('contactId')),
      stage: stageCodec.fromAirtable(f('stage'), 'inquiry'),
      lane: sourceCodec.fromAirtable(f('lane'), 'direct'),
      eventDate: str(f('eventDate')),
      holdDate: str(f('holdDate')),
      holdOrder: num(f('holdOrder')),
      location: str(f('location')),
      negotiatedFee: num(f('negotiatedFee')),
      decisionDate: str(f('decisionDate')),
      historical: bool(f('historical')),
      sourceRef: str(f('sourceRef')),
      sources: str(f('sources')),
      notes: str(f('notes')),
      conflictId: firstLink(f('conflictId')),
      dealId: firstLink(f('dealId')),
      resolvedBy: str(f('resolvedBy')),
      createdAt: reqStr(f('createdAt'), record.createdTime),
    }
  }

  private encodeDealProposal(patch: Partial<DealProposal>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    const set = (key: keyof DealProposal, value: unknown) => {
      if (patch[key] !== undefined) out[key] = value
    }
    set('title', patch.title)
    set('seedSource', patch.seedSource && seedSourceCodec.toAirtable(patch.seedSource))
    set('batchId', patch.batchId)
    set('status', patch.status && dealProposalStatusCodec.toAirtable(patch.status))
    set('confidence', patch.confidence)
    set('clientName', patch.clientName)
    set('clientId', patch.clientId ? [patch.clientId] : [])
    set('contactName', patch.contactName)
    set('contactId', patch.contactId ? [patch.contactId] : [])
    set('stage', patch.stage && stageCodec.toAirtable(patch.stage))
    set('lane', patch.lane && sourceCodec.toAirtable(patch.lane))
    set('eventDate', patch.eventDate)
    set('holdDate', patch.holdDate)
    set('holdOrder', patch.holdOrder)
    set('location', patch.location)
    set('negotiatedFee', patch.negotiatedFee)
    set('decisionDate', patch.decisionDate)
    set('historical', patch.historical)
    set('sourceRef', patch.sourceRef)
    set('sources', patch.sources)
    set('notes', patch.notes)
    set('conflictId', patch.conflictId ? [patch.conflictId] : [])
    set('dealId', patch.dealId ? [patch.dealId] : [])
    set('resolvedBy', patch.resolvedBy)
    return this.w('dealProposals', out)
  }

  async listDealProposals(status?: DealProposal['status']): Promise<DealProposal[]> {
    const records = await listRecords(this.cfg, 'dealProposals')
    const out = records.map((r) => this.decodeDealProposal(r))
    return (status ? out.filter((p) => p.status === status) : out).sort((a, b) =>
      (a.eventDate ?? '9999').localeCompare(b.eventDate ?? '9999'),
    )
  }

  async createDealProposal(input: NewRecord<DealProposal>): Promise<DealProposal> {
    const [created] = await createRecords(this.cfg, 'dealProposals', [
      this.encodeDealProposal(input),
    ])
    if (!created) throw new Error('Airtable returned no record for createDealProposal')
    return this.decodeDealProposal(created)
  }

  async updateDealProposal(id: string, patch: Partial<DealProposal>): Promise<DealProposal> {
    return this.decodeDealProposal(
      await updateRecord(this.cfg, 'dealProposals', id, this.encodeDealProposal(patch)),
    )
  }

  // ── Date conflicts ───────────────────────────────────────────────────────

  private decodeDateConflict(record: AirtableRecord): DateConflict {
    const f = makeReader('dateConflicts', record)
    return {
      id: record.id,
      label: reqStr(f('label'), 'Date conflict'),
      date: str(f('date')),
      status: dateConflictStatusCodec.fromAirtable(f('status'), 'open'),
      proposalIds: linkIds(f('proposalIds')),
      dealIds: linkIds(f('dealIds')),
      resolution: str(f('resolution')),
      resolvedBy: str(f('resolvedBy')),
      createdAt: reqStr(f('createdAt'), record.createdTime),
    }
  }

  private encodeDateConflict(patch: Partial<DateConflict>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (patch.label !== undefined) out.label = patch.label
    if (patch.date !== undefined) out.date = patch.date
    if (patch.status !== undefined) out.status = dateConflictStatusCodec.toAirtable(patch.status)
    if (patch.proposalIds !== undefined) out.proposalIds = patch.proposalIds
    if (patch.dealIds !== undefined) out.dealIds = patch.dealIds
    if (patch.resolution !== undefined) out.resolution = patch.resolution
    if (patch.resolvedBy !== undefined) out.resolvedBy = patch.resolvedBy
    return this.w('dateConflicts', out)
  }

  async listDateConflicts(status?: DateConflict['status']): Promise<DateConflict[]> {
    const records = await listRecords(this.cfg, 'dateConflicts')
    const out = records.map((r) => this.decodeDateConflict(r))
    return (status ? out.filter((c) => c.status === status) : out).sort((a, b) =>
      (a.date ?? '9999').localeCompare(b.date ?? '9999'),
    )
  }

  async createDateConflict(input: NewRecord<DateConflict>): Promise<DateConflict> {
    const [created] = await createRecords(this.cfg, 'dateConflicts', [
      this.encodeDateConflict(input),
    ])
    if (!created) throw new Error('Airtable returned no record for createDateConflict')
    return this.decodeDateConflict(created)
  }

  async updateDateConflict(id: string, patch: Partial<DateConflict>): Promise<DateConflict> {
    return this.decodeDateConflict(
      await updateRecord(this.cfg, 'dateConflicts', id, this.encodeDateConflict(patch)),
    )
  }

  // ── Field proposals ──────────────────────────────────────────────────────

  private decodeProposal(record: AirtableRecord): FieldProposal {
    const f = makeReader('proposals', record)
    return {
      id: record.id,
      dealId: firstLink(f('dealId')) ?? '',
      field: reqStr(f('field')),
      fieldLabel: reqStr(f('fieldLabel')),
      oldValue: str(f('oldValue')),
      newValue: reqStr(f('newValue')),
      sourceEmailId: firstLink(f('sourceEmailId')),
      status: proposalStatusCodec.fromAirtable(f('status'), 'proposed'),
      createdAt: reqStr(f('createdAt'), record.createdTime),
      resolvedBy: str(f('resolvedBy')),
      confidence: num(f('confidence')),
    }
  }

  private encodeProposal(patch: Partial<FieldProposal>): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (patch.dealId !== undefined) out.dealId = patch.dealId ? [patch.dealId] : []
    if (patch.field !== undefined) out.field = patch.field
    if (patch.fieldLabel !== undefined) out.fieldLabel = patch.fieldLabel
    if (patch.oldValue !== undefined) out.oldValue = patch.oldValue
    if (patch.newValue !== undefined) out.newValue = patch.newValue
    if (patch.sourceEmailId !== undefined) {
      out.sourceEmailId = patch.sourceEmailId ? [patch.sourceEmailId] : []
    }
    if (patch.status !== undefined) out.status = proposalStatusCodec.toAirtable(patch.status)
    if (patch.resolvedBy !== undefined) out.resolvedBy = patch.resolvedBy
    if (patch.confidence !== undefined) out.confidence = patch.confidence
    return this.w('proposals', out)
  }

  async listProposals(status?: FieldProposal['status']): Promise<FieldProposal[]> {
    const records = await listRecords(this.cfg, 'proposals')
    const out = records.map((r) => this.decodeProposal(r))
    return (status ? out.filter((p) => p.status === status) : out).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )
  }

  async getProposal(id: string): Promise<FieldProposal | null> {
    const record = await getRecord(this.cfg, 'proposals', id)
    return record ? this.decodeProposal(record) : null
  }

  async createProposal(input: NewRecord<FieldProposal>): Promise<FieldProposal> {
    const [created] = await createRecords(this.cfg, 'proposals', [this.encodeProposal(input)])
    if (!created) throw new Error('Airtable returned no record for createProposal')
    return this.decodeProposal(created)
  }

  async updateProposal(id: string, patch: Partial<FieldProposal>): Promise<FieldProposal> {
    return this.decodeProposal(
      await updateRecord(this.cfg, 'proposals', id, this.encodeProposal(patch)),
    )
  }

  // ── Audit ────────────────────────────────────────────────────────────────

  async listAudit(entityId?: string, limit = 100): Promise<AuditEntry[]> {
    const records = await listRecords(this.cfg, 'auditLog', { maxRecords: entityId ? undefined : limit })
    const out = records
      .map((record) => {
        const f = makeReader('auditLog', record)
        return {
          id: record.id,
          entity: reqStr(f('entity')),
          entityId: reqStr(f('entityId')),
          field: reqStr(f('field')),
          oldValue: str(f('oldValue')),
          newValue: str(f('newValue')),
          actor: reqStr(f('actor')),
          actorKind: actorKindCodec.fromAirtable(f('actorKind'), 'human'),
          source: str(f('source')),
          batchId: str(f('batchId')),
          at: reqStr(f('at'), record.createdTime),
          reversible: bool(f('reversible')),
        } satisfies AuditEntry
      })
      .filter((a) => !entityId || a.entityId === entityId)
      .sort((a, b) => b.at.localeCompare(a.at))
    return out.slice(0, limit)
  }

  async appendAudit(entry: NewRecord<AuditEntry>): Promise<AuditEntry> {
    const [created] = await createRecords(this.cfg, 'auditLog', [
      this.w('auditLog', {
        entity: entry.entity,
        entityId: entry.entityId,
        field: entry.field,
        oldValue: entry.oldValue,
        newValue: entry.newValue,
        actor: entry.actor,
        actorKind: actorKindCodec.toAirtable(entry.actorKind),
        source: entry.source,
        batchId: entry.batchId,
        reversible: entry.reversible,
        at: entry.at,
      }),
    ])
    if (!created) throw new Error('Airtable returned no record for appendAudit')
    return { ...entry, id: created.id }
  }

  // ── Notifications ────────────────────────────────────────────────────────

  async listNotifications(user: string, limit = 50): Promise<Notification[]> {
    const records = await listRecords(this.cfg, 'notifications', {
      filterByFormula: `{${fieldRef('notifications', 'user')}} = ${formulaValue(user)}`,
    })
    return records
      .map((record) => {
        const f = makeReader('notifications', record)
        return {
          id: record.id,
          user: reqStr(f('user')),
          type: notificationTypeCodec.fromAirtable(f('type'), 'review-item'),
          title: reqStr(f('title')),
          body: str(f('body')),
          link: str(f('link')),
          read: bool(f('read')),
          createdAt: reqStr(f('createdAt'), record.createdTime),
          emailed: bool(f('emailed')),
        } satisfies Notification
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
  }

  async createNotification(input: NewRecord<Notification>): Promise<Notification> {
    const [created] = await createRecords(this.cfg, 'notifications', [
      this.w('notifications', {
        user: input.user,
        type: notificationTypeCodec.toAirtable(input.type),
        title: input.title,
        body: input.body,
        link: input.link,
        read: input.read,
        emailed: input.emailed,
      }),
    ])
    if (!created) throw new Error('Airtable returned no record for createNotification')
    return { ...input, id: created.id }
  }

  async markNotificationsRead(user: string, ids: string[]): Promise<void> {
    const targets = ids.length
      ? ids
      : (await this.listNotifications(user)).filter((n) => !n.read).map((n) => n.id)
    for (const id of targets) {
      await updateRecord(this.cfg, 'notifications', id, this.w('notifications', { read: true }))
    }
  }

  // ── Users ────────────────────────────────────────────────────────────────

  private decodeUser(record: AirtableRecord): User {
    const f = makeReader('users', record)
    const role = (['owner', 'admin', 'ops', 'accountant'] as const).find(
      (r) => r === str(f('role')),
    )
    const resolved = role ?? 'ops'
    return {
      id: record.id,
      email: reqStr(f('email')),
      name: str(f('name')),
      role: resolved,
      active: bool(f('active')),
      landingPage: reqStr(f('landingPage'), '/pipeline'),
      notificationPrefs: jsonField(f('notificationPrefs'), defaultNotificationPrefs(resolved)),
      showMoneyAmounts: bool(f('showMoneyAmounts')),
      theme: (str(f('theme')) as User['theme']) ?? 'system',
    }
  }

  async listUsers(): Promise<User[]> {
    const records = await listRecords(this.cfg, 'users')
    return records.map((r) => this.decodeUser(r))
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const records = await listRecords(this.cfg, 'users', {
      filterByFormula: `LOWER({${fieldRef('users', 'email')}}) = ${formulaValue(email.toLowerCase())}`,
      maxRecords: 1,
    })
    const record = records[0]
    return record ? this.decodeUser(record) : null
  }

  async upsertUser(input: Partial<User> & { email: string }): Promise<User> {
    const existing = await this.getUserByEmail(input.email)
    const encoded = this.w('users', {
      email: input.email,
      name: input.name,
      role: input.role,
      active: input.active,
      landingPage: input.landingPage,
      notificationPrefs: input.notificationPrefs ? JSON.stringify(input.notificationPrefs) : undefined,
      showMoneyAmounts: input.showMoneyAmounts,
      theme: input.theme,
    })
    if (existing) return this.decodeUser(await updateRecord(this.cfg, 'users', existing.id, encoded))
    const [created] = await createRecords(this.cfg, 'users', [encoded])
    if (!created) throw new Error('Airtable returned no record for upsertUser')
    return this.decodeUser(created)
  }

  // ── Research briefs ──────────────────────────────────────────────────────

  async listResearchBriefs(dealId?: string): Promise<ResearchBrief[]> {
    const records = await listRecords(this.cfg, 'researchBriefs')
    const out = records.map((record) => {
      const f = makeReader('researchBriefs', record)
      return {
        id: record.id,
        dealId: firstLink(f('dealId')) ?? '',
        companyFacts: reqStr(f('companyFacts')),
        mvv: str(f('mvv')),
        budgetSignals: str(f('budgetSignals')),
        notes: str(f('notes')),
        sources: reqStr(f('sources')).split('\n').filter(Boolean),
        model: reqStr(f('model')),
        checkedBy: str(f('checkedBy')),
        checkerVerdict: jsonField(f('checkerVerdict'), null),
        createdAt: reqStr(f('createdAt'), record.createdTime),
      } satisfies ResearchBrief
    })
    return dealId ? out.filter((r) => r.dealId === dealId) : out
  }

  async createResearchBrief(input: NewRecord<ResearchBrief>): Promise<ResearchBrief> {
    const [created] = await createRecords(this.cfg, 'researchBriefs', [
      this.w('researchBriefs', {
        dealId: input.dealId ? [input.dealId] : [],
        companyFacts: input.companyFacts,
        mvv: input.mvv,
        budgetSignals: input.budgetSignals,
        notes: input.notes,
        sources: input.sources.join('\n'),
        model: input.model,
        checkedBy: input.checkedBy,
        checkerVerdict: input.checkerVerdict ? JSON.stringify(input.checkerVerdict) : null,
      }),
    ])
    if (!created) throw new Error('Airtable returned no record for createResearchBrief')
    return { ...input, id: created.id }
  }

  // ── Mirror state ─────────────────────────────────────────────────────────

  async listMirrorState(): Promise<MirrorState[]> {
    const records = await listRecords(this.cfg, 'mirrorState')
    return records.map((record) => {
      const f = makeReader('mirrorState', record)
      return {
        id: record.id,
        surface: mirrorSurfaceCodec.fromAirtable(f('surface'), 'drive'),
        entity: reqStr(f('entity')),
        entityId: reqStr(f('entityId')),
        lastPushed: str(f('lastPushed')),
        ok: bool(f('ok')),
        error: str(f('error')),
      } satisfies MirrorState
    })
  }

  async upsertMirrorState(input: NewRecord<MirrorState>): Promise<MirrorState> {
    const encoded = this.w('mirrorState', {
      surface: mirrorSurfaceCodec.toAirtable(input.surface),
      entity: input.entity,
      entityId: input.entityId,
      lastPushed: input.lastPushed,
      ok: input.ok,
      error: input.error,
    })
    const existing = (await this.listMirrorState()).find(
      (m) => m.surface === input.surface && m.entityId === input.entityId,
    )
    if (existing) {
      return { ...input, id: (await updateRecord(this.cfg, 'mirrorState', existing.id, encoded)).id }
    }
    const [created] = await createRecords(this.cfg, 'mirrorState', [encoded])
    if (!created) throw new Error('Airtable returned no record for upsertMirrorState')
    return { ...input, id: created.id }
  }

  // ── Usage log ────────────────────────────────────────────────────────────

  async listUsage(sinceIso?: string): Promise<UsageLogRow[]> {
    const records = await listRecords(this.cfg, 'usageLog', {
      filterByFormula: sinceIso
        ? `IS_AFTER({${fieldRef('usageLog', 'at')}}, ${formulaValue(sinceIso)})`
        : undefined,
    })
    return records.map((record) => {
      const f = makeReader('usageLog', record)
      return {
        id: record.id,
        at: reqStr(f('at'), record.createdTime),
        worker: reqStr(f('worker')),
        task: reqStr(f('task')),
        model: reqStr(f('model')),
        tier: tierCodec.fromAirtable(f('tier'), 'haiku'),
        tokensIn: num(f('tokensIn')) ?? 0,
        tokensOut: num(f('tokensOut')) ?? 0,
        estCost: num(f('estCost')) ?? 0,
        backend: backendCodec.fromAirtable(f('backend'), 'openrouter'),
        dealId: firstLink(f('dealId')),
        durationMs: num(f('durationMs')) ?? 0,
        ok: bool(f('ok')),
        error: str(f('error')),
        estimated: bool(f('estimated')),
      } satisfies UsageLogRow
    })
  }

  async appendUsage(row: NewRecord<UsageLogRow>): Promise<UsageLogRow> {
    const [created] = await createRecords(this.cfg, 'usageLog', [
      this.w('usageLog', {
        at: row.at,
        worker: row.worker,
        task: row.task,
        model: row.model,
        tier: row.tier,
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        estCost: row.estCost,
        backend: row.backend,
        dealId: row.dealId ? [row.dealId] : [],
        durationMs: row.durationMs,
        ok: row.ok,
        error: row.error,
        estimated: row.estimated,
      }),
    ])
    if (!created) throw new Error('Airtable returned no record for appendUsage')
    return { ...row, id: created.id }
  }

  // ── Settings (key/value singleton rows) ──────────────────────────────────

  private async settingsRow(key: string): Promise<AirtableRecord | null> {
    const records = await listRecords(this.cfg, 'settings', {
      filterByFormula: `{${fieldRef('settings', 'key')}} = ${formulaValue(key)}`,
      maxRecords: 1,
    })
    return records[0] ?? null
  }

  async getSettings(): Promise<Settings> {
    const [themeRow, aiRow] = await Promise.all([this.settingsRow('theme'), this.settingsRow('ai')])
    const readValue = (record: AirtableRecord | null) =>
      record ? makeReader('settings', record)('value') : null
    const defaults = defaultSettings()
    return {
      theme: jsonField(readValue(themeRow), defaults.theme),
      ai: { ...defaults.ai, ...jsonField(readValue(aiRow), {}) },
      updatedAt: new Date().toISOString(),
    }
  }

  async saveSettings(patch: Partial<Settings>): Promise<Settings> {
    const current = await this.getSettings()
    const next: Settings = {
      theme: { ...current.theme, ...(patch.theme ?? {}) },
      ai: { ...current.ai, ...(patch.ai ?? {}) },
      updatedAt: new Date().toISOString(),
    }
    for (const key of ['theme', 'ai'] as const) {
      const encoded = this.w('settings', {
        key,
        value: JSON.stringify(next[key]),
        updatedAt: next.updatedAt,
      })
      const row = await this.settingsRow(key)
      if (row) await updateRecord(this.cfg, 'settings', row.id, encoded)
      else await createRecords(this.cfg, 'settings', [encoded])
    }
    return next
  }
}

export function defaultSettings(): Settings {
  return {
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
  }
}
