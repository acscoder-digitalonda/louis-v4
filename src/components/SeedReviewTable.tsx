'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DateConflict, DealProposal } from '@/lib/types'
import { stageByKey } from '~/speaker.config'

interface Props {
  proposals: DealProposal[]
  conflicts: DateConflict[]
  canApprove: boolean
}

/**
 * The C5 reconciliation surface: every seeded deal in one table, so Liezel and Ben can
 * clear ~99 upcoming proposals in one sitting.
 *
 * The swipe-one-at-a-time Review Queue is the right shape for five drafts on a phone and
 * the wrong shape for a hundred rows on a laptop — a hundred taps, and no way to see that
 * four proposals are the same client. So this is a table: scan, select, accept in bulk.
 *
 * Two rules the runbook is strict about, enforced here rather than left to discipline:
 * rows in a date conflict cannot be bulk-accepted (Ben decides those one at a time,
 * including "both feasible"), and the confidence a seed reported is always visible next
 * to the row it is justifying.
 */
export function SeedReviewTable({ proposals, conflicts, canApprove }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [showHistorical, setShowHistorical] = useState(false)
  const [source, setSource] = useState<'all' | 'calendar' | 'inbox'>('all')
  const [only, setOnly] = useState<'all' | 'money' | 'conflict' | 'low' | 'dupes'>('all')
  const [query, setQuery] = useState('')

  const openConflicts = useMemo(
    () => conflicts.filter((c) => c.status === 'open'),
    [conflicts],
  )

  const conflictedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const c of openConflicts) c.proposalIds.forEach((id) => ids.add(id))
    return ids
  }, [openConflicts])

  const conflictDates = useMemo(
    () => new Set(openConflicts.map((c) => c.date).filter((d): d is string => Boolean(d))),
    [openConflicts],
  )

  /**
   * Proposals that name the same client. Seeding from the calendar, both mailboxes and
   * Liezel's tracker means one booking arrives up to four times — Janney does. Scattered
   * through 228 rows nobody spots that row 12 and row 180 are the same event, so they are
   * grouped, badged, and filterable.
   */
  const clusters = useMemo(() => {
    const byKey = new Map<string, string[]>()
    for (const p of proposals) {
      if (p.historical) continue
      const name = (p.clientName ?? p.title)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\b(inc|llc|ltd|the|corp|corporation|company|co|group)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .slice(0, 2)
        .join(' ')
      if (!name) continue
      byKey.set(name, [...(byKey.get(name) ?? []), p.id])
    }
    const out = new Map<string, { key: string; ids: string[] }>()
    for (const [key, ids] of byKey) {
      if (ids.length < 2) continue
      for (const id of ids) out.set(id, { key, ids })
    }
    return out
  }, [proposals])

  /** In conflict if linked to one, or simply sitting on a date that has one. */
  const inConflict = useCallback(
    (p: DealProposal) =>
      conflictedIds.has(p.id) || (p.eventDate ? conflictDates.has(p.eventDate) : false),
    [conflictedIds, conflictDates],
  )

  // 200 rows land here after the calendar and inbox seeds. A flat list of 200 is not a
  // review surface — it is a wall — so the filters exist to let one person work a slice at
  // a time and know they finished it.
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return proposals.filter((p) => {
      if (!showHistorical && p.historical) return false
      if (source !== 'all' && p.seedSource !== source) return false
      if (only === 'money' && p.negotiatedFee === null) return false
      if (only === 'conflict' && !inConflict(p)) return false
      if (only === 'low' && (p.confidence ?? 0) >= 0.8) return false
      if (only === 'dupes' && !clusters.has(p.id)) return false
      if (q) {
        const hay = `${p.clientName ?? ''} ${p.title} ${p.contactName ?? ''} ${p.location ?? ''}`
        if (!hay.toLowerCase().includes(q)) return false
      }
      return true
    }).sort((a, b) => {
      // Same-client rows sit next to each other; everything else stays in date order.
      const ka = clusters.get(a.id)?.key ?? ''
      const kb = clusters.get(b.id)?.key ?? ''
      if (ka !== kb) return ka && kb ? ka.localeCompare(kb) : ka ? -1 : kb ? 1 : 0
      return (a.eventDate ?? '9999').localeCompare(b.eventDate ?? '9999')
    })
  }, [proposals, showHistorical, source, only, query, inConflict, clusters])

  const selectable = rows.filter((p) => !inConflict(p))
  const highConfidence = selectable.filter((p) => (p.confidence ?? 0) >= 0.8)
  // Bulk accept applies to what is on screen, which is the right behaviour and the wrong
  // thing to leave implicit: pressing a button labelled "accept the high-confidence ones"
  // while a filter is on should say that it means the filtered ones.
  const filtered = source !== 'all' || only !== 'all' || query.trim() !== ''

  /**
   * Merging is far easier to get wrong than it looks, so the button is deliberately hard
   * to press by accident.
   *
   * Same client is not enough. Janney has three calendar holds — 8, 9 and 16 September, in
   * Glastonbury, in Connecticut and virtual, with three different contacts. Those are three
   * bookings, and merging them would delete two real events while looking like tidying up.
   *
   * So: every selected row must be the same client, *and* no two of them may carry
   * different dates. A dated calendar hold and an undated inbox thread merge happily; two
   * dated rows almost never should, and when they genuinely should the person can clear the
   * date on one first and mean it.
   */
  const selectedIds = [...selected]
  const selectedRows = proposals.filter((p) => selected.has(p.id))
  const selectedKeys = new Set(selectedIds.map((id) => clusters.get(id)?.key ?? `~${id}`))
  const selectedDates = new Set(
    selectedRows.map((p) => p.eventDate).filter((d): d is string => Boolean(d)),
  )
  const sameClient = selectedIds.length >= 2 && selectedKeys.size === 1
  const datesAgree = selectedDates.size <= 1
  const canMerge = sameClient && datesAgree

  /**
   * The order sent to the merge endpoint decides which row's values survive. Calendar
   * first: it is the only source that saw a date Ben actually blocked out. Then whichever
   * has a date at all, then the rest, which can only fill blanks.
   */
  function orderedSelection(): string[] {
    const rank = (p: DealProposal) =>
      (p.seedSource === 'calendar' ? 0 : 2) + (p.eventDate ? 0 : 1)
    return proposals
      .filter((p) => selected.has(p.id))
      .sort((a, b) => rank(a) - rank(b) || (a.eventDate ?? '9999').localeCompare(b.eventDate ?? '9999'))
      .map((p) => p.id)
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function act(action: 'accept' | 'dismiss' | 'merge', ids: string[]) {
    if (ids.length === 0) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await fetch('/api/seed-proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids }),
      })
      const json = (await res.json()) as {
        error?: string
        accepted?: string[]
        failed?: { id: string; error: string }[]
      }
      if (!res.ok) {
        setError(json.error ?? 'That did not go through.')
        return
      }
      const failed = json.failed ?? []
      const verb =
        action === 'accept' ? 'accepted' : action === 'merge' ? 'merged into one deal' : 'dismissed'
      setNote(
        failed.length > 0
          ? `${json.accepted?.length ?? 0} done, ${failed.length} failed. First error: ${failed[0]?.error ?? ''}`
          : `${ids.length} ${verb}.`,
      )
      setSelected(new Set())
      router.refresh()
    } catch {
      setError('Network problem. Nothing was changed.')
    } finally {
      setBusy(false)
    }
  }

  if (proposals.length === 0) {
    return (
      <p className="body-copy text-ink-secondary">
        No seeded proposals waiting. Run the C1 or C2 seed to create some.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a client, contact or city"
          aria-label="Filter proposals"
          className="field-input h-9 w-full max-w-[26ch]"
        />
        <div className="flex gap-1" role="group" aria-label="Filter by source">
          {(['all', 'calendar', 'inbox'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={`pill ${source === s ? 'pill-accent' : 'pill-ghost'}`}
              onClick={() => setSource(s)}
            >
              {s === 'all' ? 'All' : s === 'calendar' ? 'Calendar' : 'Inbox'}
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label="Filter by what needs attention">
          {(
            [
              ['all', 'Everything'],
              ['money', 'Has a fee'],
              ['conflict', 'In conflict'],
              ['low', 'Needs a look'],
              ['dupes', 'Same client'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`pill ${only === k ? 'pill-accent' : 'pill-ghost'}`}
              onClick={() => setOnly(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="pill pill-accent"
          disabled={!canApprove || busy || highConfidence.length === 0}
          onClick={() => act('accept', highConfidence.map((p) => p.id))}
        >
          Accept {highConfidence.length} high-confidence{filtered ? ' shown' : ''}
        </button>
        <button
          type="button"
          className="pill pill-outline"
          disabled={!canApprove || busy || selected.size === 0}
          onClick={() => act('accept', [...selected])}
        >
          Accept selected ({selected.size})
        </button>
        <button
          type="button"
          className="pill pill-outline"
          disabled={!canApprove || busy || !canMerge}
          onClick={() => act('merge', orderedSelection())}
          title={
            canMerge
              ? 'Accept the first as the deal and fold the rest into it, filling blanks only'
              : sameClient && !datesAgree
                ? 'These rows have different dates — they are probably different bookings'
                : 'Select two or more rows for the same client'
          }
        >
          Merge {selectedIds.length > 1 ? `${selectedIds.length} ` : ''}into one
        </button>
        <button
          type="button"
          className="pill pill-ghost"
          disabled={!canApprove || busy || selected.size === 0}
          onClick={() => act('dismiss', [...selected])}
        >
          Dismiss selected
        </button>
        <label className="micro flex items-center gap-2">
          <input
            type="checkbox"
            checked={showHistorical}
            onChange={(e) => setShowHistorical(e.target.checked)}
          />
          Show already delivered
        </label>
      </div>

      {sameClient && !datesAgree && (
        <p className="micro text-warning" role="status">
          Those rows are the same client on {selectedDates.size} different dates &mdash; almost
          always separate bookings, not duplicates. Merging would delete the others.
        </p>
      )}
      {openConflicts.length > 0 && (
        <p className="micro text-warning" role="status">
          {openConflicts.length} open date conflict(s). Those rows are excluded from bulk actions.
          Ben resolves them one at a time, including &ldquo;both feasible&rdquo;.
        </p>
      )}
      {error && (
        <p className="body-copy text-danger" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="micro text-accent" role="status">
          {note}
        </p>
      )}

      <div className="scroll-x">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Seeded deal proposals awaiting review</caption>
          <thead>
            <tr className="border-b">
              <th scope="col" className="micro p-2">
                <span className="sr-only">Select</span>
              </th>
              <th scope="col" className="micro p-2">Client</th>
              <th scope="col" className="micro p-2">Date</th>
              <th scope="col" className="micro p-2">Stage</th>
              <th scope="col" className="micro p-2">Lane</th>
              <th scope="col" className="micro p-2">Hold</th>
              <th scope="col" className="micro p-2">Fee</th>
              <th scope="col" className="micro p-2">Source</th>
              <th scope="col" className="micro p-2">Confidence</th>
              <th scope="col" className="micro p-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const conflicted = inConflict(p)
              return (
                <tr
                  key={p.id}
                  className={conflicted ? 'border-b border-l-2 border-l-warning' : 'border-b'}
                >
                  <td className="p-2 align-top">
                    <input
                      type="checkbox"
                      checked={selected.has(p.id)}
                      disabled={conflicted || !canApprove}
                      onChange={() => toggle(p.id)}
                      aria-label={`Select ${p.title}`}
                    />
                  </td>
                  <th scope="row" className="rowname p-2 align-top font-normal">
                    {p.clientName ?? p.title}
                    {clusters.has(p.id) && (
                      <span className="pill pill-outline ml-2 align-middle text-[0.62rem]">
                        {clusters.get(p.id)!.ids.length}× same client
                      </span>
                    )}
                    {p.contactName && (
                      <span className="micro block text-ink-secondary">{p.contactName}</span>
                    )}
                  </th>
                  <td className="num p-2 align-top">{p.eventDate ?? '—'}</td>
                  <td className="micro p-2 align-top">
                    {stageByKey.get(p.stage)?.label ?? p.stage}
                  </td>
                  <td className="micro p-2 align-top">{p.lane === 'bureau' ? 'Bureau' : 'Direct'}</td>
                  <td className="num p-2 align-top">{p.holdOrder ?? '—'}</td>
                  <td className="num p-2 align-top">
                    {p.negotiatedFee === null ? '—' : p.negotiatedFee.toLocaleString()}
                  </td>
                  <td className="micro p-2 align-top">{p.seedSource}</td>
                  <td className="num p-2 align-top">
                    {p.confidence === null ? '—' : `${Math.round(p.confidence * 100)}%`}
                  </td>
                  <td className="micro max-w-[36ch] p-2 align-top text-ink-secondary">
                    {conflicted && <span className="text-warning">Date conflict. </span>}
                    {p.notes ?? ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="micro text-ink-secondary">
        {rows.length} of {proposals.length} shown · {selectable.length} selectable ·{' '}
        {conflictedIds.size} in conflict · {new Set([...clusters.values()].map((c) => c.key)).size}{' '}
        clients appear more than once
      </p>
    </div>
  )
}
