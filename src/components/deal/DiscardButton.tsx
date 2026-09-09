'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

/**
 * "This was never a deal."
 *
 * Small, quiet, and behind a confirmation — because it is the office saying a thing in
 * the pipeline is spam or a test, and that judgement should take one deliberate press.
 * It closes the deal as junk and takes you back to the board; changing the stage brings
 * it back if the judgement was wrong. Nothing is deleted.
 */
export function DiscardButton({ dealId, name }: { dealId: string; name: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [leaving, startLeaving] = useTransition()
  const [error, setError] = useState<string | null>(null)

  async function discard() {
    const ok = window.confirm(
      `Discard "${name}"?\n\nIt closes as junk and leaves the board, the sweeps and the ` +
        're-engagement campaign. Nothing is deleted — change the stage to bring it back.',
    )
    if (!ok) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${dealId}/discard`, { method: 'POST' })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not discard.')
        return
      }
      startLeaving(() => {
        router.push('/pipeline')
        router.refresh()
      })
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  const pending = busy || leaving
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="pill pill-ghost" disabled={pending} onClick={() => void discard()}>
        {pending ? 'discarding…' : 'discard'}
      </button>
      {error ? <span className="sub text-danger">{error}</span> : null}
    </span>
  )
}
