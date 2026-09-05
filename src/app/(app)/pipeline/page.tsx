import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canSeeMoneyAmounts, canWrite } from '@/lib/rbac'
import { pipelineTotals } from '@/lib/forecast'
import { PipelineBoard } from '@/components/PipelineBoard'
import { Card, EmptyState, Micro, SectionTitle } from '@/components/ui'
import Link from 'next/link'
import { money } from '@/lib/format'
import type { Task } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function PipelinePage() {
  const user = await requireUser()
  const provider = db()
  const [deals, tasks, seedProposals] = await Promise.all([
    provider.listDeals(),
    provider.listTasks({ done: false }),
    provider.listDealProposals('proposed'),
  ])

  // "Next task" per deal — the one thing a card must answer beyond where it is.
  const nextTaskByDeal: Record<string, Task | undefined> = {}
  for (const task of tasks) {
    if (!task.dealId) continue
    const current = nextTaskByDeal[task.dealId]
    if (!current || (task.dueDate ?? '9999') < (current.dueDate ?? '9999')) {
      nextTaskByDeal[task.dealId] = task
    }
  }

  const showAmounts = canSeeMoneyAmounts(user)

  // Imported history never appears on the board. 802 events delivered between 2019 and
  // 2026 are the record, not the work — counting them as "live deals" makes every number
  // on this page wrong and buries the handful of real ones. They stay reachable in Deals
  // and CRM; this is the working surface.
  const boardDeals = deals.filter((d) => !d.historical)
  const historical = deals.filter((d) => d.historical)
  const live = boardDeals.filter((d) => d.stage !== 'dormant' && d.stage !== 'debriefed')
  const totals = pipelineTotals(live)

  return (
    <div>
      <SectionTitle>Pipeline</SectionTitle>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <Micro>Live deals</Micro>
          <div className="hero-num mt-1">{totals.count}</div>
        </Card>
        <Card className="p-4">
          <Micro>Next 90 days</Micro>
          <div className="hero-num mt-1">
            {
              live.filter((d) => {
                if (!d.eventDate) return false
                const days = (new Date(d.eventDate).getTime() - Date.now()) / 86_400_000
                return days >= 0 && days <= 90
              }).length
            }
          </div>
        </Card>
        {showAmounts ? (
          <>
            <Card className="p-4">
              <Micro>Gross</Micro>
              <div className="hero-num mt-1">{money(totals.gross, { compact: true })}</div>
            </Card>
            <Card className="p-4">
              <Micro>Weighted</Micro>
              <div className="hero-num mt-1 text-accent">
                {money(totals.weighted, { compact: true })}
              </div>
            </Card>
          </>
        ) : (
          <Card className="col-span-2 p-4">
            <Micro>Money</Micro>
            <p className="body-copy mt-1 text-ink-secondary">
              Amounts are hidden for your role. Turn them on in Settings → Appearance.
            </p>
          </Card>
        )}
      </div>

      {boardDeals.length === 0 ? (
        // An empty board is the truth right after the cutover: the history is delivered
        // and the live pipeline is still proposals nobody has accepted. Saying so beats
        // five empty columns, which read as a broken page rather than a finished import.
        <EmptyState
          title="No live deals yet"
          filledBy={
            seedProposals.length > 0
              ? `${seedProposals.length} seeded deals are waiting in the review queue. ` +
                `Accepting one puts it on this board. ` +
                `${historical.length} delivered events were imported as history and stay off it.`
              : `${historical.length} delivered events were imported as history and stay off this board. ` +
                `New deals appear here as inquiries arrive.`
          }
          action={
            seedProposals.length > 0 ? (
              <Link className="pill pill-accent" href="/queue">
                Review {seedProposals.length} seeded deals
              </Link>
            ) : (
              <Link className="pill pill-outline" href="/deals">
                See the {historical.length} imported deals
              </Link>
            )
          }
        />
      ) : (
        <PipelineBoard
          deals={boardDeals}
          nextTaskByDeal={nextTaskByDeal}
          showAmounts={showAmounts}
          canMove={canWrite(user.role, 'deals', 'stage').allowed}
        />
      )}
    </div>
  )
}
