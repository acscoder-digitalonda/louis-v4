'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ROLES } from '@/lib/rbac'
import type { Role, User } from '@/lib/types'

export function UserRow({ user, canEdit }: { user: User; canEdit: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function patch(patch: Partial<User>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, patch }),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: string }
        setError(json.error ?? 'Could not update.')
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="rowname truncate">{user.name ?? user.email}</div>
        <div className="sub truncate">{user.email}</div>
      </div>

      <select
        className="pill pill-outline"
        value={user.role}
        disabled={!canEdit || busy}
        onChange={(e) => void patch({ role: e.target.value as Role })}
        aria-label={`Role for ${user.email}`}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>

      <label className="sub flex items-center gap-2" title="Show money amounts rather than chips">
        <input
          type="checkbox"
          checked={user.showMoneyAmounts}
          disabled={!canEdit || busy}
          onChange={(e) => void patch({ showMoneyAmounts: e.target.checked })}
        />
        amounts
      </label>

      <button
        type="button"
        className={`pill ${user.active ? 'pill-ghost' : 'pill-outline'}`}
        disabled={!canEdit || busy}
        onClick={() => void patch({ active: !user.active })}
      >
        {user.active ? 'active' : 'inactive'}
      </button>

      {error ? <span className="sub w-full text-danger">{error}</span> : null}
    </li>
  )
}
