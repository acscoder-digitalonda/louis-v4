'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function NewDealButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function create() {
    const name = window.prompt('Deal name (e.g. “Acme Corp — Leadership Summit”)')
    if (!name?.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const json = (await res.json()) as { deal?: { id: string }; error?: string }
      if (!res.ok || !json.deal) {
        window.alert(json.error ?? 'Could not create the deal.')
        return
      }
      router.push(`/deals/${json.deal.id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className="pill pill-accent" onClick={() => void create()} disabled={busy}>
      New deal
    </button>
  )
}
