import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { SectionTitle } from '@/components/ui'
import { CrmList, type CrmView } from '@/components/CrmList'

export const dynamic = 'force-dynamic'

/**
 * One Contacts table, three views.
 *
 * Bureau agents and direct buyers read like Connor's two tabs but dedupe like one CRM:
 * Jenna George is a single record linked to every deal she has ever brokered.
 *
 * The first page is server-rendered and everything after it goes through `/api/crm`,
 * which filters in Airtable. This page used to read all three tables on every visit —
 * thirty requests, on a plan billed per request, to show a list nobody reads to the end.
 */
export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const { view: rawView } = await searchParams
  const view: CrmView = (['direct', 'clients'] as string[]).includes(rawView ?? '')
    ? (rawView as CrmView)
    : 'bureau'

  await requireUser()
  const provider = db()

  const page =
    view === 'clients'
      ? await provider.listClientsPage({ pageSize: 40 })
      : await provider.listContactsPage({
          pageSize: 40,
          bureauOnly: view === 'bureau',
          directOnly: view === 'direct',
        })

  const tabs: { key: CrmView; label: string }[] = [
    { key: 'bureau', label: 'Bureau agents' },
    { key: 'direct', label: 'Direct buyers' },
    { key: 'clients', label: 'Companies' },
  ]

  return (
    <div>
      <SectionTitle>CRM</SectionTitle>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/crm?view=${t.key}`}
            className={`pill ${view === t.key ? 'pill-accent' : 'pill-ghost'}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <CrmList
        key={view}
        view={view}
        initialClients={'clients' in page ? page.clients : []}
        initialContacts={'contacts' in page ? page.contacts : []}
        initialCursor={page.cursor}
      />
    </div>
  )
}
