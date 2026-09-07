'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { ApiToken, User } from '@/lib/types'
import { relativeTime } from '@/lib/format'
import { Micro } from '@/components/ui'

interface Props {
  tokens: ApiToken[]
  admins: User[]
  currentUserEmail: string
}

/**
 * Settings → MCP tokens (WP2.3, for WP3.4).
 *
 * The screen exists so that revoking is a click by the person who holds the token, not a
 * message to a developer who then runs a script. A credential you have to ask someone
 * else to cancel is a credential that stays alive after it should have died.
 *
 * The token is shown once, here, immediately after it is issued and never again — the
 * server stores only a hash. That is stated on the screen rather than left to be
 * discovered when somebody comes back looking for it.
 */
export function TokenList({ tokens, admins, currentUserEmail }: Props) {
  const router = useRouter()
  const [issuedFor, setIssuedFor] = useState(currentUserEmail)
  const [label, setLabel] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function issue() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: issuedFor, label: label.trim() || undefined }),
      })
      const json = (await res.json()) as { token?: string; error?: string }
      if (!res.ok || !json.token) {
        setError(json.error ?? 'Could not issue a token.')
        return
      }
      setFresh(json.token)
      setLabel('')
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  async function revoke(token: ApiToken) {
    const ok = window.confirm(
      `Revoke “${token.label}”? Anything using it stops working immediately, and it cannot be undone.`,
    )
    if (!ok) return
    setBusy(true)
    try {
      await fetch(`/api/tokens/${token.id}`, { method: 'DELETE' })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const live = tokens.filter((t) => !t.revoked)
  const dead = tokens.filter((t) => t.revoked)

  return (
    <div className="flex flex-col gap-4">
      {fresh ? (
        <div className="card border-accent">
          <Micro>Copy this now</Micro>
          <p className="body-copy mt-1">
            This is the only time the token is shown. The server keeps a hash, not the token, so
            it cannot be shown again. Lose it and issue another.
          </p>
          <div className="well mt-3 flex items-center gap-2 p-3">
            <code className="num flex-1 break-all text-sm">{fresh}</code>
            <button
              type="button"
              className="pill pill-outline"
              onClick={() => {
                void navigator.clipboard?.writeText(fresh)
                setCopied(true)
              }}
            >
              {copied ? 'copied' : 'copy'}
            </button>
          </div>
          <button type="button" className="pill pill-ghost mt-3" onClick={() => setFresh(null)}>
            I have it
          </button>
        </div>
      ) : null}

      <div className="card">
        <Micro>Issue a token</Micro>
        <p className="body-copy mt-1">
          For connecting Claude, or anything else that speaks MCP, to{' '}
          <code>/api/mcp</code>. Admin accounts only: the endpoint refuses every other role, so a
          token for one would authenticate and then be turned away on every call.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <Micro>For</Micro>
            <select
              value={issuedFor}
              onChange={(e) => setIssuedFor(e.target.value)}
              className="field-input"
            >
              {admins.map((u) => (
                <option key={u.email} value={u.email}>
                  {u.name} · {u.email}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <Micro>Label</Micro>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Jordan · Claude desktop"
              className="field-input"
            />
          </label>
          <button type="button" className="pill pill-accent" disabled={busy} onClick={() => void issue()}>
            {busy ? 'working…' : 'Issue'}
          </button>
        </div>
        {error ? <p className="body-copy mt-2 text-danger">{error}</p> : null}
      </div>

      <div className="card">
        <Micro>Active · {live.length}</Micro>
        {live.length === 0 ? (
          <p className="body-copy mt-2 text-ink-muted">None issued.</p>
        ) : (
          <div className="mt-2 flex flex-col divide-y">
            {live.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="rowname truncate">{t.label}</div>
                  <div className="sub truncate">
                    <code>{t.prefix}…</code> · {t.userEmail} ·{' '}
                    {t.lastUsedAt ? `last used ${relativeTime(t.lastUsedAt)}` : 'never used'}
                    {t.expiresAt ? ` · expires ${t.expiresAt}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="pill pill-danger"
                  disabled={busy}
                  onClick={() => void revoke(t)}
                >
                  revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {dead.length > 0 ? (
        <details>
          <summary className="micro cursor-pointer">Revoked · {dead.length}</summary>
          <div className="mt-2 flex flex-col gap-1">
            {dead.map((t) => (
              <div key={t.id} className="sub">
                <code>{t.prefix}…</code> · {t.label} · {t.userEmail}
              </div>
            ))}
          </div>
          <p className="sub mt-2">
            Kept rather than deleted, so an audit entry written six months ago still resolves to a
            name.
          </p>
        </details>
      ) : null}
    </div>
  )
}
