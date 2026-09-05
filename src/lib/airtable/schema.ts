/**
 * The canonical Airtable schema (Data Holding Map, all five domains).
 *
 * This file is the base template for the white-label kit: `npm run base:bootstrap`
 * creates every table and field below in an empty base, then `npm run fields:refresh`
 * writes the field IDs to `fields.generated.ts`. Components and workers bind to those
 * IDs — a field renamed in Airtable never breaks the app.
 *
 * `key` is the domain-model property. `name` is what a human sees in Airtable.
 */

export type FieldType =
  | 'singleLineText'
  | 'multilineText'
  | 'email'
  | 'phoneNumber'
  | 'url'
  | 'number'
  | 'currency'
  | 'percent'
  | 'checkbox'
  | 'date'
  | 'dateTime'
  | 'singleSelect'
  | 'multipleSelects'
  | 'multipleRecordLinks'
  | 'formula'
  | 'rollup'
  | 'lookup'
  | 'createdTime'
  | 'lastModifiedTime'

export interface FieldSpec {
  key: string
  name: string
  type: FieldType
  /** Single/multi-select choices. Enums are single-selects → paper-ink LEDs. */
  choices?: string[]
  /** Link target table key. */
  link?: TableKey
  description?: string
  /** True for lookups/rollups/formulas — the app renders these read-only. */
  computed?: boolean
}

export type TableKey =
  | 'deals'
  | 'clients'
  | 'contacts'
  | 'journalOrders'
  | 'payments'
  | 'scheduleLegs'
  | 'tasks'
  | 'drafts'
  | 'emails'
  | 'proposals'
  | 'dealProposals'
  | 'dateConflicts'
  | 'auditLog'
  | 'notifications'
  | 'users'
  | 'researchBriefs'
  | 'mirrorState'
  | 'usageLog'
  | 'settings'
  | 'templates'

export interface TableSpec {
  key: TableKey
  name: string
  domain: 'CRM' | 'Deals' | 'Journal' | 'Money' | 'System'
  description: string
  fields: FieldSpec[]
}

const STAGES = ['Inquiry', 'Sales', 'Closed-Won', 'Pre-Event', 'Delivered', 'Debriefed', 'Dormant']

