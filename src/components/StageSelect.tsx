'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
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
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(next: StageKey) {
    if (next === stage) return
    if (isSkip(stage, next)) {
      const ok = window.confirm(
        `Skip from ${stageByKey.get(stage)?.label} to ${stageByKey.get(next)?.label}? ` +
          `The ${stageByKey.get(next)?.label} packet will fire.`,
      )
      if (!ok) return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { stage: next } }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) setError(json.error ?? 'Could not change the stage.')
      else router.refresh()
    } finally {
      setBusy(false)
    }
  }

  if (!canEdit) {
    return <span className="pill pill-outline">{stageByKey.get(stage)?.label}</span>
  }

  return (
    <div>
      <label className="sr-only" htmlFor="stage-select">
        Stage
      </label>
      <select
        id="stage-select"
        className="pill pill-outline"
        value={stage}
        disabled={busy}
        onChange={(e) => void change(e.target.value as StageKey)}
      >
        {ALL_STAGES.map((s) => (
          <option key={s} value={s}>
            {stageByKey.get(s)?.label}
          </option>
        ))}
      </select>
      {error ? <p className="body-copy mt-2 text-danger">{error}</p> : null}
    </div>
  )
}
