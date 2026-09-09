import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canSeeMoneyAmounts, canWrite } from '@/lib/rbac'
import { STAGE_PACKETS } from '@/lib/stages'
import { forecastWeight, dealValue } from '@/lib/forecast'
import { dayMonth, money, relativeTime, shortDate, tMinus } from '@/lib/format'
import { EditableField } from '@/components/EditableField'
import { StageSelect } from '@/components/StageSelect'
import { TaskList } from '@/components/TaskList'
import {
  Card,
  ContractLed,
  EmptyState,
  Led,
  Micro,
  PaymentLed,
  Pill,
  SectionTitle,
  Well,
} from '@/components/ui'
import { speaker, stageByKey } from '~/speaker.config'
import { priceDeal, type PricedDeal } from '@/lib/pricing'
import { isMuted, shouldChase } from '@/lib/followup'
import { nudgesFor } from '@/lib/fulfillment'
import { LineItems } from '@/components/deal/LineItems'
import { CoachingLedger } from '@/components/deal/CoachingLedger'
import { CapacityCheck } from '@/components/deal/CapacityCheck'
import { DealTabs } from '@/components/deal/DealTabs'
import { REPLY_SLA_MINUTES, slaState, type SlaState } from '@/lib/sla'
import { isCoaching } from '@/lib/coaching'
import type { Deal, DealLineItem, Fulfillment, JournalOrder, Product, Task } from '@/lib/types'

export const dynamic = 'force-dynamic'

const TABS = [
  'overview',
  'sales',
  'logistics',
  'questionnaire',
  'coaching',
  'assets',
  'journal',
  'money',
  'activity',
] as const
type Tab = (typeof TABS)[number]

export default async function DealPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab: rawTab } = await searchParams
  const tab: Tab = (TABS as readonly string[]).includes(rawTab ?? '') ? (rawTab as Tab) : 'overview'

  const user = await requireUser()
  const provider = db()
  const deal = await provider.getDeal(id)
  if (!deal) notFound()

  const [tasks, drafts, emails, audit, journal, payments, legs, contacts, briefs] = await Promise.all([
    provider.listTasks({ dealId: id }),
    provider.listDrafts({ dealId: id }),
    provider.listEmails(id),
    provider.listAudit(id, 60),
    provider.listJournalOrders(id),
    provider.listPayments(id),
    provider.listScheduleLegs(id),
    provider.listContacts({ dealId: id }),
    provider.listResearchBriefs(id),
  ])

  // The rate card's view of this deal. A missing card is a state, not an error: it means
  // the deal has no region or format yet, and the Sales tab says which.
  const priced: PricedDeal = priceDeal(deal, await provider.listRateCards().catch(() => []))

  // WP1.4 + Decisions Log §1: what is in flight for this deal, and what this company has
  // bought before. The second is the chip Ben should never walk into a call without.
  const fulfillment = (await provider.listFulfillment(id).catch(() => [])).filter(
    (f) => f.dealId === deal.id,
  )
  // Only for a coaching deal: a keynote has no sessions and the read would be waste.
  const coachingSessions = isCoaching(deal.dealType)
    ? await provider.listCoachingSessions(deal.id).catch(() => [])
    : []

  const [lineItems, products] = await Promise.all([
    provider.listLineItems(deal.id).catch(() => []),
    provider.listProducts().catch(() => []),
  ])
  const companyDeals = deal.client
    ? (await provider.listDeals()).filter((d) => d.client?.id === deal.client!.id)
    : []
  const companyDealIds = new Set(companyDeals.map((d) => d.id))
  const purchaseHistory = journal
    .filter((o) => o.dealId && companyDealIds.has(o.dealId) && o.dealId !== deal.id)
    .filter((o) => ['bulk-ordered', 'shipped', 'dropship'].includes(o.status))
    .map((o) => ({
      dealName: companyDeals.find((d) => d.id === o.dealId)?.name ?? 'Earlier booking',
      quantity: o.quantity ?? 0,
      year: o.shipByDate?.slice(0, 4) ?? null,
    }))

  const endpoint = `/api/deals/${deal.id}`
  const editable = (field: keyof Deal) => canWrite(user.role, 'deals', field).allowed
  const lockReason = (field: keyof Deal) => canWrite(user.role, 'deals', field).reason
  const showAmounts = canSeeMoneyAmounts(user)
  const dealJournal = journal.filter((o) => o.dealId === deal.id)
  const dealPayments = payments.filter((p) => p.dealId === deal.id)
  const dealLegs = legs.filter((l) => l.dealId === deal.id)
  const dealContacts = contacts.filter((c) => c.dealIds.includes(deal.id))

  return (
    <div>
      {/* ── header ─────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <Link href="/pipeline" className="sub">
          ← Pipeline
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[clamp(22px,5vw,32px)] font-bold uppercase leading-tight tracking-[.04em]">
              {deal.name}
            </h1>
            <div className="sub mt-1">
              {[deal.client?.name, deal.location, shortDate(deal.eventDate)]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <div className="flex flex-none items-center gap-2">
            {deal.eventDate ? <span className="pill pill-ghost">{tMinus(deal.eventDate)}</span> : null}
            <StageSelect
              dealId={deal.id}
              stage={deal.stage}
              canEdit={canWrite(user.role, 'deals', 'stage').allowed}
            />
          </div>
        </div>
      </div>

      {/* ── tabs: switched on the client; the URL follows ───────────────── */}
      <DealTabs
        dealId={deal.id}
        tabs={TABS}
        initial={tab}
        panels={{
          overview: (
        <OverviewTab
          deal={deal}
          tasks={tasks}
          endpoint={endpoint}
          editable={editable}
          lockReason={lockReason}
          canEditTasks={canWrite(user.role, 'tasks').allowed}
          contacts={dealContacts}
          briefCount={briefs.length}
        />
          ),
          sales: (
        <SalesTab
          deal={deal}
          priced={priced}
          endpoint={endpoint}
          editable={editable}
          lockReason={lockReason}
          showAmounts={showAmounts}
          drafts={drafts.filter((d) => ['proposal', 'follow-up', 'forcing'].includes(d.type))}
          sla={deal.stage === 'inquiry' ? slaState(deal, drafts) : null}
        />
          ),
          logistics: (
        <LogisticsTab deal={deal} endpoint={endpoint} editable={editable} lockReason={lockReason} tasks={tasks} />
          ),
          questionnaire: (
        <QuestionnaireTab deal={deal} endpoint={endpoint} editable={editable} lockReason={lockReason} />
          ),
          assets: (
        <AssetsTab deal={deal} endpoint={endpoint} editable={editable} />
          ),
          coaching: (
        isCoaching(deal.dealType) ? (
          <CoachingLedger
            sessions={coachingSessions}
            canEdit={canWrite(user.role, 'coachingSessions').allowed}
          />
        ) : (
          <EmptyState
            title="Not a coaching deal"
            filledBy="The session ledger belongs to Speaker Coaching and Executive Coaching. Change the Deal Type on the Overview tab if this is one."
          />
        )
          ),
          journal: (
        <JournalTab
          orders={dealJournal}
          fulfillment={fulfillment}
          purchaseHistory={purchaseHistory}
          lineItems={lineItems}
          products={products.filter((p) => p.active)}
          dealId={deal.id}
          showAmounts={showAmounts}
          canEdit={canWrite(user.role, 'dealLineItems').allowed}
        />
          ),
          money: (
        <MoneyTab
          deal={deal}
          showAmounts={showAmounts}
          payments={dealPayments}
          legs={dealLegs}
        />
          ),
          activity: (
        <ActivityTab audit={audit} emails={emails} drafts={drafts} />
          ),
        }}
      />
    </div>
  )
}

