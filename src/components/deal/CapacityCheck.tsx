'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Micro } from '@/components/ui'
import { dayMonth } from '@/lib/format'

interface Row {
  id: string
  name: string
  eventDate: string | null
  adjacent: boolean
}

/**
 * The load around this date, asked for rather than shown.
 *
 * Ben's rule is three keynotes in a week and Liezel checks a day either side. The answer
 * costs a read of every deal, so it is a button: pressed when somebody is deciding
 * whether to grant a hold, and never on the way past.
 *
 * It advises. There is no version of this that refuses a booking.
 */
export function CapacityCheck({ dealId, date }: { dealId: string; date: string | null }) {
  const [verdict, setVerdict] = useState<string | null>(null)
  const [atCap, setAtCap] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!date) {
    return (
      <p className="sub">
        No event date yet, so there is nothing to check the week against.
      </p>
    )
  }

  async function check() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/capacity?date=${date}&dealId=${dealId}`)
      const json = (await res.json()) as {
        verdict?: string
        atCap?: boolean
        week?: Row[]
        error?: string
      }
      if (!res.ok) {
        setError(json.error ?? 'Could not check the week.')
        return
      }
      setVerdict(json.verdict ?? null)
      setAtCap(Boolean(json.atCap))
      setRows(json.week ?? [])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="pill pill-outline" disabled={busy} onClick={() => void check()}>
          {busy ? 'checking…' : verdict ? 'Check again' : `Check the week of ${dayMonth(date)}`}
        </button>
        {verdict ? <Micro>{atCap ? 'at Ben’s maximum' : 'within the rule'}</Micro> : null}
      </div>

      {error ? <p className="body-copy mt-2 text-danger">{error}</p> : null}

      {verdict ? (
        <div className={`mt-3 ${atCap ? 'text-danger' : ''}`}>
          <p className="body-copy">{verdict}</p>
          {rows.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/deals/${r.id}`} className={r.adjacent ? 'pill pill-outline' : 'pill pill-ghost'}>
                    {r.name}
                    {r.eventDate ? ` · ${dayMonth(r.eventDate)}` : ''}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
