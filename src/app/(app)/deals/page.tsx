import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canSeeMoneyAmounts, canWrite } from '@/lib/rbac'
import { dealValue } from '@/lib/forecast'
import { money, shortDate, tMinus } from '@/lib/format'
import { Card, DateTile, EmptyState, SectionTitle, StageLed } from '@/components/ui'
import { NewDealButton } from '@/components/NewDealButton'
import { ALL_STAGES } from '@/lib/stages'
import { stageByKey } from '~/speaker.config'

export const dynamic = 'force-dynamic'

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; q?: string }>
}) {
  const { stage, q } = await searchParams
  const user = await requireUser()
  const deals = await db().listDeals({ stage, q })
  const showAmounts = canSeeMoneyAmounts(user)

  return (
    <div>
      <SectionTitle
        right={canWrite(user.role, 'deals').allowed ? <NewDealButton /> : undefined}
      >
        Deals · {deals.length}
      </SectionTitle>

      <div className="scroll-x no-scrollbar -mx-[var(--shell-pad)] mb-4 flex gap-2 px-[var(--shell-pad)]">
        <Link href="/deals" className={`pill ${!stage ? 'pill-accent' : 'pill-ghost'}`}>
          All
        </Link>
        {ALL_STAGES.map((s) => (
          <Link
            key={s}
            href={`/deals?stage=${s}`}
            className={`pill ${stage === s ? 'pill-accent' : 'pill-ghost'}`}
          >
            {stageByKey.get(s)?.label}
          </Link>
        ))}
      </div>

      {deals.length === 0 ? (
        <EmptyState
          title="No deals here"
          filledBy="Form intake (F1) and email intake (F2) create deals at Inquiry. You can also add one by hand."
        />
      ) : (
        <Card className="p-0">
          <ul>
            {deals.map((deal) => (
              <li key={deal.id} className="border-b last:border-b-0">
                <Link
                  href={`/deals/${deal.id}`}
                  className="flex items-center gap-3 px-4 py-3 text-ink hover:bg-sunken"
                >
                  <DateTile date={deal.eventDate} />
                  <div className="min-w-0 flex-1">
                    <div className="rowname truncate">{deal.name}</div>
                    <div className="sub mt-1 truncate">
                      {[deal.client?.name, deal.location, shortDate(deal.eventDate)]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <div className="hidden flex-none items-center gap-3 sm:flex">
                    {showAmounts ? (
                      <span className="num text-[12px]">{money(dealValue(deal), { compact: true })}</span>
                    ) : null}
                    <span className="sub w-[52px] text-right">{tMinus(deal.eventDate)}</span>
                    <StageLed stage={deal.stage} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