// ── Overview ────────────────────────────────────────────────────────────────

function MiniPipeline({ deal, tasks }: { deal: Deal; tasks: Task[] }) {
  const packet = STAGE_PACKETS[deal.stage]
  const openTitles = new Set(tasks.filter((t) => !t.done).map((t) => t.title.toLowerCase()))
  const doneTitles = new Set(tasks.filter((t) => t.done).map((t) => t.title.toLowerCase()))

  // The strip renders from the same packet the engine fires, so the checklist a human
  // reads and the work the system creates cannot drift apart.
  return (
    <div className="scroll-x no-scrollbar flex gap-2">
      {packet.checklist.map((step) => {
        const matchedDone = [...doneTitles].some((t) => overlap(t, step))
        const matchedOpen = [...openTitles].some((t) => overlap(t, step))
        return (
          <span key={step} className="pill pill-ghost">
            <Led
              label={step}
              token={matchedDone ? 'chip-paid' : matchedOpen ? 'accent' : 'text-muted'}
              on={matchedDone || matchedOpen}
              hollow={!matchedDone && !matchedOpen}
            />
          </span>
        )
      })}
    </div>
  )
}

/** Loose match between a packet step and a task title — words in common. */
function overlap(a: string, b: string): boolean {
  const wordsA = new Set(a.toLowerCase().split(/\W+/).filter((w) => w.length > 3))
  const wordsB = b.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
  return wordsB.some((w) => wordsA.has(w))
}

