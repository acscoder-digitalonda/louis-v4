'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Deal, StageKey } from '@/lib/types'
import { ALL_STAGES } from '@/lib/stages'
import { stageByKey } from '~/speaker.config'
import { dayMonth, money } from '@/lib/format'
import { dealValue } from '@/lib/forecast'
import { Micro } from '@/components/ui'

/**
 * The deals list: search, filter, and one page at a time.
 *
 * Every narrowing happens on the server. A search that reads all 802 deals and filters in
 * the browser is not a search — it is the same nine Airtable requests with a nicer
 * spinner, and Airtable bills per request.
 *
 * Imported history is out by default and behind a toggle that says how many there are.
 * All 802 deals are history today; leading with them buries the handful that are live.
 */
export function DealList({
  initial,
  initialCursor,
  showAmounts,
}: {
  initial: Deal[]
  initialCursor?: string
  showAmounts: boolean
}) {
  const [deals, setDeals] = useState(initial)
  const [cursor, setCursor] = useState(initialCursor)
  const [q, setQ] = useState('')
  const [stage, setStage] = useState<StageKey | ''>('')
  const [historical, setHistorical] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Every fetch carries a sequence number; a slow first request must not overwrite the
  // results of a later, narrower one. Without this, typing quickly leaves the list
  // showing the answer to a query the person has already moved past.
  const request = useRef(0)

  const load = useCallback(
    async (opts: { append?: boolean; cursor?: string } = {}) => {
      const mine = ++request.current
      setBusy(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (q.trim()) params.set('q', q.trim())
        if (stage) params.set('stage', stage)
        if (historical) params.set('historical', '1')
        if (opts.cursor) params.set('cursor', opts.cursor)

        const res = await fetch(`/api/deals?${params}`)
        const json = (await res.json()) as { deals?: Deal[]; cursor?: string; error?: string }
        if (mine !== request.current) return
        if (!res.ok || !json.deals) {
          setError(json.error ?? 'Could not load deals.')
          return
        }
        setDeals((prev) => (opts.append ? [...prev, ...json.deals!] : json.deals!))
        setCursor(json.cursor)
      } finally {
        if (mine === request.current) setBusy(false)
      }
    },
    [q, stage, historical],
  )

  // Debounced, because a request per keystroke is a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 350 : 0)
    return () => clearTimeout(t)
  }, [q, stage, historical, load])

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="field-input min-w-[220px] flex-1"
          placeholder="Search by deal or location…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="field-input"
          value={stage}
          onChange={(e) => setStage(e.target.value as StageKey | '')}
        >
          <option value="">Any stage</option>
          {ALL_STAGES.map((s) => (
            <option key={s} value={s}>
              {stageByKey.get(s)?.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={historical}
            onChange={(e) => setHistorical(e.target.checked)}
          />
          <span className="sub">include history</span>
        </label>
      </div>

      {error ? <p className="body-copy mb-3 text-danger">{error}</p> : null}

      {deals.length === 0 && !busy ? (
        <div className="well px-4 py-10 text-center">
          <Micro>Nothing matches</Micro>
          <p className="body-copy mt-2">
            {historical
              ? 'No deal matches that.'
              : 'Nothing live matches. Seven years of imported bookings are hidden by default — tick "include history" to search them too.'}
          </p>
        </div>
      ) : (
        <ul className="card divide-y p-0">
          {deals.map((deal) => (
            <li key={deal.id}>
              <Link href={`/deals/${deal.id}`} className="block px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="rowname truncate">{deal.name}</span>
                  <span className="sub">
                    {stageByKey.get(deal.stage)?.label}
                    {deal.historical ? ' · history' : ''}
                  </span>
                </div>
                <div className="sub mt-1 truncate">
                  {[dayMonth(deal.eventDate), deal.location, showAmounts && dealValue(deal)
                    ? money(dealValue(deal), { compact: true })
                    : null]
                    .filter(Boolean)
                    .join(' · ') || 'No date or location yet'}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex items-center gap-3">
        {cursor ? (
          <button
            type="button"
            className="pill pill-outline"
            disabled={busy}
            onClick={() => void load({ append: true, cursor })}
          >
            {busy ? 'loading…' : 'Load more'}
          </button>
        ) : deals.length > 0 ? (
          <span className="sub">
            {deals.length} shown · that is all of them
          </span>
        ) : null}
        {busy && deals.length > 0 ? <span className="sub">working…</span> : null}
      </div>
    </div>
  )
}
