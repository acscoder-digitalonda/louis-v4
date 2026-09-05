/**
 * Roles & permissions (Rebuild Spec §5).
 *
 * Enforced server-side. Every API route calls into this module before it writes;
 * the UI merely hides what the route would refuse. Hiding a button is not security.
 */

import type { NotificationChannel, NotificationType, Role, User } from './types'
import { TABLES, type TableKey } from './airtable/schema'

export const ROLES: Role[] = ['owner', 'admin', 'ops', 'accountant']

export type Screen =
  | 'pipeline'
  | 'deals'
  | 'crm'
  | 'journal'
  | 'money'
  | 'queue'
  | 'settings'
  | 'import-export'

const SCREEN_ACCESS: Record<Role, Screen[]> = {
  owner: ['pipeline', 'deals', 'crm', 'journal', 'money', 'queue'],
  admin: ['pipeline', 'deals', 'crm', 'journal', 'money', 'queue', 'settings', 'import-export'],
  ops: ['pipeline', 'deals', 'crm', 'journal', 'money', 'queue'],
  // The accountant never logs into this app; the guard exists so that if a session
  // ever does appear, it can reach nothing but the money surface.
  accountant: ['money'],
}

export function canViewScreen(role: Role, screen: Screen): boolean {
  return SCREEN_ACCESS[role].includes(screen)
}

/** Fields the owner may edit — deliberately narrow (Rebuild Spec §5). */
const OWNER_WRITABLE_DEAL_FIELDS = new Set([
  'stage',
  'kickoffNotes',
  'postKeynoteNotes',
  'audienceProfile',
  'desiredOutcomes',
])

/** Tables nothing outside the money group may write. */
const MONEY_WRITERS: Role[] = ['admin', 'ops']

export interface WriteDecision {
  allowed: boolean
  reason?: string
}

export function canWrite(role: Role, table: TableKey, fieldKey?: string): WriteDecision {
  // Append-only / ingested-truth tables are never edited by a person.
  if (table === 'auditLog') return deny('The audit log is append-only.')
  if (table === 'emails') return deny('Ingested email is raw material and is never edited.')
  if (table === 'usageLog') return deny('Usage rows are written by the gateway only.')

  if (fieldKey) {
    const spec = TABLES[table].fields.find((f) => f.key === fieldKey)
    if (spec?.computed) {
      return deny(`${spec.name} is a lookup — its owner is another table.`)
    }
  }

  switch (role) {
    case 'admin':
      return { allowed: true }
    case 'ops':
      if (table === 'settings') return deny('Settings are admin-only.')
      if (table === 'users') return deny('User management is admin-only.')
      return { allowed: true }
    case 'owner':
      if (table === 'deals') {
        if (!fieldKey) return { allowed: true }
        return OWNER_WRITABLE_DEAL_FIELDS.has(fieldKey)
          ? { allowed: true }
          : deny('The owner role edits notes, post-keynote and stage.')
      }
      if (table === 'tasks') return { allowed: true }
      return deny('The owner role does not edit this table.')
    case 'accountant':
      return deny('The accountant is an interface-only collaborator.')
  }
}

function deny(reason: string): WriteDecision {
  return { allowed: false, reason }
}

export function canWriteMoney(role: Role): boolean {
  return MONEY_WRITERS.includes(role)
}

/**
 * Ben sees money as status chips by default; amounts are a Settings toggle,
 * not a rebuild (Rebuild Spec §5, Open Question 3 answered as a setting).
 */
export function canSeeMoneyAmounts(user: Pick<User, 'role' | 'showMoneyAmounts'>): boolean {
  if (user.role === 'owner') return user.showMoneyAmounts
  return user.role === 'admin' || user.role === 'ops' || user.role === 'accountant'
}

export function canApproveSends(role: Role): boolean {
  return role === 'admin' || role === 'ops'
}

export function canConfirmPayments(role: Role): boolean {
  return role === 'admin' || role === 'ops'
}

export const NOTIFICATION_TYPES: NotificationType[] = [
  'review-item',
  'red-alert',
  'worker-failure',
  'payment-confirmed',
  'contract-signed',
  'cap-warning',
  'qa-digest',
  'mention',
]

export const NOTIFICATION_LABELS: Record<NotificationType, string> = {
  'review-item': 'Review queue item',
  'red-alert': 'Red alert',
  'worker-failure': 'Worker failure',
  'payment-confirmed': 'Payment confirmed',
  'contract-signed': 'Contract signed',
  'cap-warning': 'Usage cap warning',
  'qa-digest': 'QA morning digest',
  mention: 'Mentioned in a note',
}

/** Worker failures always email the admin immediately — never batchable, never off. */
export const ALWAYS_EMAIL: NotificationType[] = ['worker-failure']

export function defaultNotificationPrefs(role: Role): Record<NotificationType, NotificationChannel> {
  const base: Record<NotificationType, NotificationChannel> = {
    'review-item': 'in-app',
    'red-alert': 'both',
    'worker-failure': 'off',
    'payment-confirmed': 'in-app',
    'contract-signed': 'in-app',
    'cap-warning': 'off',
    'qa-digest': 'off',
    mention: 'both',
  }
  if (role === 'ops') {
    base['review-item'] = 'both'
    base['payment-confirmed'] = 'both'
  }
  if (role === 'admin') {
    base['worker-failure'] = 'both'
    base['cap-warning'] = 'both'
    base['qa-digest'] = 'both'
  }
  if (role === 'owner') {
    base['review-item'] = 'off'
  }
  return base
}

/** Resolves the channel, honouring the never-off rule for failures. */
export function resolveChannel(user: User, type: NotificationType): NotificationChannel {
  if (ALWAYS_EMAIL.includes(type) && user.role === 'admin') return 'both'
  return user.notificationPrefs?.[type] ?? 'in-app'
}
