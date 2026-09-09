'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import type { StageKey } from '@/lib/types'
import { ALL_STAGES, isSkip } from '@/lib/stages'
import { stageByKey } from '~/speaker.config'

/**
 * Stage changes fire the F5 packet, so this control is deliberately a little heavy:
 * skipping a stage asks first, and a guard refusal (unsigned contract → Pre-Event)
 * comes back from the server as a plain sentence rather than a silent no-op.
 */
export function StageSelect({
  dealId,
  stage,
  canEdit,
}: {
  dealId: string
  stage: StageKey
  canEdit: boolean
}) {
  const router = useRouter()
  // What the control shows. Set the moment a choice is made — before the server answers —
  // and put back if the server refuses. Waiting to show the new stage until the page had
  // re-rendered read as "nothing happened", and people chose again.
  const [shown, setShown] = useState<StageKey>(stage)
  const [busy, setBusy] = useState(false)
  const [refreshing, startRefresh] = useTransition()
  const [error, setError] = useState<string | null>(null)
  useEffect(() => setShown(stage), [stage])

  async function change(next: StageKey) {
    if (next === stage) return
    if (isSkip(stage, next)) {
      const ok = window.confirm(
        `Skip from ${stageByKey.get(stage)?.label} to ${stageByKey.get(next)?.label}? ` +
          `The ${stageByKey.get(next)?.label} packet will fire.`,
      )
      if (!ok) return
    }
    setShown(next)
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { stage: next } }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setShown(stage)
        setError(json.error ?? 'Could not change the stage.')
      } else {
        // Pending until the re-render lands, so the spinner covers the whole wait.
        startRefresh(() => router.refresh())
      }
    } catch {
      setShown(stage)
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }
  const pending = busy || refreshing

  if (!canEdit) {
    return <span className="pill pill-outline">{stageByKey.get(stage)?.label}</span>
  }

  return (
    <div>
      <label className="sr-only" htmlFor="stage-select">
        Stage
      </label>
      <span className="inline-flex items-center gap-2">
      <select
        id="stage-select"
        className="pill pill-outline"
        value={shown}
        disabled={pending}
        aria-busy={pending}
        onChange={(e) => void change(e.target.value as StageKey)}
      >
        {ALL_STAGES.map((s) => (
          <option key={s} value={s}>
            {stageByKey.get(s)?.label}
          </option>
        ))}
      </select>
      {pending ? (
        <span
          className="inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
          role="status"
          aria-label="Saving"
        />
      ) : null}
      </span>
      {error ? <p className="body-copy mt-2 text-danger">{error}</p> : null}
    </div>
  )
}
