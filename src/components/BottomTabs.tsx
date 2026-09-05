'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { NavPending } from './NavPending'
import { useState } from 'react'
import type { Role } from '@/lib/types'
import { canViewScreen } from '@/lib/rbac'

/**
 * Mobile primary nav (Handoff §3.1). Four thumb targets; everything else lives in the
 * "More" sheet. Hidden from ~768px up, where the top bar takes over.
 */
const PRIMARY = [
  { href: '/pipeline', label: 'Pipeline', glyph: '▤', screen: 'pipeline' as const },
  { href: '/deals', label: 'Deals', glyph: '◈', screen: 'deals' as const },
  { href: '/queue', label: 'Queue', glyph: '✓', screen: 'queue' as const },
]

const MORE = [
  { href: '/crm', label: 'CRM', screen: 'crm' as const },
  { href: '/journal', label: 'Journal', screen: 'journal' as const },
  { href: '/money', label: 'Money', screen: 'money' as const },
  { href: '/settings', label: 'Settings', screen: 'settings' as const },
]

export function BottomTabs({
  role,
  queueCount,
  email,
  canSignOut,
}: {
  role: Role
  queueCount: number
  email: string
  canSignOut: boolean
}) {
  const pathname = usePathname()
  const [sheetOpen, setSheetOpen] = useState(false)
  const tabs = PRIMARY.filter((t) => canViewScreen(role, t.screen))
  const more = MORE.filter((t) => canViewScreen(role, t.screen))

  return (
    <>
      {sheetOpen ? (
        <div
          className="fixed inset-0 z-40 bg-overlay md:hidden"
          onClick={() => setSheetOpen(false)}
          role="presentation"
        >
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-card border-t bg-raised p-4 pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="micro mb-3">More</div>
            <div className="grid grid-cols-2 gap-2">
              {more.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="pill pill-outline justify-center py-3"
                  onClick={() => setSheetOpen(false)}
                >
                  {item.label}
                </Link>
              ))}
            </div>
            {canSignOut ? (
              // The top bar's controls are desktop-only, so without this the phone has no
              // way out at all — and this app is meant to be used from a phone.
              <div className="mt-4 border-t pt-4">
                <div className="micro mb-2 text-ink-secondary">{email}</div>
                <button
                  type="button"
                  className="pill pill-ghost w-full justify-center py-3"
                  onClick={() => signOut({ callbackUrl: '/signin' })}
                >
                  Sign out
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <nav className="bar fixed inset-x-0 bottom-0 z-30 border-t pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid grid-cols-4">
          {tabs.map((tab) => {
            const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`)
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className="flex min-h-[56px] flex-col items-center justify-center gap-1"
                aria-current={active ? 'page' : undefined}
              >
                <span
                  className={`flex h-6 w-9 items-center justify-center rounded-pill text-[13px] ${
                    active ? 'bg-accent text-ink-inverse' : 'text-ink-secondary'
                  }`}
                  aria-hidden="true"
                >
                  {tab.glyph}
                </span>
                <span className="text-[8px] font-bold uppercase tracking-[.2em]">
                  {tab.label}
                  {tab.href === '/queue' && queueCount > 0 ? ` ${queueCount}` : ''}
                  <NavPending />
                </span>
              </Link>
            )
          })}
          <button
            type="button"
            className="flex min-h-[56px] flex-col items-center justify-center gap-1"
            onClick={() => setSheetOpen((v) => !v)}
          >
            <span className="flex h-6 w-9 items-center justify-center text-[13px] text-ink-secondary" aria-hidden="true">
              ⋯
            </span>
            <span className="text-[8px] font-bold uppercase tracking-[.2em]">More</span>
          </button>
        </div>
      </nav>
    </>
  )
}
