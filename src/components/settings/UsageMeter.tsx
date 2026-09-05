import type { AiSettings, ModelTier, UsageLogRow } from '@/lib/types'
import { Micro, Well } from '@/components/ui'

/**
 * Settings → AI → usage meter (Handoff §7.2).
 *
 * Bars are recessed wells with an ink fill — the paper-ink chart grammar — so the meter
 * reads as part of the app rather than a charting library dropped into it.
 */
export function UsageMeter({ rows, ai }: { rows: UsageLogRow[]; ai: AiSettings }) {
  const now = Date.now()
  const since = (days: number) => now - days * 86_400_000
  const inWindow = (row: UsageLogRow, days: number) => new Date(row.at).getTime() >= since(days)

  const sum = (list: UsageLogRow[]) => list.reduce((s, r) => s + r.estCost, 0)
  const today = rows.filter((r) => inWindow(r, 1))
  const week = rows.filter((r) => inWindow(r, 7))
  const month = rows.filter((r) => inWindow(r, 30))

  const errors = month.filter((r) => !r.ok).length
  const errorRate = month.length ? Math.round((errors / month.length) * 100) : 0
  const anyEstimated = month.some((r) => r.estimated)

  const capUsed = ai.monthlyCapUsd ? Math.min(sum(month) / ai.monthlyCapUsd, 1) : 0
  const capPct = Math.round(capUsed * 100)

  const byTier: Record<ModelTier, number> = { haiku: 0, sonnet: 0, opus: 0 }
  for (const r of month) byTier[r.tier] += r.estCost

  const byWorker = new Map<string, number>()
  for (const r of month) byWorker.set(r.worker, (byWorker.get(r.worker) ?? 0) + r.estCost)
  const workers = [...byWorker.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  const maxWorker = Math.max(...workers.map(([, v]) => v), 0.000001)

  if (rows.length === 0) {
    return (
      <Well className="px-4 py-8 text-center">
        <div className="rowname mb-2">No model calls logged yet</div>
        <p className="body-copy mx-auto max-w-[46ch] text-ink-secondary">
          Every gateway call writes a Usage Log row — successes and failures both. Run a worker and
          this fills in.
        </p>
      </Well>
    )
  }

  return (
    <div className="space-y-4">
      {capPct >= 80 ? (
        <div className={`card ${capPct >= 100 ? 'border-danger' : 'border-warning'}`}>
          <div className={`micro mb-1 ${capPct >= 100 ? 'text-danger' : 'text-warning'}`}>
            {capPct >= 100 ? 'Cap reached' : `${capPct}% of the monthly cap`}
          </div>
          <p className="body-copy">
            {capPct >= 100 && ai.pauseNonCriticalAtCap
              ? 'Research and the QA sweep are paused. Intake, timers and checker passes keep running.'
              : 'Research and QA pause at 100%; intake and timers continue.'}
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Today" value={sum(today)} />
        <Stat label="7 days" value={sum(week)} />
        <Stat label="30 days" value={sum(month)} />
      </div>

      <div>
        <Micro>Against the cap</Micro>
        <div className="well mt-2 h-3 overflow-hidden">
          <div
            className="h-full bg-accent"
            style={{ width: `${Math.max(capPct, 1)}%` }}
            aria-hidden="true"
          />
        </div>
        <div className="sub mt-1">
          ${sum(month).toFixed(2)} of ${ai.monthlyCapUsd.toFixed(2)} · {month.length} calls ·{' '}
          {errorRate}% errors
        </div>
      </div>

      <div>
        <Micro>By tier (30d)</Micro>
        <div className="mt-2 space-y-2">
          {(Object.keys(byTier) as ModelTier[]).map((tier) => (
            <div key={tier} className="flex items-center gap-3">
              <span className="sub w-[54px]">{tier}</span>
              <div className="well h-3 flex-1 overflow-hidden">
                <div
                  className="h-full bg-ink"
                  style={{
                    width: `${Math.round((byTier[tier] / Math.max(sum(month), 0.000001)) * 100)}%`,
                  }}
                  aria-hidden="true"
                />
              </div>
              <span className="num w-[64px] text-right text-[11px]">${byTier[tier].toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Micro>By worker (30d)</Micro>
        <div className="mt-2 space-y-2">
          {workers.map(([worker, cost]) => (
            <div key={worker} className="flex items-center gap-3">
              <span className="sub w-[110px] truncate">{worker}</span>
              <div className="well h-3 flex-1 overflow-hidden">
                <div
                  className="h-full bg-ink"
                  style={{ width: `${Math.round((cost / maxWorker) * 100)}%` }}
                  aria-hidden="true"
                />
              </div>
              <span className="num w-[64px] text-right text-[11px]">${cost.toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>

      {anyEstimated ? (
        <p className="body-copy text-ink-secondary">
          Some rows are marked <em>est.</em> — Claude Code runs are covered by the Max plan, so the
          figure is an equivalent cost, not a bill. That is deliberate: you want the real burn rate
          before you flip the backend.
        </p>
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="well px-3 py-3">
      <Micro>{label}</Micro>
      <div className="num mt-1 text-[18px]">${value.toFixed(2)}</div>
    </div>
  )
}
