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
import type { Deal, JournalOrder, Task } from '@/lib/types'

export const dynamic = 'force-dynamic'

const TABS = [
  'overview',
  'sales',
  'logistics',
  'questionnaire',
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
    provider.listJournalOrders(),
    provider.listPayments(),
    provider.listScheduleLegs(),
    provider.listContacts(),
    provider.listResearchBriefs(id),
  ])

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

      {/* ── tabs (state in the URL: shareable, back-button-safe) ──────── */}
      <nav className="scroll-x no-scrollbar -mx-[var(--shell-pad)] mb-5 flex gap-2 border-b px-[var(--shell-pad)] pb-3">
        {TABS.map((t) => (
          <Link
            key={t}
            href={`/deals/${deal.id}?tab=${t}`}
            className={`pill ${t === tab ? 'pill-accent' : 'pill-ghost'}`}
            aria-current={t === tab ? 'page' : undefined}
          >
            {t}
          </Link>
        ))}
      </nav>

      {tab === 'overview' ? (
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
      ) : null}

      {tab === 'sales' ? (
        <SalesTab
          deal={deal}
          endpoint={endpoint}
          editable={editable}
          lockReason={lockReason}
          showAmounts={showAmounts}
          drafts={drafts.filter((d) => ['proposal', 'follow-up', 'forcing'].includes(d.type))}
        />
      ) : null}

      {tab === 'logistics' ? (
        <LogisticsTab deal={deal} endpoint={endpoint} editable={editable} lockReason={lockReason} tasks={tasks} />
      ) : null}

      {tab === 'questionnaire' ? (
        <QuestionnaireTab deal={deal} endpoint={endpoint} editable={editable} lockReason={lockReason} />
      ) : null}

      {tab === 'assets' ? <AssetsTab deal={deal} endpoint={endpoint} editable={editable} /> : null}

      {tab === 'journal' ? <JournalTab orders={dealJournal} /> : null}

      {tab === 'money' ? (
        <MoneyTab
          deal={deal}
          showAmounts={showAmounts}
          payments={dealPayments}
          legs={dealLegs}
        />
      ) : null}

      {tab === 'activity' ? <ActivityTab audit={audit} emails={emails} drafts={drafts} /> : null}
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
}: {
  deal: Deal
  endpoint: string
  editable: (f: keyof Deal) => boolean
  lockReason: (f: keyof Deal) => string | undefined
  showAmounts: boolean
  drafts: { id: string; subject: string; type: string; status: string; createdAt: string }[]
}) {
  const weight = forecastWeight(deal)
  const belowFloor = (deal.negotiatedFee ?? Infinity) < speaker.fees.floor

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
            field="logisticsComplete"
            label="Logistics complete"
            value={deal.logisticsComplete}
            kind="checkbox"
            readOnly={!editable('logisticsComplete')}
            lockReason={lockReason('logisticsComplete')}
            lastModified={deal.lastModified}
          />
        </div>
      </Card>

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
      <Card>
        <EditableField
          endpoint={endpoint}
          field="postKeynoteNotes"
          label="Post-keynote notes"
          value={deal.postKeynoteNotes}
          kind="textarea"
          readOnly={!editable('postKeynoteNotes')}
          lockReason={lockReason('postKeynoteNotes')}
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

function JournalTab({ orders }: { orders: JournalOrder[] }) {
  if (orders.length === 0) {
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
