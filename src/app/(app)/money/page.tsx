import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canConfirmPayments, canSeeMoneyAmounts, canViewScreen } from '@/lib/rbac'
import { pipelineTotals, dealValue } from '@/lib/forecast'
import { money, shortDate } from '@/lib/format'
import { Card, EmptyState, Led, Micro, SectionTitle } from '@/components/ui'
import { ConfirmPayment } from '@/components/ConfirmPayment'
import { redirect } from 'next/navigation'
import { isTerminal } from '@/lib/stages'

export const dynamic = 'force-dynamic'

export default async function MoneyPage() {
  const user = await requireUser()
  if (!canViewScreen(user.role, 'money')) redirect('/pipeline')

  const provider = db()
  const [deals, payments, legs] = await Promise.all([
    provider.listDeals(),
    provider.listPayments(),
    provider.listScheduleLegs(),
  ])

  const showAmounts = canSeeMoneyAmounts(user)
  const confirmed = payments.filter((p) => p.status === 'confirmed')
  const proposed = payments.filter((p) => p.status === 'proposed')
  const received = confirmed.reduce((s, p) => s + p.amount, 0)

  const won = deals.filter((d) => ['closed-won', 'pre-event', 'delivered', 'debriefed'].includes(d.stage))
  const contracted = won.reduce((s, d) => s + dealValue(d), 0)
  const owed = Math.max(contracted - received, 0)
  const weighted = pipelineTotals(
    deals.filter((d) => !isTerminal(d.stage)),
  ).weighted

  const dealName = (id: string | null) => (id ? (deals.find((d) => d.id === id)?.name ?? id) : '—')

  if (!showAmounts) {
    return (
      <div>
        <SectionTitle>Money</SectionTitle>
        <EmptyState
          title="Amounts are hidden for your role"
          filledBy="You see payment and contract status as chips on each deal. An admin can turn amounts on for you in Settings → Users."
        />
      </div>
    )
  }

  return (
    <div>
      <SectionTitle>Money</SectionTitle>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <Micro>Owed</Micro>
          <div className="hero-num mt-1 text-accent">{money(owed, { compact: true })}</div>
        </Card>
        <Card className="p-4">
          <Micro>Received</Micro>
          <div className="hero-num mt-1">{money(received, { compact: true })}</div>
        </Card>
        <Card className="p-4">
          <Micro>Contracted</Micro>
          <div className="hero-num mt-1">{money(contracted, { compact: true })}</div>
        </Card>
        <Card className="p-4">
          <Micro>Weighted pipeline</Micro>
          <div className="hero-num mt-1">{money(weighted, { compact: true })}</div>
        </Card>
      </div>

      {proposed.length > 0 ? (
        <Card className="mb-4">
          <SectionTitle right={<span className="sub">human-confirmed only</span>}>
            Proposed matches
          </SectionTitle>
          <p className="body-copy mb-3 text-ink-secondary">
            The matcher pairs bank and QuickBooks events with an invoice number and amount. It
            never books a payment — a person does.
          </p>
          <ul>
            {proposed.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <Link href={`/deals/${p.dealId}?tab=money`} className="rowname">
                    {dealName(p.dealId)}
                  </Link>
                  <div className="sub mt-1">
                    {p.invoiceNumber ?? 'no invoice ref'} · {shortDate(p.receivedDate)} · {p.method ?? '—'}
                  </div>
                </div>
                <span className="num">{money(p.amount)}</span>
                <ConfirmPayment paymentId={p.id} disabled={!canConfirmPayments(user.role)} />
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mb-4">
        <SectionTitle>Ledger</SectionTitle>
        {confirmed.length === 0 ? (
          <p className="body-copy text-ink-secondary">No confirmed payments yet.</p>
        ) : (
          <ul>
            {confirmed.map((p) => (
              <li key={p.id} className="flex flex-wrap items-baseline gap-3 border-b py-2 last:border-b-0">
                <span className="rowname min-w-0 flex-1 truncate">{dealName(p.dealId)}</span>
                <span className="sub">{p.invoiceNumber ?? '—'}</span>
                <span className="sub">{shortDate(p.receivedDate)}</span>
                <span className="num">{money(p.amount)}</span>
              </li>
            ))}
            <li className="sum-rule mt-2 flex items-baseline justify-between pt-2">
              <span className="micro">Received</span>
              <span className="num">{money(received)}</span>
            </li>
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle>Upcoming legs</SectionTitle>
        {legs.filter((l) => !l.paid).length === 0 ? (
          <p className="body-copy text-ink-secondary">Nothing outstanding.</p>
        ) : (
          <ul>
            {legs
              .filter((l) => !l.paid)
              .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
              .map((leg) => (
                <li key={leg.id} className="flex flex-wrap items-baseline gap-3 border-b py-2 last:border-b-0">
                  <span className="rowname min-w-0 flex-1 truncate">{dealName(leg.dealId)}</span>
                  <span className="sub">{leg.label}</span>
                  <span className="sub">due {shortDate(leg.dueDate)}</span>
                  <span className="num">{money(leg.amount)}</span>
                  <Led label="open" token="chip-pending" on />
                </li>
              ))}
          </ul>
        )}
      </Card>

      <p className="body-copy mt-4 text-ink-secondary">
        The accountant never sees this screen — they are an interface-only collaborator on the
        published Airtable Money interface.
      </p>
    </div>
  )
}
