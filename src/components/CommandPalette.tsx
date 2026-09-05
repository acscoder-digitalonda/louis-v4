'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SearchDoc } from '@/lib/types'

const TYPE_LABEL: Record<SearchDoc['type'], string> = {
  deal: 'Deals',
  client: 'Clients',
  contact: 'Contacts',
  journal: 'Journal',
  draft: 'Drafts',
  action: 'Go to',
}

const ORDER: SearchDoc['type'][] = ['action', 'deal', 'client', 'contact', 'journal', 'draft']

/**
 * ⌘K — a palette, not just a finder: it searches records *and* commands.
 * Results come from the cached server-side index (see lib/search.ts).
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchDoc[]>([])
  const [cursor, setCursor] = useState(0)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Global shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(true)
      }
      if (e.key === 'Escape') onOpenChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onOpenChange])

  useEffect(() => {
    if (open) {
      setCursor(0)
      // Focus after paint so the input exists.
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setQuery('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`)
        const json = (await res.json()) as { results?: SearchDoc[] }
        if (!cancelled) {
          setResults(json.results ?? [])
          setCursor(0)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, open])

  if (!open) return null

  const grouped = ORDER.map((type) => ({
    type,
    items: results.filter((r) => r.type === type),
  })).filter((g) => g.items.length > 0)

  const flat = grouped.flatMap((g) => g.items)

  const go = (doc: SearchDoc | undefined) => {
    if (!doc) return
    onOpenChange(false)
    router.push(doc.href)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-overlay px-4 pt-[10vh]"
      onClick={() => onOpenChange(false)}
      role="presentation"
    >
      <div
        className="mx-auto w-full max-w-column overflow-hidden rounded-card border bg-raised"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, flat.length - 1))
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            }
            if (e.key === 'Enter') {
              e.preventDefault()
              go(flat[cursor])
            }
          }}
          placeholder="Search deals, people, orders — or type a command"
          className="w-full border-b bg-transparent px-4 py-4 text-[13px] outline-none placeholder:text-ink-muted"
          aria-label="Search query"
        />

        <div className="max-h-[52vh] overflow-y-auto">
          {loading && flat.length === 0 ? (
            <div className="p-4">
              <div className="skeleton h-8 w-full" />
            </div>
          ) : null}

          {!loading && flat.length === 0 ? (
            <div className="p-6 text-center">
              <div className="sub">No matches</div>
            </div>
          ) : null}

          {grouped.map((group) => (
            <div key={group.type} className="border-b last:border-b-0">
              <div className="micro px-4 pb-1 pt-3">{TYPE_LABEL[group.type]}</div>
              {group.items.map((item) => {
                const index = flat.indexOf(item)
                const active = index === cursor
                return (
                  <button
                    key={`${item.type}-${item.id}`}
                    type="button"
                    onMouseEnter={() => setCursor(index)}
                    onClick={() => go(item)}
                    className={`flex w-full items-baseline gap-3 px-4 py-2 text-left ${
                      active ? 'bg-sunken' : ''
                    }`}
                  >
                    <span className="rowname truncate">{item.title}</span>
                    {item.subtitle ? (
                      <span className="sub truncate">{item.subtitle}</span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t px-4 py-2">
          <span className="sub">↑↓ move · ⏎ open · esc close</span>
        </div>
      </div>
    </div>
  )
}
