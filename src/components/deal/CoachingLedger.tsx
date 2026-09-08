'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Micro } from '@/components/ui'
import { dayMonth } from '@/lib/format'
import { DEFAULT_GAP_DAYS, ledger } from '@/lib/coaching'
import type { CoachingSession } from '@/lib/types'

/**
 * The coaching delivery ledger.
 *
 * Three rows and one sentence. The sentence is the point: it is always populated, and it
 * says what happens next even when the answer is "nothing, and it has been three weeks".
 *
 * Marking a session held drafts the follow-up while what happened is still in somebody's
 * head. That is the moment the note is worth writing; a week later it is a chore.
 */
export function CoachingLedger({
  sessions,
  canEdit,
}: {
  sessions: CoachingSession[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)
  const state = ledger(sessions, today)
  const ordered = [...sessions].sort((a, b) => a.sessionNumber - b.sessionNumber)

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch('/api/coaching', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      if (!res.ok) setError(((await res.json()) as { error?: string }).error ?? 'Could not save.')
      else router.refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <Micro>Sessions</Micro>
        <span className="sub num">
          {state.held} of {state.total || 3} delivered
        </span>
      </div>

      {ordered.length === 0 ? (
        <p className="body-copy text-ink-secondary">
          No ledger on this deal. It opens automatically when a coaching deal reaches
          Closed-Won; if this one got here another way, the sessions have to be added by hand.
        </p>
      ) : (
        <ul className="divide-y">
          {ordered.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
              <span className="rowname w-20">Session {s.sessionNumber}</span>

              <input
                type="date"
                className="field-input"
                value={s.scheduledFor ?? ''}
                disabled={!canEdit || busy === s.id}
                onChange={(e) => void patch(s.id, { scheduledFor: e.target.value || null })}
              />

              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={s.held}
                  disabled={!canEdit || busy === s.id}
                  onChange={(e) => void patch(s.id, { held: e.target.checked })}
                />
                <span className="sub">held</span>
              </label>

              {!s.scheduledFor ? <span className="sub text-warning">no date</span> : null}
              {s.scheduledFor && !s.held && s.scheduledFor < today ? (
                <span className="sub text-danger">{dayMonth(s.scheduledFor)} passed</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className={`mt-3 border-t pt-3 ${state.stalled ? 'text-danger' : ''}`}>
        <p className="body-copy">{state.nextAction}</p>
        {state.sellNextTrack ? (
          <p className="sub mt-1">
            Marking the third session held drafts the next-track offer. Nothing sends itself.
          </p>
        ) : null}
        {ordered.length > 0 && ordered.every((s) => !s.scheduledFor) ? (
          <p className="sub mt-1">
            Sessions open undated on purpose. Roughly {DEFAULT_GAP_DAYS} days apart is the
            working assumption, not a rule anyone has confirmed.
          </p>
        ) : null}
      </div>

      {error ? <p className="body-copy mt-2 text-danger">{error}</p> : null}
    </div>
  )
}
