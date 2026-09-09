'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { DateConflict, Deal, DealTypeKey, StageKey, Task } from '@/lib/types'
import { BOARD_STAGES, isSkip } from '@/lib/stages'
import { dayMonth, money, tMinus } from '@/lib/format'
import { speaker, stageByKey } from '~/speaker.config'
import { forecastWeight, dealValue } from '@/lib/forecast'
import { isMuted } from '@/lib/followup'

interface Props {
  deals: Deal[]
  nextTaskByDeal: Record<string, Task | undefined>
  /** Open date clashes, so the board can say so before anyone drags anything. */
  conflicts: DateConflict[]
  showAmounts: boolean
  canMove: boolean
}

type TypeFilter = DealTypeKey | 'all'

/**
 * The macro pipeline — "where is everything", Ben's glance view.
 *
 * Drag between columns is a stage change and fires the F5 packet, so it asks first
 * when the move skips a stage or a guard would block it. On mobile the board becomes
 * a stage-filtered list with a segmented control; same data, same actions.
 */
export function PipelineBoard({ deals, nextTaskByDeal, conflicts, showAmounts, canMove }: Props) {
  const router = useRouter()
  const [mobileStage, setMobileStage] = useState<StageKey>('qualified')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [dragging, setDragging] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A deal with no type set is a keynote in practice — the whole seven-year history is —
  // so filtering to Keynote must not hide the deals nobody has typed yet.
  const shown =
    typeFilter === 'all'
      ? deals
      : deals.filter((d) => (d.dealType ?? 'keynote') === typeFilter)

  // Junk is closed-lost with different consequences: it left the board when it was
  // discarded, and the collapsed column is not a place for it to come back to.
  const closedLost = shown.filter((d) => d.stage === 'closed-lost' && d.closedLostReason !== 'junk')
  const byStage = (stage: StageKey) => shown.filter((d) => d.stage === stage)

  // Which deals are in an unresolved clash, so a card can say so.
  const inConflict = new Set(
    conflicts.filter((c) => c.status === 'open').flatMap((c) => c.dealIds),
  )
  const typeCounts = new Map<TypeFilter, number>([['all', deals.length]])
  for (const t of speaker.dealTypes) {
    typeCounts.set(t.key, deals.filter((d) => (d.dealType ?? 'keynote') === t.key).length)
  }

  async function move(deal: Deal, to: StageKey) {
    if (deal.stage === to) return
    if (isSkip(deal.stage, to)) {
      const ok = window.confirm(
        `Move “${deal.name}” from ${stageByKey.get(deal.stage)?.label} straight to ${
          stageByKey.get(to)?.label
        }? That skips a stage, and the stage packet for ${stageByKey.get(to)?.label} will fire.`,
      )
      if (!ok) return
    }
    setPending(deal.id)
    setError(null)
    try {
      const res = await fetch(`/api/deals/${deal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patch: { stage: to } }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? 'Could not move the deal.')
        return
      }
      router.refresh()
    } finally {
      setPending(null)
      setDragging(null)
    }
  }

  const Card = ({ deal }: { deal: Deal }) => {
    const task = nextTaskByDeal[deal.id]
    const weight = forecastWeight(deal)
    const clashes = inConflict.has(deal.id)
    const muted = isMuted(deal)
    return (
      <div
        draggable={canMove}
        onDragStart={() => setDragging(deal.id)}
        onDragEnd={() => setDragging(null)}
        className={`card mb-2 p-3 transition ${pending === deal.id ? 'opacity-50' : ''} ${
          dragging === deal.id ? 'opacity-40' : ''
        }`}
      >
        <Link href={`/deals/${deal.id}`} className="block text-ink">
          <div className="rowname truncate">{deal.name}</div>
          <div className="sub mt-1 truncate">
            {[deal.client?.name, deal.location].filter(Boolean).join(' · ') || 'No client linked'}
          </div>
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="pill pill-ghost">{dayMonth(deal.eventDate)}</span>
          {deal.eventDate ? <span className="pill pill-ghost">{tMinus(deal.eventDate)}</span> : null}
          {clashes ? <span className="pill pill-danger">date clash</span> : null}
          {muted ? (
            <span className="pill pill-ghost" title={`Muted until ${deal.muteUntil ?? 'further notice'}`}>
              muted
            </span>
          ) : null}
          {showAmounts ? (
            <span className="pill pill-ghost num">{money(dealValue(deal), { compact: true })}</span>
          ) : null}
          {showAmounts && weight > 0 && weight < 100 ? (
            <span className="pill pill-ghost">{weight}%</span>
          ) : null}
        </div>

        {task ? (
          <div className="sub mt-3 truncate border-t pt-2">NEXT · {task.title}</div>
        ) : deal.nextActionDate && !muted ? (
          // No task, but the follow-up engine has this deal armed. Saying "nothing
          // queued" would be wrong in the direction that loses deals.
          <div className="sub mt-3 truncate border-t pt-2">
            NEXT · chase {dayMonth(deal.nextActionDate)}
            {deal.nextActionOwner === 'owner' ? ` · ${speaker.speakerName.split(' ')[0]}` : ''}
          </div>
        ) : (
          <div className="sub mt-3 border-t pt-2 text-ink-muted">NEXT · nothing queued</div>
        )}
      </div>
    )
  }

  return (
    <div>
      {error ? (
        <div className="card mb-4 border-danger">
          <div className="micro mb-1 text-danger">Move blocked</div>
          <p className="body-copy">{error}</p>
        </div>
      ) : null}

      {/* WP1.3 — clashes are the one thing that must be seen before anything is moved. */}
      {conflicts.some((c) => c.status === 'open') ? (
        <div className="card mb-4 border-danger">
          <div className="micro mb-2 text-danger">
            {conflicts.filter((c) => c.status === 'open').length} date clash
            {conflicts.filter((c) => c.status === 'open').length === 1 ? '' : 'es'} open
          </div>
          <div className="flex flex-col gap-1">
            {conflicts
              .filter((c) => c.status === 'open')
              .slice(0, 4)
              .map((c) => (
                <Link key={c.id} href={`/queue?conflict=${c.id}`} className="body-copy truncate">
                  {c.label}
                </Link>
              ))}
          </div>
          <p className="sub mt-2">
            Nothing is released automatically. Ben decides; the system only flags.
          </p>
        </div>
      ) : null}

      {/* WP2.1 — Deal Type filter. Hidden when only one type is in play, which is most
          of the time: showing a filter with one option teaches nothing. */}
      {[...typeCounts.entries()].filter(([k, n]) => k !== 'all' && n > 0).length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {(['all', ...speaker.dealTypes.map((t) => t.key)] as TypeFilter[]).map((key) => {
            const count = typeCounts.get(key) ?? 0
            if (key !== 'all' && count === 0) return null
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTypeFilter(key)}
                className={`pill ${typeFilter === key ? 'pill-accent' : 'pill-ghost'}`}
              >
                {key === 'all' ? 'All' : speaker.dealTypes.find((t) => t.key === key)?.label}
                <span className={typeFilter === key ? '' : 'pill-count'}>{count}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {/* Mobile: segmented control + one column. */}
      <div className="md:hidden">
        <div className="scroll-x no-scrollbar -mx-[var(--shell-pad)] mb-4 flex gap-2 px-[var(--shell-pad)]">
          {[...BOARD_STAGES, 'closed-lost' as StageKey].map((stage) => (
            <button
              key={stage}
              type="button"
              onClick={() => setMobileStage(stage)}
              className={`pill ${mobileStage === stage ? 'pill-accent' : 'pill-ghost'}`}
            >
              {stageByKey.get(stage)?.label}
              <span className={mobileStage === stage ? '' : 'pill-count'}>
                {byStage(stage).length}
              </span>
            </button>
          ))}
        </div>
        {byStage(mobileStage).length === 0 ? (
          <div className="well px-4 py-8 text-center">
            <div className="sub">Nothing in {stageByKey.get(mobileStage)?.label}</div>
          </div>
        ) : (
          byStage(mobileStage).map((deal) => <Card key={deal.id} deal={deal} />)
        )}
      </div>

      {/* Desktop: the board. */}
      <div className="hidden md:block">
        <div className="scroll-x -mx-[var(--shell-pad)] px-[var(--shell-pad)] pb-2">
          <div className="flex min-w-max gap-3">
            {BOARD_STAGES.map((stage) => {
              const column = byStage(stage)
              return (
                <div
                  key={stage}
                  className="w-[248px] flex-none"
                  onDragOver={(e) => {
                    if (canMove) e.preventDefault()
                  }}
                  onDrop={() => {
                    const deal = deals.find((d) => d.id === dragging)
                    if (deal) void move(deal, stage)
                  }}
                >
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="micro">{stageByKey.get(stage)?.label}</span>
                    <span className="sub num">{column.length}</span>
                  </div>
                  <div className="well min-h-[120px] p-2">
                    {column.length === 0 ? (
                      <div className="px-2 py-6 text-center">
                        <span className="sub text-ink-muted">empty</span>
                      </div>
                    ) : (
                      column.map((deal) => <Card key={deal.id} deal={deal} />)
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {closedLost.length > 0 ? (
          <details className="mt-5">
            <summary className="micro cursor-pointer">
              {stageByKey.get('closed-lost')?.label} · {closedLost.length}
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {closedLost.map((deal) => (
                <Card key={deal.id} deal={deal} />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  )
}