function OverviewTab({
  deal,
  tasks,
  endpoint,
  editable,
  lockReason,
  canEditTasks,
  contacts,
  briefCount,
}: {
  deal: Deal
  tasks: Task[]
  endpoint: string
  editable: (f: keyof Deal) => boolean
  lockReason: (f: keyof Deal) => string | undefined
  canEditTasks: boolean
  contacts: { id: string; name: string; email: string | null; type: string; phone: string | null }[]
  briefCount: number
}) {
  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle>{stageByKey.get(deal.stage)?.label} — this stage</SectionTitle>
        <MiniPipeline deal={deal} tasks={tasks} />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Event essentials</SectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <EditableField
              endpoint={endpoint}
              field="eventDate"
              label="Event date"
              value={deal.eventDate}
              kind="date"
              readOnly={!editable('eventDate')}
              lockReason={lockReason('eventDate')}
              lastModified={deal.lastModified}
            />
            <EditableField
              endpoint={endpoint}
              field="location"
              label="Location"
              value={deal.location}
              readOnly={!editable('location')}
              lockReason={lockReason('location')}
              lastModified={deal.lastModified}
            />
            <EditableField
              endpoint={endpoint}
              field="avCheckTime"
              label="AV check"
              value={deal.avCheckTime}
              readOnly={!editable('avCheckTime')}
              lockReason={lockReason('avCheckTime')}
              placeholder="e.g. 8:15 AM ET, ballroom"
              lastModified={deal.lastModified}
            />
            <EditableField
              endpoint={endpoint}
              field="stageTime"
              label="Stage time"
              value={deal.stageTime}
              readOnly={!editable('stageTime')}
              lockReason={lockReason('stageTime')}
              lastModified={deal.lastModified}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle right={<span className="sub">{tasks.filter((t) => !t.done).length} open</span>}>
            Next tasks
          </SectionTitle>
          <TaskList tasks={tasks.filter((t) => !t.done)} canEdit={canEditTasks} />
        </Card>
      </div>

      <Card>
        <EditableField
          endpoint={endpoint}
          field="kickoffNotes"
          label="Kickoff notes"
          value={deal.kickoffNotes}
          kind="textarea"
          readOnly={!editable('kickoffNotes')}
          lockReason={lockReason('kickoffNotes')}
          placeholder="What matters about this room."
          lastModified={deal.lastModified}
        />
      </Card>

      <Card>
        <SectionTitle right={briefCount ? <span className="sub">{briefCount} research brief(s)</span> : undefined}>
          Contacts
        </SectionTitle>
        {contacts.length === 0 ? (
          <EmptyState
            title="No contacts linked yet"
            filledBy="Email intake (F2) links people as they appear on the thread, or add them from the CRM screen."
          />
        ) : (
          <ul className="space-y-2">
            {contacts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-baseline gap-2">
                <span className="rowname">{c.name}</span>
                <span className="sub">{c.type}</span>
                {c.email ? <span className="body-copy text-ink-secondary">{c.email}</span> : null}
                {c.phone ? <span className="body-copy text-ink-secondary">{c.phone}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ── Sales ───────────────────────────────────────────────────────────────────

function SalesTab({
  deal,
  endpoint,
  editable,
  lockReason,
  showAmounts,
  drafts,
  priced,
  sla,
}: {
  deal: Deal
  endpoint: string
  editable: (f: keyof Deal) => boolean
  lockReason: (f: keyof Deal) => string | undefined
  showAmounts: boolean
  drafts: { id: string; subject: string; type: string; status: string; createdAt: string }[]
  priced: PricedDeal
  sla: SlaState | null
}) {
  const weight = forecastWeight(deal)
  const belowFloor = (deal.negotiatedFee ?? Infinity) < speaker.fees.floor
  const chase = shouldChase(deal)

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle right={<span className="sub">weighted {weight}%</span>}>Fees</SectionTitle>
        {showAmounts ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <EditableField
              endpoint={endpoint}
              field="listFee"
              label="List fee"
              value={deal.listFee}
              kind="currency"
              readOnly={!editable('listFee')}
              lockReason={lockReason('listFee')}
              lastModified={deal.lastModified}
            />
            <EditableField
              endpoint={endpoint}
              field="negotiatedFee"
              label="Negotiated"
              value={deal.negotiatedFee}
              kind="currency"
              readOnly={!editable('negotiatedFee')}
              lockReason={lockReason('negotiatedFee')}
              lastModified={deal.lastModified}
            />
            <div>
              <Micro>Deal value</Micro>
              <div className="num mt-1 text-[14px]">{money(dealValue(deal))}</div>
            </div>
            <div>
              <Micro>Forecast</Micro>
              <div className="num mt-1 text-[14px] text-accent">
                {money(Math.round((dealValue(deal) * weight) / 100))}
              </div>
            </div>
          </div>
        ) : (
          <p className="body-copy text-ink-secondary">
            Amounts are hidden for your role. The forecast weight for this stage is {weight}%.
          </p>
        )}
        {showAmounts && belowFloor ? (
          <p className="body-copy mt-3 text-warning">
            Negotiated fee is below the {money(speaker.fees.floor)} floor in speaker.config.
          </p>
        ) : null}
      </Card>

      {/* Contract and billing. Two selects the office sets; two gates the engine reads.
          Pre-Event opens on a signed contract; the welcome kit waits for the contract and
          the deposit invoice. Neither was reachable from any screen before this card. */}
      <Card>
        <SectionTitle right={<span className="sub">gates Pre-Event and the kit</span>}>
          Contract &amp; billing
        </SectionTitle>
        <div className="grid grid-cols-2 gap-4">
          <EditableField
            endpoint={endpoint}
            field="contractStatus"
            label="Contract"
            value={deal.contractStatus}
            kind="select"
            options={[
              { value: 'none', label: 'Not sent' },
              { value: 'out', label: 'Out for signature' },
              { value: 'signed', label: 'Signed' },
            ]}
            readOnly={!editable('contractStatus')}
            lockReason={lockReason('contractStatus')}
            lastModified={deal.lastModified}
          />
          <EditableField
            endpoint={endpoint}
            field="paymentStatus"
            label="Billing"
            value={deal.paymentStatus}
            kind="select"
            options={[
              { value: 'unbilled', label: 'Unbilled' },
              { value: 'invoiced', label: 'Invoiced' },
              { value: 'partial', label: 'Partly paid' },
              { value: 'paid', label: 'Paid' },
              { value: 'overdue', label: 'Overdue' },
            ]}
            readOnly={!editable('paymentStatus')}
            lockReason={lockReason('paymentStatus')}
            lastModified={deal.lastModified}
          />
        </div>
        <p className="sub mt-3">
          Pre-Event needs the contract signed. The welcome kit goes once the contract is signed
          and the deposit invoice is out — not when the money lands.
        </p>
      </Card>

      {/* WP1.1 — what the rate card says, next to what was actually agreed. */}
      {showAmounts ? (
        <Card>
          <SectionTitle right={<span className="sub">{priced.card?.label ?? 'no card'}</span>}>
            Rate card
          </SectionTitle>
          {priced.listAmount === null ? (
            <p className="body-copy text-ink-secondary">
              {priced.reason}{' '}
              <span className="text-ink-muted">
                A deal with no list price is not priced at zero; it is one nobody can price yet.
              </span>
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div>
                  <Micro>List</Micro>
                  <div className="num mt-1 text-[14px]">{money(priced.listAmount)}</div>
                </div>
                <div>
                  <Micro>Weekend</Micro>
                  <div className="num mt-1 text-[14px]">
                    {priced.weekendSurcharge > 0 ? money(priced.weekendSurcharge) : '—'}
                  </div>
                </div>
                <div>
                  <Micro>Travel</Micro>
                  <div className="num mt-1 text-[14px]">
                    {priced.travelStipend !== null ? money(priced.travelStipend) : '—'}
                  </div>
                </div>
                <div>
                  <Micro>Amount</Micro>
                  <div className="num mt-1 text-[14px] text-accent">
                    {priced.amount !== null ? money(priced.amount) : '—'}
                  </div>
                </div>
              </div>
              {priced.travelTerms ? (
                <p className="body-copy mt-3 text-ink-secondary">{priced.travelTerms}</p>
              ) : null}
            </>
          )}
        </Card>
      ) : null}

      {/* The one service promise with a number on it. Only asked while it is live. */}
      {sla ? (
        <Card className={sla.breached ? 'border-danger' : undefined}>
          <SectionTitle right={<span className="sub">target {REPLY_SLA_MINUTES} min</span>}>
            Reply clock
          </SectionTitle>
          <p className={`body-copy ${sla.breached ? 'text-danger' : ''}`}>{sla.label}</p>
          <p className="sub mt-1">
            Counted in working hours only — an inquiry that lands at eleven at night has not
            been ignored by midnight.
          </p>
        </Card>
      ) : null}

      {/* Ben's rule: three keynotes a week, Liezel checks a day either side. Advisory. */}
      {deal.dealType === 'keynote' ? (
        <Card>
          <SectionTitle>Load around this date</SectionTitle>
          <CapacityCheck dealId={deal.id} date={deal.eventDate} />
        </Card>
      ) : null}

      {/* WP1.2 — whose turn it is, and when. Read-only: the engine owns these. */}
      <Card>
        <SectionTitle
          right={
            deal.followUpCount > 0 ? (
              <span className="sub">
                {deal.followUpCount} touch{deal.followUpCount === 1 ? '' : 'es'}
              </span>
            ) : null
          }
        >
          Next action
        </SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`pill ${chase.due ? 'pill-accent' : 'pill-ghost'}`}>
            {deal.nextActionDate ? dayMonth(deal.nextActionDate) : 'not armed'}
          </span>
          {deal.nextActionOwner ? (
            <span className="pill pill-ghost">
              {deal.nextActionOwner === 'owner' ? speaker.speakerName.split(' ')[0] : 'ops'}
            </span>
          ) : null}
          {isMuted(deal) ? (
            <span className="pill pill-ghost">
              muted{deal.muteUntil ? ` until ${dayMonth(deal.muteUntil)}` : ''}
            </span>
          ) : null}
        </div>
        <p className="body-copy mt-2 text-ink-secondary">{chase.reason}</p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle>Decision</SectionTitle>
          <div className="grid grid-cols-2 gap-4">
            <EditableField
              endpoint={endpoint}
              field="holdDate"
              label="Hold date"
              value={deal.holdDate}
              kind="date"
              readOnly={!editable('holdDate')}
              lockReason={lockReason('holdDate')}
              lastModified={deal.lastModified}
            />
            <EditableField
              endpoint={endpoint}
              field="decisionDate"
              label="Decision date"
              value={deal.decisionDate}
              kind="date"
              readOnly={!editable('decisionDate')}
              lockReason={lockReason('decisionDate')}
              lastModified={deal.lastModified}
            />
            <EditableField
              endpoint={endpoint}
              field="proposalSent"
              label="Proposal sent"
              value={deal.proposalSent}
              kind="checkbox"
              readOnly={!editable('proposalSent')}
              lockReason={lockReason('proposalSent')}
              lastModified={deal.lastModified}
            />
            <EditableField
              endpoint={endpoint}
              field="source"
              label="Source"
              value={deal.source}
              kind="select"
              options={[
                { value: 'direct', label: 'Direct' },
                { value: 'bureau', label: 'Bureau' },
              ]}
              readOnly={!editable('source')}
              lockReason={lockReason('source')}
              lastModified={deal.lastModified}
            />
          </div>
        </Card>

        <Card>
          <SectionTitle>Timers</SectionTitle>
          <ul className="space-y-2">
            <TimerRow
              label="Soft check-in"
              detail="decision date + 2 days"
              armed={Boolean(deal.decisionDate)}
            />
            <TimerRow
              label="Forcing email"
              detail="decision date + 7 days"
              armed={Boolean(deal.decisionDate)}
            />
            <TimerRow label="Stale hold alert" detail="hold older than 21 days" armed={Boolean(deal.holdDate)} />
          </ul>
        </Card>
      </div>

      <Card>
        <SectionTitle>Linked drafts</SectionTitle>
        {drafts.length === 0 ? (
          <EmptyState
            title="No sales drafts yet"
            filledBy="The drafts engine (F7) writes the proposal and the follow-ups; they appear here and in the Review Queue."
          />
        ) : (
          <ul className="space-y-2">
            {drafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-2">
                <Link href={`/queue?draft=${d.id}`} className="rowname">
                  {d.subject || d.type}
                </Link>
                <span className="sub">
                  {d.type} · {d.status} · {relativeTime(d.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function TimerRow({ label, detail, armed }: { label: string; detail: string; armed: boolean }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <Led label={label} token={armed ? 'accent' : 'text-muted'} on={armed} hollow={!armed} />
      <span className="sub">{armed ? detail : 'not armed'}</span>
    </li>
  )
}

// ── Logistics ───────────────────────────────────────────────────────────────

function LogisticsTab({
  deal,
  endpoint,
  editable,
  lockReason,
  tasks,
}: {
  deal: Deal
  endpoint: string
  editable: (f: keyof Deal) => boolean
  lockReason: (f: keyof Deal) => string | undefined
  tasks: Task[]
}) {
  const days = deal.eventDate
    ? Math.round((new Date(deal.eventDate).getTime() - Date.now()) / 86_400_000)
    : null
  const redAlert = days !== null && days <= 12 && days >= 0 && !deal.logisticsComplete
  // The handoff card appears on the day and stays. Showing it a month out is clutter;
  // hiding it once the deal moves on is how notes go unwritten.
  const onsite = deal.stage === 'delivered' || deal.stage === 'debriefed' || (days !== null && days <= 0)

  return (
    <div className="space-y-4">
      {redAlert ? (
        <Card className="border-danger">
          <div className="micro mb-1 text-danger">Red alert · T-{days}</div>
          <p className="body-copy">
            Logistics are still incomplete inside twelve days. The timer worker has notified ops.
          </p>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Travel & venue</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <EditableField
            endpoint={endpoint}
            field="hotel"
            label="Hotel"
            value={deal.hotel}
            readOnly={!editable('hotel')}
            lockReason={lockReason('hotel')}
            lastModified={deal.lastModified}
          />
          <EditableField
            endpoint={endpoint}
            field="travelNotes"
            label="Travel notes"
            value={deal.travelNotes}
            kind="textarea"
            readOnly={!editable('travelNotes')}
            lockReason={lockReason('travelNotes')}
            lastModified={deal.lastModified}
          />
          <EditableField
            endpoint={endpoint}
            field="avCheckTime"
            label="AV check"
            value={deal.avCheckTime}
            readOnly={!editable('avCheckTime')}
            lockReason={lockReason('avCheckTime')}
            lastModified={deal.lastModified}
          />
          <EditableField
            endpoint={endpoint}
            field="travelDepartureDate"
            label="Travel departs"
            value={deal.travelDepartureDate}
            kind="date"
            placeholder="Day before the event"
            readOnly={!editable('travelDepartureDate')}
            lockReason={lockReason('travelDepartureDate')}
            lastModified={deal.lastModified}
          />
          <EditableField
            endpoint={endpoint}
            field="outboundFlight"
            label="Outbound flight"
            value={deal.outboundFlight}
            readOnly={!editable('outboundFlight')}
            lockReason={lockReason('outboundFlight')}
            lastModified={deal.lastModified}
          />
          <EditableField
            endpoint={endpoint}
            field="returnFlight"
            label="Return flight"
            value={deal.returnFlight}
            readOnly={!editable('returnFlight')}
            lockReason={lockReason('returnFlight')}
            lastModified={deal.lastModified}
          />
          <EditableField
            endpoint={endpoint}
            field="logisticsComplete"
            label="Logistics complete"
            value={deal.logisticsComplete}
            kind="checkbox"
            readOnly={!editable('logisticsComplete')}
            lockReason={lockReason('logisticsComplete')}
            lastModified={deal.lastModified}
          />
        </div>
        <p className="sub mt-3">
          The road-warrior brief goes out the day before travel, falling back to the day
          before the event. Editing the hotel, flights or AV check after it has gone re-sends
          it marked UPDATED.
        </p>
      </Card>

      {onsite ? (
        <Card>
          <SectionTitle>After the keynote</SectionTitle>
          <p className="body-copy mb-3 text-ink-secondary">
            One tick is the whole handoff. It puts what happened in the room in front of the
            office while it is still fresh; notes typed afterwards send a short update.
          </p>
          <EditableField
            endpoint={endpoint}
            field="postKeynoteAlert"
            label="Send post-keynote alert"
            value={deal.postKeynoteAlert}
            kind="checkbox"
            readOnly={!editable('postKeynoteAlert')}
            lockReason={lockReason('postKeynoteAlert')}
            lastModified={deal.lastModified}
          />
          <div className="mt-4">
            <EditableField
              endpoint={endpoint}
              field="postKeynoteNotes"
              label="Post-keynote notes"
              value={deal.postKeynoteNotes}
              kind="textarea"
              placeholder="What happened in the room"
              readOnly={!editable('postKeynoteNotes')}
              lockReason={lockReason('postKeynoteNotes')}
              lastModified={deal.lastModified}
            />
          </div>
        </Card>
      ) : null}

      <Card>
        <SectionTitle>Pending details</SectionTitle>
        <TaskList tasks={tasks.filter((t) => !t.done && t.stage === 'pre-event')} canEdit />
      </Card>
    </div>
  )
}

// ── Questionnaire ───────────────────────────────────────────────────────────

function QuestionnaireTab({
  deal,
  endpoint,
  editable,
  lockReason,
}: {
  deal: Deal
  endpoint: string
  editable: (f: keyof Deal) => boolean
  lockReason: (f: keyof Deal) => string | undefined
}) {
  if (!deal.questionnaireReceived) {
    return (
      <EmptyState
        title="Questionnaire not returned yet"
        filledBy="The welcome kit (F7) sends the form at Closed-Won; the T-14 chase timer nudges if it has not come back. Answers land here."
        action={
          <Pill variant="outline" href={`/deals/${deal.id}?tab=overview`}>
            Back to overview
          </Pill>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <EditableField
          endpoint={endpoint}
          field="audienceProfile"
          label="Audience profile"
          value={deal.audienceProfile}
          kind="textarea"
          readOnly={!editable('audienceProfile')}
          lockReason={lockReason('audienceProfile')}
          lastModified={deal.lastModified}
        />
      </Card>
      <Card>
        <EditableField
          endpoint={endpoint}
          field="desiredOutcomes"
          label="Desired outcomes"
          value={deal.desiredOutcomes}
          kind="textarea"
          readOnly={!editable('desiredOutcomes')}
          lockReason={lockReason('desiredOutcomes')}
          lastModified={deal.lastModified}
        />
      </Card>
    </div>
  )
}

// ── Assets ──────────────────────────────────────────────────────────────────

function AssetsTab({
  deal,
  endpoint,
  editable,
}: {
  deal: Deal
  endpoint: string
  editable: (f: keyof Deal) => boolean
}) {
  const folders = ['Received', 'Sent', 'Decks', 'Emails']
  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle>Drive folder</SectionTitle>
        <EditableField
          endpoint={endpoint}
          field="driveFolderUrl"
          label="Folder URL"
          value={deal.driveFolderUrl}
          readOnly={!editable('driveFolderUrl')}
          placeholder="Created by the mirror worker at Sales entry"
          lastModified={deal.lastModified}
        />
        {deal.driveFolderUrl ? (
          <div className="mt-4">
            <Pill variant="outline" href={deal.driveFolderUrl}>
              Open in Drive
            </Pill>
          </div>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>Structure</SectionTitle>
        <p className="body-copy mb-3 text-ink-secondary">
          Files live in Drive; records point at them. Airtable never holds the real asset.
        </p>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {folders.map((f) => (
            <Well key={f} className="px-3 py-4 text-center">
              <div className="micro">{f}</div>
            </Well>
          ))}
        </div>
      </Card>
    </div>
  )
}

// ── Journal ─────────────────────────────────────────────────────────────────

function JournalTab({
  orders,
  fulfillment,
  purchaseHistory,
  lineItems,
  products,
  dealId,
  showAmounts,
  canEdit,
}: {
  orders: JournalOrder[]
  fulfillment: Fulfillment[]
  /** Every past order by this company, so nobody walks into a call not knowing. */
  purchaseHistory: { dealName: string; quantity: number; year: string | null }[]
  lineItems: DealLineItem[]
  products: Product[]
  dealId: string
  showAmounts: boolean
  canEdit: boolean
}) {
  const lifetime = purchaseHistory.reduce((n, p) => n + p.quantity, 0)

  const history =
    purchaseHistory.length > 0 ? (
      <Card>
        <SectionTitle right={<span className="sub num">{lifetime.toLocaleString()} lifetime</span>}>
          Past purchases
        </SectionTitle>
        <div className="flex flex-wrap gap-2">
          {purchaseHistory.slice(0, 8).map((p, i) => (
            <span key={i} className="pill pill-ghost">
              {p.year ? `${p.year} · ` : ''}
              {p.quantity.toLocaleString()} · {p.dealName}
            </span>
          ))}
        </div>
      </Card>
    ) : null

  // WP1.4 — where each physical line item has got to, and what is going wrong with it.
  const strip =
    fulfillment.length > 0 ? (
      <Card>
        <SectionTitle>Fulfillment</SectionTitle>
        <ul className="space-y-3">
          {fulfillment.map((f) => {
            const nudges = nudgesFor(f, new Date().toISOString().slice(0, 10))
            const red = nudges.filter((n) => n.severity === 'red')
            return (
              <li key={f.id} className="border-b pb-3 last:border-b-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="rowname">{f.status}</span>
                  <span className="sub num">
                    {f.quantity ? `${f.quantity.toLocaleString()} units` : 'no quantity'}
                    {f.shipBy ? ` · ship by ${dayMonth(f.shipBy)}` : ''}
                  </span>
                </div>
                {nudges.length > 0 ? (
                  <p className={`body-copy mt-1 ${red.length ? 'text-danger' : 'text-warning'}`}>
                    {nudges.map((n) => n.message).join(' · ')}
                  </p>
                ) : null}
                {f.tracking ? <div className="sub mt-1">{f.carrier} {f.tracking}</div> : null}
              </li>
            )
          })}
        </ul>
      </Card>
    ) : null

  const lines = (
    <LineItems
      dealId={dealId}
      items={lineItems}
      products={products}
      showAmounts={showAmounts}
      canEdit={canEdit}
    />
  )

  if (orders.length === 0 && !strip && !history && lineItems.length === 0 && !canEdit) {
    return (
      <EmptyState
        title="No journal orders on this deal"
        filledBy="Orders appear once the journal is mentioned; the T-35 nudge chases a promo that never turned into an order. Orders can also exist without a deal."
        action={
          <Pill variant="outline" href="/journal">
            All orders
          </Pill>
        }
      />
    )
  }
  return (
    <div className="space-y-4">
    {lines}
    {history}
    {strip}
    <Card>
      <SectionTitle>Journal sidecar</SectionTitle>
      <ul className="space-y-3">
        {orders.map((o) => (
          <li key={o.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-3 last:border-b-0">
            <div>
              <div className="rowname">{o.reference}</div>
              <div className="sub mt-1">
                {o.quantity ? `${o.quantity} copies · ` : ''}ship by {dayMonth(o.shipByDate)}
                {o.inserts ? ' · inserts' : ''}
              </div>
            </div>
            <Led label={o.status} token="accent" on />
          </li>
        ))}
      </ul>
    </Card>
    </div>
  )
}

// ── Money ───────────────────────────────────────────────────────────────────

function MoneyTab({
  deal,
  showAmounts,
  payments,
  legs,
}: {
  deal: Deal
  showAmounts: boolean
  payments: { id: string; invoiceNumber: string | null; amount: number; status: string; receivedDate: string | null }[]
  legs: { id: string; label: string; amount: number; dueDate: string | null; paid: boolean }[]
}) {
  const received = payments.filter((p) => p.status === 'confirmed').reduce((s, p) => s + p.amount, 0)
  const owed = Math.max(dealValue(deal) - received, 0)

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle>Status</SectionTitle>
        <div className="flex flex-wrap gap-4">
          <PaymentLed status={deal.paymentStatus} />
          <ContractLed status={deal.contractStatus} />
        </div>
        <p className="body-copy mt-3 text-ink-secondary">
          Both are lookups from the money tables — read-only here, live by definition, no sync
          worker to break.
        </p>
      </Card>

      {showAmounts ? (
        <>
          <Card>
            <SectionTitle>Schedule</SectionTitle>
            {legs.length === 0 ? (
              <p className="body-copy text-ink-secondary">No payment schedule set.</p>
            ) : (
              <ul>
                {legs.map((leg) => (
                  <li key={leg.id} className="flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0">
                    <span className="rowname">{leg.label}</span>
                    <span className="sub">due {dayMonth(leg.dueDate)}</span>
                    <span className="num">{money(leg.amount)}</span>
                    <Led
                      label={leg.paid ? 'paid' : 'open'}
                      token={leg.paid ? 'chip-paid' : 'chip-pending'}
                      on
                    />
                  </li>
                ))}
                <li className="sum-rule mt-2 flex items-baseline justify-between gap-3 pt-2">
                  <span className="micro">Owed</span>
                  <span className="num text-accent">{money(owed)}</span>
                </li>
              </ul>
            )}
          </Card>

          <Card>
            <SectionTitle>Payments</SectionTitle>
            {payments.length === 0 ? (
              <p className="body-copy text-ink-secondary">Nothing received yet.</p>
            ) : (
              <ul>
                {payments.map((p) => (
                  <li key={p.id} className="flex items-baseline justify-between gap-3 border-b py-2 last:border-b-0">
                    <span className="rowname">{p.invoiceNumber ?? 'No invoice ref'}</span>
                    <span className="sub">{shortDate(p.receivedDate)}</span>
                    <span className="num">{money(p.amount)}</span>
                    <Led
                      label={p.status}
                      token={p.status === 'confirmed' ? 'chip-paid' : 'chip-pending'}
                      on
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : (
        <Card>
          <p className="body-copy text-ink-secondary">
            Amounts are hidden for your role — the chips above are the status. An admin can turn
            amounts on in Settings.
          </p>
        </Card>
      )}
    </div>
  )
}

// ── Activity ────────────────────────────────────────────────────────────────

function ActivityTab({
  audit,
  emails,
  drafts,
}: {
  audit: { id: string; field: string; oldValue: string | null; newValue: string | null; actor: string; actorKind: string; at: string }[]
  emails: { id: string; subject: string; from: string; receivedAt: string; classification: string }[]
  drafts: { id: string; subject: string; type: string; status: string; sentAt: string | null; createdAt: string }[]
}) {
  type Item = { id: string; at: string; kind: 'audit' | 'email' | 'draft'; title: string; detail: string }

  const items: Item[] = [
    ...audit.map<Item>((a) => ({
      id: `a-${a.id}`,
      at: a.at,
      kind: 'audit',
      title: a.field,
      detail: `${a.oldValue ?? '∅'} → ${a.newValue ?? '∅'} · ${a.actor}`,
    })),
    ...emails.map<Item>((e) => ({
      id: `e-${e.id}`,
      at: e.receivedAt,
      kind: 'email',
      title: e.subject,
      detail: `from ${e.from} · ${e.classification}`,
    })),
    ...drafts.map<Item>((d) => ({
      id: `d-${d.id}`,
      at: d.sentAt ?? d.createdAt,
      kind: 'draft',
      title: d.subject || `${d.type} draft`,
      detail: `${d.type} · ${d.status}`,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing has happened yet"
        filledBy="Every automated write, every ingested email and every draft lands here, newest first — the deal's whole story."
      />
    )
  }

  return (
    <Card>
      <SectionTitle>Activity</SectionTitle>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="flex gap-3 border-b py-3 last:border-b-0">
            <span className="sub w-[70px] flex-none">{item.kind}</span>
            <div className="min-w-0 flex-1">
              <div className="rowname truncate">{item.title}</div>
              <div className="body-copy text-ink-secondary">{item.detail}</div>
            </div>
            <span className="sub flex-none">{relativeTime(item.at)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}
