import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { Card, DateTile, EmptyState, Led, SectionTitle } from '@/components/ui'
import { dayMonth, titleCase } from '@/lib/format'
import type { JournalStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const FLOW: JournalStatus[] = [
  'mentioned',
  'promo-sent',
  'received',
  'interested',
  'bulk-ordered',
  'shipped',
  'dropship',
]

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>
}) {
  const { order: focus } = await searchParams
  await requireUser()
  const provider = db()
  const [orders, deals] = await Promise.all([provider.listJournalOrders(), provider.listDeals()])
  const dealName = (id: string | null) => (id ? (deals.find((d) => d.id === id)?.name ?? id) : null)

  const counts = FLOW.map((status) => ({
    status,
    count: orders.filter((o) => o.status === status).length,
  }))

  return (
    <div>
      <SectionTitle right={<span className="sub">{orders.length} orders</span>}>Journal</SectionTitle>

      <Card className="mb-4">
        <div className="scroll-x no-scrollbar flex gap-2">
          {counts.map(({ status, count }) => (
            <span key={status} className="pill pill-ghost">
              <Led label={titleCase(status)} token={count ? 'accent' : 'text-muted'} on={count > 0} hollow={count === 0} />
              <span className="num">{count}</span>
            </span>
          ))}
        </div>
        <p className="body-copy mt-3 text-ink-secondary">
          The sidecar runs alongside deals, not inside them: Amazon tail sales, Instagram orders
          and attendee dropships live here with no deal link at all.
        </p>
      </Card>

      {orders.length === 0 ? (
        <EmptyState
          title="No journal orders"
          filledBy="Orders start at Mentioned when the journal comes up on a deal; the T-35 nudge chases a promo that never became an order."
        />
      ) : (
        <Card className="p-0">
          <ul>
            {orders.map((o) => (
              <li
                key={o.id}
                className={`flex items-center gap-3 border-b px-4 py-3 last:border-b-0 ${
                  focus === o.id ? 'bg-sunken' : ''
                }`}
              >
                <DateTile date={o.shipByDate} />
                <div className="min-w-0 flex-1">
                  <div className="rowname truncate">{o.reference}</div>
                  <div className="sub mt-1 truncate">
                    {[
                      o.quantity ? `${o.quantity} copies` : null,
                      o.shipByDate ? `ship by ${dayMonth(o.shipByDate)}` : null,
                      o.inserts ? 'inserts' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {o.warehouseNotes ? (
                    <p className="body-copy mt-1 text-ink-secondary">{o.warehouseNotes}</p>
                  ) : null}
                </div>
                <div className="flex flex-none flex-col items-end gap-2">
                  <Led label={titleCase(o.status)} token="accent" on />
                  {o.dealId ? (
                    <Link href={`/deals/${o.dealId}?tab=journal`} className="sub">
                      {dealName(o.dealId)}
                    </Link>
                  ) : (
                    <span className="sub text-ink-muted">no deal</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