export const TABLES: Record<TableKey, TableSpec> = {
  // ── Domain 1 — CRM / Identity ────────────────────────────────────────────
  clients: {
    key: 'clients',
    name: 'Clients',
    domain: 'CRM',
    description: 'Companies. Knows nothing about any specific deal.',
    fields: [
      { key: 'name', name: 'Company Name', type: 'singleLineText' },
      {
        key: 'domain',
        name: 'Company Domain',
        type: 'singleLineText',
        description: 'HubSpot dedupe key. F13 flags clients missing it.',
      },
      { key: 'industry', name: 'Industry', type: 'singleLineText' },
      { key: 'website', name: 'Website', type: 'url' },
      { key: 'hq', name: 'HQ', type: 'singleLineText' },
      { key: 'notes', name: 'Relationship Notes', type: 'multilineText' },
      { key: 'dealIds', name: 'Deals', type: 'multipleRecordLinks', link: 'deals' },
      { key: 'contactIds', name: 'Contacts', type: 'multipleRecordLinks', link: 'contacts' },
    ],
  },
  contacts: {
    key: 'contacts',
    name: 'Contacts',
    domain: 'CRM',
    description: 'People. One person, one record, forever. Bureau vs direct = Type, not a table.',
    fields: [
      { key: 'name', name: 'Name', type: 'singleLineText' },
      { key: 'email', name: 'Email', type: 'email' },
      { key: 'phone', name: 'Phone', type: 'phoneNumber' },
      {
        key: 'type',
        name: 'Type',
        type: 'singleSelect',
        choices: ['Bureau Agent', 'Meeting Planner', 'Decision Maker', 'Onsite'],
      },
      { key: 'title', name: 'Job Title', type: 'singleLineText' },
      { key: 'agency', name: 'Agency', type: 'singleLineText' },
      {
        key: 'keyAgent',
        name: 'Key Agent',
        type: 'checkbox',
        description: 'F2 forwards their mail to Ben instantly. A flag, never a hardcoded list.',
      },
      { key: 'clientId', name: 'Client', type: 'multipleRecordLinks', link: 'clients' },
      { key: 'dealIds', name: 'Deals', type: 'multipleRecordLinks', link: 'deals' },
      { key: 'notes', name: 'History Notes', type: 'multilineText' },
    ],
  },

  // ── Domain 2 — Deals / Operations ────────────────────────────────────────
  deals: {
    key: 'deals',
    name: 'Deals',
    domain: 'Deals',
    description: 'The six-stage record. One row from first inquiry to debrief.',
    fields: [
      { key: 'name', name: 'Deal Name', type: 'singleLineText' },
      { key: 'stage', name: 'Stage', type: 'singleSelect', choices: STAGES },
      { key: 'source', name: 'Source', type: 'singleSelect', choices: ['Direct', 'Bureau'] },
      { key: 'dealType', name: 'Deal Type', type: 'singleLineText' },
      { key: 'client', name: 'Client', type: 'multipleRecordLinks', link: 'clients' },
      { key: 'bureauAgent', name: 'Bureau Agent', type: 'multipleRecordLinks', link: 'contacts' },
      { key: 'owner', name: 'Owner', type: 'singleLineText' },

      { key: 'listFee', name: 'List Fee', type: 'currency' },
      { key: 'negotiatedFee', name: 'Negotiated Fee', type: 'currency' },
      { key: 'decisionDate', name: 'Decision Date', type: 'date' },
      { key: 'proposalSent', name: 'Proposal Sent', type: 'checkbox' },
      { key: 'holdDate', name: 'Hold Date', type: 'date' },
      {
        key: 'holdOrder',
        name: 'Hold Order',
        type: 'number',
        description: 'First hold on a date is 1. Read from the "(2)"/"(3)" convention, or hold creation time.',
      },

      { key: 'eventDate', name: 'Event Date', type: 'date' },
      { key: 'location', name: 'Location', type: 'singleLineText' },
      {
        key: 'avCheckTime',
        name: 'AV Check Time',
        type: 'singleLineText',
        description: 'Text, with timezone written in — never a date field.',
      },
      { key: 'stageTime', name: 'Stage Time', type: 'singleLineText' },
      { key: 'eventUrl', name: 'Event URL', type: 'url' },

      { key: 'questionnaireReceived', name: 'Questionnaire Received', type: 'checkbox' },
      { key: 'audienceProfile', name: 'Audience Profile', type: 'multilineText' },
      { key: 'desiredOutcomes', name: 'Desired Outcomes', type: 'multilineText' },
      { key: 'kickoffNotes', name: 'Kickoff Notes', type: 'multilineText' },
      { key: 'postKeynoteNotes', name: 'Post-Keynote Notes', type: 'multilineText' },

      { key: 'hotel', name: 'Hotel', type: 'singleLineText' },
      { key: 'travelNotes', name: 'Travel Notes', type: 'multilineText' },
      { key: 'logisticsComplete', name: 'Logistics Complete', type: 'checkbox' },

      {
        key: 'paymentStatus',
        name: 'Payment Status',
        type: 'singleSelect',
        choices: ['Unbilled', 'Invoiced', 'Partial', 'Paid', 'Overdue'],
        computed: true,
        description: 'Rollup from Payments. Read-only everywhere — money owns it.',
      },
      {
        key: 'contractStatus',
        name: 'Contract Status',
        type: 'singleSelect',
        choices: ['None', 'Out', 'Signed'],
        computed: true,
        description: 'Rollup from Payments/Schedule Legs. Gates entry to Pre-Event.',
      },

      { key: 'driveFolderUrl', name: 'Drive Folder', type: 'url' },

      // Provenance. `Source` above is the lane (Direct/Bureau) and must not be
      // overloaded to mean "where this row came from" — that is what these are.
      {
        key: 'historical',
        name: 'Historical',
        type: 'checkbox',
        description: 'Imported history. Excluded from timers, digests and the staleness sweep, forever.',
      },
      {
        key: 'importBatch',
        name: 'Import Batch',
        type: 'singleLineText',
        description: 'Reversal handle, e.g. import-history-2026-09. Empty for deals born in Louis.',
      },
      {
        key: 'sourceRef',
        name: 'Source Ref',
        type: 'singleLineText',
        description: 'Originating calendar event ID / sheet row / thread ID, so a seed can be traced back.',
      },
      { key: 'createdAt', name: 'Created', type: 'createdTime', computed: true },
      { key: 'lastModified', name: 'Last Modified', type: 'lastModifiedTime', computed: true },
    ],
  },
  tasks: {
    key: 'tasks',
    name: 'Tasks',
    domain: 'Deals',
    description: 'Mini pipelines are Tasks filtered by deal+stage — one mechanism, many views.',
    fields: [
      { key: 'title', name: 'Title', type: 'singleLineText' },
      { key: 'dealId', name: 'Deal', type: 'multipleRecordLinks', link: 'deals' },
      { key: 'assignee', name: 'Assignee', type: 'email' },
      { key: 'dueDate', name: 'Due', type: 'date' },
      {
        key: 'source',
        name: 'Source',
        type: 'singleSelect',
        choices: ['Stage Packet', 'Timer', 'Manual'],
      },
      { key: 'stage', name: 'Stage', type: 'singleSelect', choices: STAGES },
      { key: 'done', name: 'Done', type: 'checkbox' },
      { key: 'createdAt', name: 'Created', type: 'createdTime', computed: true },
    ],
  },
  drafts: {
    key: 'drafts',
    name: 'Drafts',
    domain: 'Deals',
    description: 'System-written outbound. THE review queue. Nothing leaves without a human.',
    fields: [
      { key: 'dealId', name: 'Deal', type: 'multipleRecordLinks', link: 'deals' },
      {
        key: 'type',
        name: 'Type',
        type: 'singleSelect',
        choices: ['Ack', 'Proposal', 'Follow-Up', 'Forcing', 'Kit', 'Journal', 'Debrief', 'Chase'],
      },
      { key: 'subject', name: 'Subject', type: 'singleLineText' },
      { key: 'body', name: 'Body', type: 'multilineText' },
      {
        key: 'status',
        name: 'Status',
        type: 'singleSelect',
        choices: ['Proposed', 'Approved', 'Sent', 'Dismissed'],
      },
      { key: 'toEmail', name: 'To', type: 'email' },
      { key: 'approver', name: 'Approver', type: 'email' },
      { key: 'sentAt', name: 'Sent At', type: 'dateTime' },
      { key: 'threadId', name: 'Thread ID', type: 'singleLineText' },
      { key: 'checkerVerdict', name: 'Checker Verdict', type: 'multilineText' },
      { key: 'revisions', name: 'Revisions', type: 'multilineText' },
      { key: 'createdAt', name: 'Created', type: 'createdTime', computed: true },
    ],
  },
  emails: {
    key: 'emails',
    name: 'Emails',
    domain: 'Deals',
    description: 'Ingested message metadata + Drive body reference. Raw material, never edited.',
    fields: [
      { key: 'subject', name: 'Subject', type: 'singleLineText' },
      { key: 'from', name: 'From', type: 'email' },
      { key: 'to', name: 'To', type: 'singleLineText' },
      { key: 'threadId', name: 'Thread ID', type: 'singleLineText' },
      { key: 'receivedAt', name: 'Received', type: 'dateTime' },
      { key: 'bodyRef', name: 'Body Ref', type: 'url' },
      { key: 'dealId', name: 'Deal', type: 'multipleRecordLinks', link: 'deals' },
      {
        key: 'classification',
        name: 'Classification',
        type: 'singleSelect',
        choices: ['Inquiry', 'Update', 'Noise', 'Unclassified'],
      },
      {
        key: 'extractionStatus',
        name: 'Extraction Status',
        type: 'singleSelect',
        choices: ['Pending', 'Extracted', 'Error'],
      },
    ],
  },
  proposals: {
    key: 'proposals',
    name: 'Field Proposals',
    domain: 'Deals',
    description: 'F4. A value that conflicts with an existing one is never written silently.',
    fields: [
      { key: 'dealId', name: 'Deal', type: 'multipleRecordLinks', link: 'deals' },
      { key: 'field', name: 'Field Key', type: 'singleLineText' },
      { key: 'fieldLabel', name: 'Field', type: 'singleLineText' },
      { key: 'oldValue', name: 'Old Value', type: 'singleLineText' },
      { key: 'newValue', name: 'New Value', type: 'singleLineText' },
      { key: 'sourceEmailId', name: 'Source Email', type: 'multipleRecordLinks', link: 'emails' },
      {
        key: 'status',
        name: 'Status',
        type: 'singleSelect',
        choices: ['Proposed', 'Accepted', 'Dismissed'],
      },
      { key: 'confidence', name: 'Confidence', type: 'percent' },
      { key: 'resolvedBy', name: 'Resolved By', type: 'email' },
      { key: 'createdAt', name: 'Created', type: 'createdTime', computed: true },
    ],
  },
  auditLog: {
    key: 'auditLog',
    name: 'Audit Log',
    domain: 'Deals',
    description: 'Every AI/automation/human write. Append-only, read-only in the app.',
    fields: [
      { key: 'entity', name: 'Entity', type: 'singleLineText' },
      { key: 'entityId', name: 'Record ID', type: 'singleLineText' },
      { key: 'field', name: 'Field', type: 'singleLineText' },
      { key: 'oldValue', name: 'Old Value', type: 'multilineText' },
      { key: 'newValue', name: 'New Value', type: 'multilineText' },
      { key: 'actor', name: 'Actor', type: 'singleLineText' },
      { key: 'actorKind', name: 'Actor Kind', type: 'singleSelect', choices: ['Human', 'Agent'] },
      { key: 'source', name: 'Source', type: 'singleLineText' },
      {
        key: 'batchId',
        name: 'Batch ID',
        type: 'singleLineText',
        description: 'Groups a bulk operation so it can be reversed as one unit. Empty for ordinary writes.',
      },
      { key: 'reversible', name: 'Reversible', type: 'checkbox' },
      { key: 'at', name: 'At', type: 'dateTime' },
    ],
  },
  researchBriefs: {
    key: 'researchBriefs',
    name: 'Research Briefs',
    domain: 'Deals',
    description: 'F3 prep-doc per inquiry. Every claim carries a source link or it is flagged.',
    fields: [
      { key: 'dealId', name: 'Deal', type: 'multipleRecordLinks', link: 'deals' },
      { key: 'companyFacts', name: 'Company Facts', type: 'multilineText' },
      { key: 'mvv', name: 'Mission / Vision / Values', type: 'multilineText' },
      { key: 'budgetSignals', name: 'Budget Signals', type: 'multilineText' },
      { key: 'notes', name: 'Notes', type: 'multilineText' },
      { key: 'sources', name: 'Sources', type: 'multilineText' },
      { key: 'model', name: 'Model Used', type: 'singleLineText' },
      { key: 'checkedBy', name: 'Checked By', type: 'singleLineText' },
      { key: 'checkerVerdict', name: 'Checker Verdict', type: 'multilineText' },
      { key: 'createdAt', name: 'Created', type: 'createdTime', computed: true },
    ],
  },

  dealProposals: {
    key: 'dealProposals',
    name: 'Deal Proposals',
    domain: 'Deals',
    description:
      'Phase C seed output. A whole deal a machine thinks exists — from the calendar, the ' +
      'inboxes, the tracking sheets or QuickBooks. No deal enters Louis until a human ' +
      'accepted a row here. Field Proposals is the other shape: one field on a deal that ' +
      'already exists.',
    fields: [
      { key: 'title', name: 'Proposal', type: 'singleLineText' },
      {
        key: 'seedSource',
        name: 'Seed Source',
        type: 'singleSelect',
        choices: ['Calendar', 'Inbox', 'Sheets', 'QuickBooks'],
      },
      { key: 'batchId', name: 'Batch ID', type: 'singleLineText' },
      {
        key: 'status',
        name: 'Status',
        type: 'singleSelect',
        choices: ['Proposed', 'Accepted', 'Merged', 'Dismissed'],
      },
      {
        key: 'confidence',
        name: 'Confidence',
        type: 'percent',
        description: 'How sure the extractor is. Drives which rows are safe to bulk-accept.',
      },

      // What it proposes. Client is held as both text and link: the text is what the
      // source actually said, the link is the fuzzy match, and C5 needs to see both.
      { key: 'clientName', name: 'Client Name', type: 'singleLineText' },
      { key: 'clientId', name: 'Client', type: 'multipleRecordLinks', link: 'clients' },
      { key: 'contactName', name: 'Contact Name', type: 'singleLineText' },
      { key: 'contactId', name: 'Contact', type: 'multipleRecordLinks', link: 'contacts' },
      { key: 'stage', name: 'Stage', type: 'singleSelect', choices: STAGES },
      { key: 'lane', name: 'Lane', type: 'singleSelect', choices: ['Direct', 'Bureau'] },
      { key: 'eventDate', name: 'Event Date', type: 'date' },
      { key: 'holdDate', name: 'Hold Date', type: 'date' },
      { key: 'holdOrder', name: 'Hold Order', type: 'number' },
      { key: 'location', name: 'Location', type: 'singleLineText' },
      { key: 'negotiatedFee', name: 'Negotiated Fee', type: 'currency' },
      { key: 'decisionDate', name: 'Decision Date', type: 'date' },
      { key: 'historical', name: 'Historical', type: 'checkbox' },

      { key: 'sourceRef', name: 'Source Ref', type: 'singleLineText' },
      {
        key: 'sources',
        name: 'Sources',
        type: 'multilineText',
        description: 'Every event ID and thread ID behind this row. A proposal with no source is a bug.',
      },
      { key: 'notes', name: 'Notes', type: 'multilineText' },
      { key: 'conflictId', name: 'Date Conflict', type: 'multipleRecordLinks', link: 'dateConflicts' },
      { key: 'dealId', name: 'Accepted Deal', type: 'multipleRecordLinks', link: 'deals' },
      { key: 'resolvedBy', name: 'Resolved By', type: 'email' },
      { key: 'createdAt', name: 'Created', type: 'createdTime', computed: true },
    ],
  },
  dateConflicts: {
    key: 'dateConflicts',
    name: 'Date Conflicts',
    domain: 'Deals',
    description:
      'Two or more holds on one date. Ben resolves these — including "both feasible", which ' +
      'is a real answer and not a failure to decide.',
    fields: [
      { key: 'label', name: 'Conflict', type: 'singleLineText' },
      { key: 'date', name: 'Date', type: 'date' },
      {
        key: 'status',
        name: 'Status',
        type: 'singleSelect',
        choices: ['Open', 'Resolved', 'Both Feasible'],
      },
      { key: 'proposalIds', name: 'Proposals', type: 'multipleRecordLinks', link: 'dealProposals' },
      { key: 'dealIds', name: 'Deals', type: 'multipleRecordLinks', link: 'deals' },
      { key: 'resolution', name: 'Resolution', type: 'multilineText' },
      { key: 'resolvedBy', name: 'Resolved By', type: 'email' },
      { key: 'createdAt', name: 'Created', type: 'createdTime', computed: true },
    ],
  },

  // ── Domain 3 — Journal / Merch ───────────────────────────────────────────
  journalOrders: {
    key: 'journalOrders',
    name: 'Journal Orders',
    domain: 'Journal',
    description: 'The sidecar. Deal link is optional on purpose — Amazon tail, IG, dropships.',
    fields: [
      { key: 'reference', name: 'Reference', type: 'singleLineText' },
      {
        key: 'status',
        name: 'Status',
        type: 'singleSelect',
        choices: [
          'Mentioned',
          'Promo Sent',
          'Received',
          'Interested',
          'Bulk Ordered',
          'Shipped',
          'Dropship',
        ],
      },
      { key: 'quantity', name: 'Quantity', type: 'number' },
      { key: 'shipTo', name: 'Ship To', type: 'multilineText' },
      { key: 'shipByDate', name: 'Ship By', type: 'date' },
      { key: 'warehouseNotes', name: 'Warehouse Notes', type: 'multilineText' },
      { key: 'inserts', name: 'Inserts', type: 'checkbox' },
      { key: 'dealId', name: 'Deal', type: 'multipleRecordLinks', link: 'deals' },
      { key: 'clientId', name: 'Client', type: 'multipleRecordLinks', link: 'clients' },
    ],
  },

  // ── Domain 4 — Money (permission-hidden table group) ─────────────────────
  payments: {
    key: 'payments',
    name: 'Payments',
    domain: 'Money',
    description: 'Human-confirmed only. The matcher proposes; a person confirms.',
    fields: [
      { key: 'dealId', name: 'Deal', type: 'multipleRecordLinks', link: 'deals' },
      { key: 'invoiceNumber', name: 'Invoice Number', type: 'singleLineText' },
      { key: 'amount', name: 'Amount', type: 'currency' },
      { key: 'status', name: 'Status', type: 'singleSelect', choices: ['Proposed', 'Confirmed'] },
      { key: 'method', name: 'Method', type: 'singleLineText' },
      { key: 'receivedDate', name: 'Received', type: 'date' },
      { key: 'confirmedBy', name: 'Confirmed By', type: 'email' },
      { key: 'note', name: 'Note', type: 'multilineText' },
    ],
  },
  scheduleLegs: {
    key: 'scheduleLegs',
    name: 'Schedule Legs',
    domain: 'Money',
    description: 'Payment schedule per deal (deposit / balance / expenses).',
    fields: [
      { key: 'dealId', name: 'Deal', type: 'multipleRecordLinks', link: 'deals' },
      { key: 'label', name: 'Label', type: 'singleLineText' },
      { key: 'amount', name: 'Amount', type: 'currency' },
      { key: 'dueDate', name: 'Due', type: 'date' },
      { key: 'paid', name: 'Paid', type: 'checkbox' },
    ],
  },

  // ── System ───────────────────────────────────────────────────────────────
  notifications: {
    key: 'notifications',
    name: 'Notifications',
    domain: 'System',
    description: 'In-app bell + email fanout. Internal addresses only, never client-facing.',
    fields: [
      { key: 'user', name: 'User', type: 'email' },
      {
        key: 'type',
        name: 'Type',
        type: 'singleSelect',
        choices: [
          'Review Item',
          'Red Alert',
          'Worker Failure',
          'Payment Confirmed',
          'Contract Signed',
          'Cap Warning',
          'QA Digest',
          'Mention',
        ],
      },
      { key: 'title', name: 'Title', type: 'singleLineText' },
      { key: 'body', name: 'Body', type: 'multilineText' },
      { key: 'link', name: 'Link', type: 'singleLineText' },
      { key: 'read', name: 'Read', type: 'checkbox' },
      { key: 'emailed', name: 'Emailed', type: 'checkbox' },
      { key: 'createdAt', name: 'Created', type: 'createdTime', computed: true },
    ],
  },
  users: {
    key: 'users',
    name: 'Users',
    domain: 'System',
    description: 'The allowlist. Break-glass path: an admin edits this table directly in Airtable.',
    fields: [
      { key: 'email', name: 'Email', type: 'email' },
      { key: 'name', name: 'Name', type: 'singleLineText' },
      {
        key: 'role',
        name: 'Role',
        type: 'singleSelect',
        choices: ['owner', 'admin', 'ops', 'accountant'],
      },
      { key: 'active', name: 'Active', type: 'checkbox' },
      { key: 'landingPage', name: 'Landing Page', type: 'singleLineText' },
      { key: 'notificationPrefs', name: 'Notification Prefs', type: 'multilineText' },
      { key: 'showMoneyAmounts', name: 'Show Money Amounts', type: 'checkbox' },
      { key: 'theme', name: 'Theme', type: 'singleSelect', choices: ['light', 'dark', 'system'] },
    ],
  },
  mirrorState: {
    key: 'mirrorState',
    name: 'Mirror State',
    domain: 'System',
    description: 'Per-surface push state for F9 + the weekly integrity check.',
    fields: [
      {
        key: 'surface',
        name: 'Surface',
        type: 'singleSelect',
        choices: ['Calendar', 'Doc', 'Sheet', 'Drive'],
      },
      { key: 'entity', name: 'Entity', type: 'singleLineText' },
      { key: 'entityId', name: 'Record ID', type: 'singleLineText' },
      { key: 'lastPushed', name: 'Last Pushed', type: 'dateTime' },
      { key: 'ok', name: 'OK', type: 'checkbox' },
      { key: 'error', name: 'Error', type: 'multilineText' },
    ],
  },
  usageLog: {
    key: 'usageLog',
    name: 'Usage Log',
    domain: 'System',
    description: 'One row per model call. Never silent — failures log an err row too.',
    fields: [
      { key: 'at', name: 'At', type: 'dateTime' },
      { key: 'worker', name: 'Worker', type: 'singleLineText' },
      { key: 'task', name: 'Task', type: 'singleLineText' },
      { key: 'model', name: 'Model', type: 'singleLineText' },
      { key: 'tier', name: 'Tier', type: 'singleSelect', choices: ['haiku', 'sonnet', 'opus'] },
      { key: 'tokensIn', name: 'Tokens In', type: 'number' },
      { key: 'tokensOut', name: 'Tokens Out', type: 'number' },
      { key: 'estCost', name: 'Est Cost', type: 'number' },
      {
        key: 'backend',
        name: 'Backend',
        type: 'singleSelect',
        choices: ['claude-code', 'openrouter'],
      },
      { key: 'dealId', name: 'Deal', type: 'multipleRecordLinks', link: 'deals' },
      { key: 'durationMs', name: 'Duration ms', type: 'number' },
      { key: 'ok', name: 'OK', type: 'checkbox' },
      { key: 'error', name: 'Error', type: 'multilineText' },
      { key: 'estimated', name: 'Estimated', type: 'checkbox' },
    ],
  },
  settings: {
    key: 'settings',
    name: 'Settings',
    domain: 'System',
    description: 'Singleton rows: Theme, AI. Never holds a secret — keys live in env only.',
    fields: [
      { key: 'key', name: 'Key', type: 'singleLineText' },
      { key: 'value', name: 'Value', type: 'multilineText' },
      { key: 'updatedAt', name: 'Updated', type: 'dateTime' },
    ],
  },
  templates: {
    key: 'templates',
    name: 'Templates',
    domain: 'System',
    description: "Script bank as data — a new speaker's voice is a row edit, not a deploy.",
    fields: [
      { key: 'key', name: 'Key', type: 'singleLineText' },
      { key: 'label', name: 'Label', type: 'singleLineText' },
      { key: 'subject', name: 'Subject', type: 'singleLineText' },
      { key: 'body', name: 'Body', type: 'multilineText' },
      { key: 'notes', name: 'Notes', type: 'multilineText' },
    ],
  },
}

export const TABLE_KEYS = Object.keys(TABLES) as TableKey[]

/** Money tables — nothing outside the money group writes these. */
export const MONEY_TABLES: TableKey[] = ['payments', 'scheduleLegs']

/**
 * Config, not content. The go-live purge empties every other table and leaves these
 * alone: they are the speaker's setup, not Ben's bookings, and re-creating them by hand
 * after a cutover is exactly the kind of silent data loss the runbook is guarding against.
 */
export const PRESERVED_TABLES: TableKey[] = ['users', 'settings', 'templates']

/** Everything the purge empties — derived, so a new table is purgeable by default. */
export const PURGEABLE_TABLES: TableKey[] = TABLE_KEYS.filter(
  (k) => !PRESERVED_TABLES.includes(k),
)
