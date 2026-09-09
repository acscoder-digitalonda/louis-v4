import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import {
  ROLES,
  canApproveSends,
  canConfirmPayments,
  canSeeMoneyAmounts,
  canViewScreen,
  canWrite,
  canWriteMoney,
  defaultNotificationPrefs,
  resolveChannel,
} from './rbac'
import type { Role, User } from './types'

const user = (role: Role, over: Partial<User> = {}) =>
  ({ id: 'u1', name: 'X', email: 'x@y.z', role, showMoneyAmounts: false, ...over }) as User

describe('screen access', () => {
  it('confines the accountant to money', () => {
    // The accountant is an interface-only collaborator. If a session ever appears,
    // it must reach nothing else.
    for (const s of ['pipeline', 'deals', 'crm', 'journal', 'queue', 'settings', 'import-export'] as const) {
      assert.equal(canViewScreen('accountant', s), false, s)
    }
    assert.ok(canViewScreen('accountant', 'money'))
  })

  it('keeps settings and import/export to admin', () => {
    for (const r of ['owner', 'ops', 'accountant'] as const) {
      assert.equal(canViewScreen(r, 'settings'), false, r)
      assert.equal(canViewScreen(r, 'import-export'), false, r)
    }
    assert.ok(canViewScreen('admin', 'settings'))
  })
})

describe('canWrite', () => {
  it('refuses the append-only and ingested tables to everyone, admin included', () => {
    for (const role of ROLES) {
      for (const table of ['auditLog', 'emails', 'usageLog'] as const) {
        assert.equal(canWrite(role, table).allowed, false, `${role}/${table}`)
      }
    }
  })

  it('refuses a lookup field even to admin', () => {
    // A computed field's owner is a formula; writing it would silently do nothing.
    const d = canWrite('admin', 'deals', 'amount')
    assert.equal(d.allowed, false)
    assert.match(d.reason ?? '', /lookup/)
  })

  it('lets the office set contract and billing status', () => {
    // These two were marked computed as if a rollup fed them. The base holds plain
    // selects and nothing fed them, so no role could write them, no screen showed them,
    // and no deal could ever pass the "contract signed" gate into Pre-Event.
    assert.equal(canWrite('ops', 'deals', 'contractStatus').allowed, true)
    assert.equal(canWrite('ops', 'deals', 'paymentStatus').allowed, true)
    assert.equal(canWrite('owner', 'deals', 'contractStatus').allowed, false, 'money stays with the office')
  })

  it('narrows the owner to notes, post-keynote and stage', () => {
    for (const f of ['stage', 'kickoffNotes', 'postKeynoteNotes', 'audienceProfile', 'desiredOutcomes']) {
      assert.ok(canWrite('owner', 'deals', f).allowed, f)
    }
    for (const f of ['negotiatedFee', 'eventDate', 'name', 'clientId']) {
      assert.equal(canWrite('owner', 'deals', f).allowed, false, f)
    }
    assert.equal(canWrite('owner', 'clients').allowed, false)
    assert.equal(canWrite('owner', 'payments').allowed, false)
  })

  it('keeps settings and users away from ops', () => {
    assert.equal(canWrite('ops', 'settings').allowed, false)
    assert.equal(canWrite('ops', 'users').allowed, false)
    assert.ok(canWrite('ops', 'deals').allowed)
  })

  it('gives the accountant no write anywhere', () => {
    for (const t of ['deals', 'payments', 'clients', 'tasks', 'settings'] as const) {
      assert.equal(canWrite('accountant', t).allowed, false, t)
    }
  })

  it('always explains a refusal', () => {
    for (const role of ROLES) {
      for (const t of ['deals', 'payments', 'settings', 'auditLog'] as const) {
        const d = canWrite(role, t)
        if (!d.allowed) assert.ok(d.reason && d.reason.length > 0, `${role}/${t}`)
      }
    }
  })
})

describe('money', () => {
  it('lets only admin and ops write money, approve sends and confirm payments', () => {
    for (const r of ROLES) {
      const expected = r === 'admin' || r === 'ops'
      assert.equal(canWriteMoney(r), expected, r)
      assert.equal(canApproveSends(r), expected, r)
      assert.equal(canConfirmPayments(r), expected, r)
    }
  })

  it('hides amounts from Ben until he turns them on', () => {
    assert.equal(canSeeMoneyAmounts(user('owner')), false)
    assert.ok(canSeeMoneyAmounts(user('owner', { showMoneyAmounts: true })))
  })

  it('ignores the toggle for everyone else', () => {
    for (const r of ['admin', 'ops', 'accountant'] as const) {
      assert.ok(canSeeMoneyAmounts(user(r)), r)
    }
  })
})

describe('notifications', () => {
  it('never lets an admin turn off a worker failure', () => {
    // A silent worker failure is how a cutover goes unnoticed for a week.
    const u = user('admin', { notificationPrefs: { 'worker-failure': 'off' } as User['notificationPrefs'] })
    assert.equal(resolveChannel(u, 'worker-failure'), 'both')
  })

  it('honours the preference for everything else', () => {
    const u = user('ops', { notificationPrefs: { 'review-item': 'off' } as User['notificationPrefs'] })
    assert.equal(resolveChannel(u, 'review-item'), 'off')
  })

  it('falls back to in-app when a user has no preferences', () => {
    assert.equal(resolveChannel(user('ops'), 'mention'), 'in-app')
  })

  it('starts the owner off the review queue and the admin on failures', () => {
    assert.equal(defaultNotificationPrefs('owner')['review-item'], 'off')
    assert.equal(defaultNotificationPrefs('admin')['worker-failure'], 'both')
    assert.equal(defaultNotificationPrefs('ops')['review-item'], 'both')
  })
})
