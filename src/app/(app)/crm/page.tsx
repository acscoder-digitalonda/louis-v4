import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { Card, EmptyState, Led, SectionTitle } from '@/components/ui'
import { titleCase } from '@/lib/format'

export const dynamic = 'force-dynamic'

type View = 'bureau' | 'direct' | 'clients'

/**
 * One Contacts table, two views. Bureau agents and direct buyers read like Connor's two
 * tabs but dedupe like one CRM: Jenna George is a single record linked to every deal
 * she has ever brokered.
 */
export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; client?: string; contact?: string }>
}) {
  const { view: rawView, client: clientFocus, contact: contactFocus } = await searchParams
  const view: View = rawView === 'direct' || rawView === 'clients' ? rawView : 'bureau'

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

  return (
    <div>
      <SectionTitle>CRM</SectionTitle>

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
      </div>

      {view === 'clients' ? (
        clients.length === 0 ? (
          <EmptyState
            title="No companies yet"
            filledBy="Companies are created by form and email intake, or imported (F11). Company Domain is the dedupe key for every export."
          />
        ) : (
          <Card className="p-0">
            <ul>
              {clients.map((c) => (
                <li
                  key={c.id}
                  className={`border-b px-4 py-3 last:border-b-0 ${
                    clientFocus === c.id ? 'bg-sunken' : ''
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="rowname">{c.name}</span>
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
                      {c.dealIds.map((id) => (
                        <Link key={id} href={`/deals/${id}`} className="pill pill-ghost">
                          {dealName(id)}
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : (
        <PersonList
          people={view === 'bureau' ? bureau : direct}
          dealName={dealName}
          focus={contactFocus}
          emptyTitle={view === 'bureau' ? 'No bureau agents yet' : 'No direct buyers yet'}
        />
      )}
    </div>
  )
}

function PersonList({
  people,
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
    </Card>
  )
}
