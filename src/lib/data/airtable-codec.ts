/**
 * Enum codecs.
 *
 * The domain model speaks kebab-case; Airtable single-selects show human labels.
 * The mapping is written out rather than derived, because the two vocabularies do
 * not transform into each other consistently ("Closed-Won" but "Promo Sent"), and a
 * clever rule that is right 90% of the time is worse than a table that is right.
 */

export interface Codec<T extends string> {
  toAirtable(value: T): string
  fromAirtable(value: unknown, fallback: T): T
}

export function codec<T extends string>(pairs: Record<T, string>): Codec<T> {
  const reverse = new Map<string, T>()
  for (const [domain, label] of Object.entries(pairs) as [T, string][]) {
    reverse.set(label.toLowerCase(), domain)
    reverse.set(domain.toLowerCase(), domain)
  }
  return {
    toAirtable: (value) => pairs[value] ?? String(value),
    fromAirtable: (value, fallback) => {
      if (typeof value !== 'string') return fallback
      return reverse.get(value.trim().toLowerCase()) ?? fallback
    },
  }
}

export const stageCodec = codec({
  inquiry: 'Inquiry',
  sales: 'Sales',
  'closed-won': 'Closed-Won',
  'pre-event': 'Pre-Event',
  delivered: 'Delivered',
  debriefed: 'Debriefed',
  dormant: 'Dormant',
} as const)

export const sourceCodec = codec({ direct: 'Direct', bureau: 'Bureau' } as const)

export const paymentStatusCodec = codec({
  unbilled: 'Unbilled',
  invoiced: 'Invoiced',
  partial: 'Partial',
  paid: 'Paid',
  overdue: 'Overdue',
} as const)

export const contractStatusCodec = codec({ none: 'None', out: 'Out', signed: 'Signed' } as const)

export const contactTypeCodec = codec({
  'bureau-agent': 'Bureau Agent',
  'meeting-planner': 'Meeting Planner',
  'decision-maker': 'Decision Maker',
  onsite: 'Onsite',
} as const)

export const draftTypeCodec = codec({
  ack: 'Ack',
  proposal: 'Proposal',
  'follow-up': 'Follow-Up',
  forcing: 'Forcing',
  kit: 'Kit',
  journal: 'Journal',
  debrief: 'Debrief',
  chase: 'Chase',
} as const)

export const draftStatusCodec = codec({
  proposed: 'Proposed',
  approved: 'Approved',
  sent: 'Sent',
  dismissed: 'Dismissed',
} as const)

export const journalStatusCodec = codec({
  mentioned: 'Mentioned',
  'promo-sent': 'Promo Sent',
  received: 'Received',
  interested: 'Interested',
  'bulk-ordered': 'Bulk Ordered',
  shipped: 'Shipped',
  dropship: 'Dropship',
} as const)

export const taskSourceCodec = codec({
  'stage-packet': 'Stage Packet',
  timer: 'Timer',
  manual: 'Manual',
} as const)

export const paymentRecordStatusCodec = codec({
  proposed: 'Proposed',
  confirmed: 'Confirmed',
} as const)

export const classificationCodec = codec({
  inquiry: 'Inquiry',
  update: 'Update',
  noise: 'Noise',
  unclassified: 'Unclassified',
} as const)

export const extractionStatusCodec = codec({
  pending: 'Pending',
  extracted: 'Extracted',
  error: 'Error',
} as const)

export const proposalStatusCodec = codec({
  proposed: 'Proposed',
  accepted: 'Accepted',
  dismissed: 'Dismissed',
} as const)

export const actorKindCodec = codec({ human: 'Human', agent: 'Agent' } as const)

export const notificationTypeCodec = codec({
  'review-item': 'Review Item',
  'red-alert': 'Red Alert',
  'worker-failure': 'Worker Failure',
  'payment-confirmed': 'Payment Confirmed',
  'contract-signed': 'Contract Signed',
  'cap-warning': 'Cap Warning',
  'qa-digest': 'QA Digest',
  mention: 'Mention',
} as const)

export const mirrorSurfaceCodec = codec({
  calendar: 'Calendar',
  doc: 'Doc',
  sheet: 'Sheet',
  drive: 'Drive',
} as const)

export const tierCodec = codec({ haiku: 'haiku', sonnet: 'sonnet', opus: 'opus' } as const)

export const backendCodec = codec({
  'claude-code': 'claude-code',
  openrouter: 'openrouter',
} as const)

// ── primitive readers ───────────────────────────────────────────────────────

export function str(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value === '' ? null : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

export function reqStr(value: unknown, fallback = ''): string {
  return str(value) ?? fallback
}

export function num(value: unknown): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1
}

/** Airtable link fields arrive as arrays of record IDs. */
export function linkIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

export function firstLink(value: unknown): string | null {
  return linkIds(value)[0] ?? null
}

/** Rollups can arrive wrapped in an array. */
export function unwrapRollup(value: unknown): unknown {
  if (Array.isArray(value)) return value[0]
  return value
}

export function jsonField<T>(value: unknown, fallback: T): T {
  const raw = str(value)
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

// ── Phase C seed codecs ────────────────────────────────────────────────────

export const dealProposalStatusCodec = codec({
  proposed: 'Proposed',
  accepted: 'Accepted',
  merged: 'Merged',
  dismissed: 'Dismissed',
} as const)

export const seedSourceCodec = codec({
  calendar: 'Calendar',
  inbox: 'Inbox',
  sheets: 'Sheets',
  quickbooks: 'QuickBooks',
} as const)

/** "Both feasible" is a resolution, not a limbo state — hence a third value, not a flag. */
export const dateConflictStatusCodec = codec({
  open: 'Open',
  resolved: 'Resolved',
  'both-feasible': 'Both Feasible',
} as const)
