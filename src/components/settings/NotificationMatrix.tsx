'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Micro } from '@/components/ui'
import { NOTIFICATION_LABELS, NOTIFICATION_TYPES, ALWAYS_EMAIL } from '@/lib/rbac'
import { NON_BATCHABLE, type QuietHours } from '@/lib/quiet-hours'
import type { NotificationChannel, NotificationType, User } from '@/lib/types'

const CHANNELS: NotificationChannel[] = ['off', 'in-app', 'email', 'both']

/**
 * Settings → Notifications (WP2.3 / WP3.2).
 *
 * Two things at once, because they are the same question: what reaches whom, and when.
 *
 * The matrix is per person rather than global. Liezel wants every review item; Ben wants
 * almost none of them and all of the red alerts. A single set of defaults would be wrong
 * for both, and the way that goes wrong is that somebody turns the whole thing off.
 *
 * Two columns cannot be changed and say so: a worker failure always reaches an admin, and
 * the four non-batchable events ignore quiet hours. Both are load-bearing — a system that
 * has stopped and told nobody is what every other rule here exists to prevent.
 */
export function NotificationMatrix({
  users,
  quietHours,
  canEdit,
}: {
  users: User[]
  quietHours: QuietHours
  canEdit: boolean
}) {
  const router = useRouter()
  const [hours, setHours] = useState(quietHours)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function setChannel(user: User, type: NotificationType, channel: NotificationChannel) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(user.email)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notificationPrefs: { ...user.notificationPrefs, [type]: channel } }),
      })
      if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? 'Could not save.')
      else router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function saveHours(next: QuietHours) {
    setHours(next)
    setBusy(true)
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quietHours: next }),
      })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card">
        <Micro>Quiet hours</Micro>
        <p className="body-copy mt-1">
          Between these hours the <b>email</b> waits for morning. The in-app record still
          lands immediately, so nobody opens the app at seven to an empty bell.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <Micro>From</Micro>
            <select
              className="field-input"
              value={hours.from}
              disabled={!canEdit || busy}
              onChange={(e) => void saveHours({ ...hours, from: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <Micro>Until</Micro>
            <select
              className="field-input"
              value={hours.to}
              disabled={!canEdit || busy}
              onChange={(e) => void saveHours({ ...hours, to: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={hours.enabled}
              disabled={!canEdit || busy}
              onChange={(e) => void saveHours({ ...hours, enabled: e.target.checked })}
            />
            <span className="sub">on</span>
          </label>
          <span className="sub">{hours.timezone}</span>
        </div>

        <p className="body-copy mt-3 text-ink-secondary">
          Ignored by {NON_BATCHABLE.map((t) => NOTIFICATION_LABELS[t]).join(', ')}. Each is on
          that list because by the time it could wait, it has cost something.
        </p>
      </div>

      <div className="card">
        <Micro>Who gets what</Micro>
        <div className="scroll-x mt-3">
          <table className="w-full min-w-[640px] text-left">
            <thead>
              <tr className="micro">
                <th className="pb-2 pr-4">Event</th>
                {users.map((u) => (
                  <th key={u.email} className="pb-2 pr-4">
                    {u.name?.split(' ')[0] ?? u.email.split('@')[0]}
                    <span className="block font-normal normal-case opacity-60">{u.role}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_TYPES.map((type) => (
                <tr key={type} className="border-t">
                  <td className="py-2 pr-4">
                    {NOTIFICATION_LABELS[type]}
                    {NON_BATCHABLE.includes(type) ? (
                      <span className="pill pill-ghost ml-2">always now</span>
                    ) : null}
                  </td>
                  {users.map((u) => {
                    const locked = ALWAYS_EMAIL.includes(type) && u.role === 'admin'
                    return (
                      <td key={u.email} className="py-2 pr-4">
                        {locked ? (
                          <span className="sub" title="A worker failure always reaches an admin.">
                            both · fixed
                          </span>
                        ) : (
                          <select
                            className="field-input"
                            value={u.notificationPrefs?.[type] ?? 'in-app'}
                            disabled={!canEdit || busy}
                            onChange={(e) =>
                              void setChannel(u, type, e.target.value as NotificationChannel)
                            }
                          >
                            {CHANNELS.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error ? <p className="body-copy mt-2 text-danger">{error}</p> : null}
        <p className="sub mt-3">
          A worker failure always reaches an admin and cannot be turned off. A system that has
          stopped and told nobody is the thing every other rule here exists to prevent.
        </p>
      </div>
    </div>
  )
}
