'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Micro } from '@/components/ui'
import { titleCase } from '@/lib/format'
import type { Client, Contact } from '@/lib/types'

export type CrmView = 'bureau' | 'direct' | 'clients'

/**
 * The CRM list: search and "load more", filtered in Airtable.
 *
 * This page was the most expensive screen in the product — thirty Airtable requests to
 * render 660 companies, 1,348 contacts and 802 deals, all at once, on a plan billed per
 * request. A search box was added first and it helped nobody: the filtering happened in
 * the browser, so the thirty requests were still spent before anyone typed.
 *
 * Now each view is one page of one table, and the search goes into the query.
 */
/**
 * The company's own favicon, or its initials.
 *
 * Served from the company's own domain rather than a logo service: a service that
 * resolves logos would also receive a list of every company Ben has ever spoken to. Most
 * of these will 404, which is why the initials are the resting state and the image only
 * replaces them once it has actually loaded.
 */
function CompanyMark({ name, domain }: { name: string; domain: string | null }) {
  const [loaded, setLoaded] = useState(false)
  const initials = name
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

  return (
    <span className="well inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded text-[9px] text-ink-secondary">
      {domain ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://${domain}/favicon.ico`}
          alt=""
          width={20}
          height={20}
          className={loaded ? 'h-5 w-5 object-contain' : 'hidden'}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
        />
      ) : null}
      {loaded ? null : initials || '·'}
    </span>
  )
}

export function CrmList({
  view,
  initialClients,
  initialContacts,
  initialCursor,
}: {
  view: CrmView
  initialClients: Client[]
  initialContacts: Contact[]
  initialCursor?: string
}) {
  const [clients, setClients] = useState(initialClients)
  const [contacts, setContacts] = useState(initialContacts)
  const [cursor, setCursor] = useState(initialCursor)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A slow early request must not overwrite a later, narrower one.
  const request = useRef(0)

  const load = useCallback(
    async (opts: { append?: boolean; cursor?: string } = {}) => {
      const mine = ++request.current
      setBusy(true)
      setError(null)
      try {
        const params = new URLSearchParams({ view })
        if (q.trim()) params.set('q', q.trim())
        if (opts.cursor) params.set('cursor', opts.cursor)

        const res = await fetch(`/api/crm?${params}`)
        const json = (await res.json()) as {
          clients?: Client[]
          contacts?: Contact[]
          cursor?: string
          error?: string
        }
        if (mine !== request.current) return
        if (!res.ok) {
          setError(json.error ?? 'Could not load.')
          return
        }
        if (view === 'clients') {
          setClients((prev) => (opts.append ? [...prev, ...(json.clients ?? [])] : json.clients ?? []))
        } else {
          setContacts((prev) =>
            opts.append ? [...prev, ...(json.contacts ?? [])] : json.contacts ?? [],
          )
        }
        setCursor(json.cursor)
      } finally {
        if (mine === request.current) setBusy(false)
      }
    },
    [q, view],
  )

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 350 : 0)
    return () => clearTimeout(t)
  }, [q, load])

  const rows = view === 'clients' ? clients : contacts
  const empty = rows.length === 0 && !busy

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          className="field-input min-w-[240px] flex-1"
          placeholder={
            view === 'clients' ? 'Search companies, domain, industry…' : 'Search name, email, bureau…'
          }
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {q ? (
          <button type="button" className="pill pill-ghost" onClick={() => setQ('')}>
            clear
          </button>
        ) : null}
      </div>

      {error ? <p className="body-copy mb-3 text-danger">{error}</p> : null}

      {empty ? (
        <div className="well px-4 py-10 text-center">
          <Micro>Nothing matches</Micro>
          <p className="body-copy mt-2">
            {q ? `No ${view === 'clients' ? 'company' : 'person'} matches “${q}”.` : 'Nothing here yet.'}
          </p>
        </div>
      ) : view === 'clients' ? (
        <ul className="card divide-y p-0">
          {clients.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="rowname flex items-baseline gap-2">
                  <CompanyMark name={c.name} domain={c.domain} />
                  {c.name}
                  {c.dealIds.length > 1 ? (
                    <span className="pill pill-ghost ml-2">{c.dealIds.length}× repeat</span>
                  ) : null}
                </span>
                <span className="sub">{c.domain ?? 'no domain'}</span>
              </div>
              <div className="sub mt-1">
                {[c.industry, c.hq].filter(Boolean).join(' · ') || 'No profile yet'}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="card divide-y p-0">
          {contacts.map((p) => (
            <li key={p.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="rowname">{p.name}</span>
                <span className="sub">{titleCase(p.type)}</span>
              </div>
              <div className="sub mt-1 truncate">
                {[p.title, p.agency, p.email, p.phone].filter(Boolean).join(' · ') || 'No details yet'}
              </div>
              {p.dealIds.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.dealIds.slice(0, 4).map((id) => (
                    <Link key={id} href={`/deals/${id}`} className="pill pill-ghost">
                      deal
                    </Link>
                  ))}
                  {p.dealIds.length > 4 ? (
                    <span className="sub">and {p.dealIds.length - 4} more</span>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4">
        {cursor ? (
          <button
            type="button"
            className="pill pill-outline"
            disabled={busy}
            onClick={() => void load({ append: true, cursor })}
          >
            {busy ? 'loading…' : 'Load more'}
          </button>
        ) : rows.length > 0 ? (
          <span className="sub">{rows.length} shown · that is all of them</span>
        ) : null}
      </div>
    </div>
  )
}
