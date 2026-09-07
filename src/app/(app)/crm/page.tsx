import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { Card, EmptyState, Led, SectionTitle } from '@/components/ui'
import { titleCase } from '@/lib/format'

export const dynamic = 'force-dynamic'

type View = 'bureau' | 'direct' | 'clients' | 'bureaus'

/** Enough rows to work with, few enough to render. 660 companies at once is a wall. */
const PAGE_SIZE = 60

/**
 * One Contacts table, two views. Bureau agents and direct buyers read like Connor's two
 * tabs but dedupe like one CRM: Jenna George is a single record linked to every deal
 * she has ever brokered.
 */
export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; client?: string; contact?: string; q?: string }>
}) {
  const {
    view: rawView,
    client: clientFocus,
    contact: contactFocus,
    q: rawQuery,
  } = await searchParams
  const view: View = (['direct', 'clients', 'bureaus'] as string[]).includes(rawView ?? '')
    ? (rawView as View)
    : 'bureau'
  const q = (rawQuery ?? '').trim().toLowerCase()

  await requireUser()
  const provider = db()
  const [contacts, clients, deals] = await Promise.all([
    provider.listContacts(),
    provider.listClients(),
    provider.listDeals(),
  ])

  const dealName = (id: string) => deals.find((d) => d.id === id)?.name ?? id
  const bureau = contacts.filter((c) => c.type === 'bureau-agent')
  const direct = contacts.filter((c) => c.type !== 'bureau-agent')

  const matchesPerson = (c: (typeof contacts)[number]) =>
    !q || `${c.name} ${c.email ?? ''} ${c.agency ?? ''} ${c.title ?? ''}`.toLowerCase().includes(q)
  const matchesClient = (c: (typeof clients)[number]) =>
    !q || `${c.name} ${c.domain ?? ''} ${c.industry ?? ''}`.toLowerCase().includes(q)

  // WP2.4 — bureaus as companies, grouped from the agency names on their agents. Those
  // names were 53 lowercase match keys until they were repaired; this is the first screen
  // that shows them as the 48 companies they actually are.
  const bureauCompanies = new Map<string, { agents: typeof contacts; dealIds: Set<string> }>()
  for (const c of bureau) {
    if (!c.agency) continue
    const entry = bureauCompanies.get(c.agency) ?? { agents: [], dealIds: new Set<string>() }
    entry.agents.push(c)
    for (const id of c.dealIds) entry.dealIds.add(id)
    bureauCompanies.set(c.agency, entry)
  }
  const bureauRows = [...bureauCompanies.entries()]
    .filter(([name]) => !q || name.toLowerCase().includes(q))
    .sort((a, b) => b[1].dealIds.size - a[1].dealIds.size || a[0].localeCompare(b[0]))

  // A company that booked twice is a materially different conversation from one that
  // booked once, and 29% of bookings come from repeat clients.
  const repeatCount = clients.filter((c) => c.dealIds.length > 1).length

  return (
    <div>
      <SectionTitle
        right={
          <span className="sub num">
            {repeatCount} repeat client{repeatCount === 1 ? '' : 's'}
          </span>
        }
      >
        CRM
      </SectionTitle>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/crm?view=bureau" className={`pill ${view === 'bureau' ? 'pill-accent' : 'pill-ghost'}`}>
          Bureau agents <span className={view === 'bureau' ? '' : 'pill-count'}>{bureau.length}</span>
        </Link>
        <Link href="/crm?view=direct" className={`pill ${view === 'direct' ? 'pill-accent' : 'pill-ghost'}`}>
          Direct buyers <span className={view === 'direct' ? '' : 'pill-count'}>{direct.length}</span>
        </Link>
        <Link href="/crm?view=clients" className={`pill ${view === 'clients' ? 'pill-accent' : 'pill-ghost'}`}>
          Companies <span className={view === 'clients' ? '' : 'pill-count'}>{clients.length}</span>
        </Link>
        <Link href="/crm?view=bureaus" className={`pill ${view === 'bureaus' ? 'pill-accent' : 'pill-ghost'}`}>
          Bureaus <span className={view === 'bureaus' ? '' : 'pill-count'}>{bureauCompanies.size}</span>
        </Link>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input type="hidden" name="view" value={view} />
        <input
          name="q"
          defaultValue={rawQuery ?? ''}
          placeholder="Search by name, company, email…"
          className="field-input flex-1 min-w-[220px]"
        />
        <button type="submit" className="pill pill-outline">Search</button>
        {q ? (
          <Link href={`/crm?view=${view}`} className="pill pill-ghost">clear</Link>
        ) : null}
      </form>

      {view === 'bureaus' ? (
        bureauRows.length === 0 ? (
          <EmptyState
            title={q ? 'No bureau matches that' : 'No bureaus yet'}
            filledBy="Bureaus are derived from the agency on each bureau agent, normalised by the history import."
          />
        ) : (
          <Card className="p-0">
            <ul>
              {bureauRows.slice(0, PAGE_SIZE).map(([name, entry]) => (
                <li key={name} className="border-b px-4 py-3 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="rowname">{name}</span>
                    <span className="sub num">
                      {entry.dealIds.size} booking{entry.dealIds.size === 1 ? '' : 's'} ·{' '}
                      {entry.agents.length} agent{entry.agents.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {entry.agents.slice(0, 8).map((a) => (
                      <Link key={a.id} href={`/crm?view=bureau&contact=${a.id}`} className="pill pill-ghost">
                        {a.name}
                      </Link>
                    ))}
                    {entry.agents.length > 8 ? (
                      <span className="sub">and {entry.agents.length - 8} more</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            <Truncated shown={Math.min(bureauRows.length, PAGE_SIZE)} total={bureauRows.length} />
          </Card>
        )
      ) : view === 'clients' ? (
        clients.filter(matchesClient).length === 0 ? (
          <EmptyState
            title="No companies yet"
            filledBy="Companies are created by form and email intake, or imported (F11). Company Domain is the dedupe key for every export."
          />
        ) : (
          <Card className="p-0">
            <ul>
              {clients.filter(matchesClient).slice(0, PAGE_SIZE).map((c) => (
                <li
                  key={c.id}
                  className={`border-b px-4 py-3 last:border-b-0 ${
                    clientFocus === c.id ? 'bg-sunken' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="rowname">
                      {c.name}
                      {c.dealIds.length > 1 ? (
                        <span className="pill pill-ghost ml-2">
                          {c.dealIds.length}× repeat
                        </span>
                      ) : null}
                    </span>
                    {c.domain ? (
                      <span className="sub">{c.domain}</span>
                    ) : (
                      <Led label="no domain" token="warning" on />
                    )}
                  </div>
                  <div className="sub mt-1">
                    {[c.industry, c.hq].filter(Boolean).join(' · ') || 'No profile yet'}
                  </div>
                  {c.dealIds.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {c.dealIds.slice(0, 6).map((id) => (
                        <Link key={id} href={`/deals/${id}`} className="pill pill-ghost">
                          {dealName(id)}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <Truncated
              shown={Math.min(clients.filter(matchesClient).length, PAGE_SIZE)}
              total={clients.filter(matchesClient).length}
            />
          </Card>
        )
      ) : (
        <PersonList
          people={(view === 'bureau' ? bureau : direct).filter(matchesPerson).slice(0, PAGE_SIZE)}
          total={(view === 'bureau' ? bureau : direct).filter(matchesPerson).length}
          dealName={dealName}
          focus={contactFocus}
          emptyTitle={view === 'bureau' ? 'No bureau agents yet' : 'No direct buyers yet'}
        />
      )}
    </div>
  )
}

/** A cut list has to say it was cut, or it reads as "that is everyone". */
function Truncated({ shown, total }: { shown: number; total: number }) {
  if (shown >= total) return null
  return (
    <div className="border-t px-4 py-3">
      <span className="sub">
        Showing {shown} of {total}. Narrow it with the search box.
      </span>
    </div>
  )
}

function PersonList({
  people,
  total,
  dealName,
  focus,
  emptyTitle,
}: {
  people: {
    id: string
    name: string
    email: string | null
    phone: string | null
    type: string
    title: string | null
    agency: string | null
    keyAgent: boolean
    dealIds: string[]
    notes: string | null
  }[]
  total: number
  dealName: (id: string) => string
  focus?: string
  emptyTitle: string
}) {
  if (people.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        filledBy="People are created by email intake as they appear on threads. Mark someone a Key Agent and their mail forwards to Ben instantly."
      />
    )
  }

  return (
    <Card className="p-0">
      <ul>
        {people.map((p) => (
          <li key={p.id} className={`border-b px-4 py-3 last:border-b-0 ${focus === p.id ? 'bg-sunken' : ''}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="rowname">{p.name}</span>
              <span className="sub">{titleCase(p.type)}</span>
            </div>
            <div className="sub mt-1">
              {[p.title, p.agency, p.email, p.phone].filter(Boolean).join(' · ')}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {p.keyAgent ? <Led label="key agent" token="accent" on /> : null}
              {p.dealIds.map((id) => (
                <Link key={id} href={`/deals/${id}`} className="pill pill-ghost">
                  {dealName(id)}
                </Link>
              ))}
            </div>
            {p.notes ? <p className="body-copy mt-2 text-ink-secondary">{p.notes}</p> : null}
          </li>
        ))}
      </ul>
      <Truncated shown={people.length} total={total} />
    </Card>
  )
}
