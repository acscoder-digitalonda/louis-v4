'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { Deal, StageKey, Task } from '@/lib/types'
import { BOARD_STAGES, isSkip } from '@/lib/stages'
import { dayMonth, money, tMinus } from '@/lib/format'
import { stageByKey } from '~/speaker.config'
import { forecastWeight, dealValue } from '@/lib/forecast'

interface Props {
  deals: Deal[]
  nextTaskByDeal: Record<string, Task | undefined>
  showAmounts: boolean
  canMove: boolean
}

/**
 * The macro pipeline — "where is everything", Ben's glance view.
 *
 * Drag between columns is a stage change and fires the F5 packet, so it asks first
 * when the move skips a stage or a guard would block it. On mobile the board becomes
 * a stage-filtered list with a segmented control; same data, same actions.
 */
export function PipelineBoard({ deals, nextTaskByDeal, showAmounts, canMove }: Props) {
  const router = useRouter()
  const [mobileStage, setMobileStage] = useState<StageKey>('sales')
  const [dragging, setDragging] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dormant = deals.filter((d) => d.stage === 'dormant')
  const byStage = (stage: StageKey) => deals.filter((d) => d.stage === stage)

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
          {showAmounts ? (
            <span className="pill pill-ghost num">{money(dealValue(deal), { compact: true })}</span>
          ) : null}
          {showAmounts && weight > 0 && weight < 100 ? (
            <span className="pill pill-ghost">{weight}%</span>
          ) : null}
        </div>

        {task ? (
          <div className="sub mt-3 truncate border-t pt-2">
            NEXT · {task.title}
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

      {/* Mobile: segmented control + one column. */}
      <div className="md:hidden">
        <div className="scroll-x no-scrollbar -mx-[var(--shell-pad)] mb-4 flex gap-2 px-[var(--shell-pad)]">
          {[...BOARD_STAGES, 'dormant' as StageKey].map((stage) => (
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

        {dormant.length > 0 ? (
          <details className="mt-5">
            <summary className="micro cursor-pointer">
              Dormant · {dormant.length}
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {dormant.map((deal) => (
                <Card key={deal.id} deal={deal} />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  )
}
