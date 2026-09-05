'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Notification } from '@/lib/types'
import { relativeTime } from '@/lib/format'

const POLL_MS = 60_000

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (!res.ok) return
      const json = (await res.json()) as { notifications?: Notification[] }
      setItems(json.notifications ?? [])
    } catch {
      // A flaky poll must never break the shell.
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const unread = items.filter((n) => !n.read).length

  const markAllRead = async () => {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })))
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="pill pill-ghost"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      >
        <span aria-hidden="true">◉</span>
        {unread > 0 ? (
          <span
            className="absolute right-1 top-1 h-[6px] w-[6px] rounded-pill bg-badge"
            aria-hidden="true"
          />
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-[min(92vw,340px)] overflow-hidden rounded-card border bg-raised">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="micro">Notifications</span>
            {unread > 0 ? (
              <button type="button" className="sub" onClick={() => void markAllRead()}>
                Mark all read
              </button>
            ) : null}
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <div className="sub">Nothing yet</div>
                <p className="body-copy mt-2 text-ink-secondary">
                  Review items, red alerts and worker failures land here.
                </p>
              </div>
            ) : (
              items.map((n) => {
                const content = (
                  <>
                    <div className="flex items-baseline gap-2">
                      {!n.read ? (
                        <span className="mt-[5px] h-[6px] w-[6px] flex-none rounded-pill bg-badge" aria-hidden="true" />
                      ) : (
                        <span className="mt-[5px] h-[6px] w-[6px] flex-none" aria-hidden="true" />
                      )}
                      <span className="rowname">{n.title}</span>
                    </div>
                    {n.body ? (
                      <p className="body-copy mt-1 pl-[14px] text-ink-secondary">{n.body}</p>
                    ) : null}
                    <div className="sub mt-1 pl-[14px]">{relativeTime(n.createdAt)}</div>
                  </>
                )
                return n.link ? (
                  <Link
                    key={n.id}
                    href={n.link}
                    className="block border-b px-4 py-3 last:border-b-0 hover:bg-sunken"
                    onClick={() => setOpen(false)}
                  >
                    {content}
                  </Link>
                ) : (
                  <div key={n.id} className="border-b px-4 py-3 last:border-b-0">
                    {content}
                  </div>
                )
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
