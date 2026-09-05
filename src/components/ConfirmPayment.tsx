'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

/** Payments are human-confirmed only — this button is the human. */
export function ConfirmPayment({ paymentId, disabled }: { paymentId: string; disabled: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/payments/${paymentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirm' }),
      })
      if (!res.ok) {
        const json = (await res.json()) as { error?: string }
        setError(json.error ?? 'Could not confirm.')
        return
      }
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        className="pill pill-accent"
        onClick={() => void confirm()}
        disabled={disabled || busy}
        title={disabled ? 'Your role cannot confirm payments.' : undefined}
      >
        Confirm
      </button>
      {error ? <span className="sub text-danger">{error}</span> : null}
    </span>
  )
}
