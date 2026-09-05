'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { useState } from 'react'
import type { Role } from '@/lib/types'
import { canViewScreen, type Screen } from '@/lib/rbac'
import { CommandPalette } from './CommandPalette'
import { NavPending } from './NavPending'
import { NotificationBell } from './NotificationBell'
import { ThemeToggle } from './ThemeToggle'
import { speaker } from '~/speaker.config'

const NAV: { href: string; label: string; screen: Screen }[] = [
  { href: '/pipeline', label: 'Pipeline', screen: 'pipeline' },
  { href: '/deals', label: 'Deals', screen: 'deals' },
  { href: '/crm', label: 'CRM', screen: 'crm' },
  { href: '/journal', label: 'Journal', screen: 'journal' },
  { href: '/money', label: 'Money', screen: 'money' },
  { href: '/queue', label: 'Queue', screen: 'queue' },
]

export function TopBar({
  role,
  queueCount,
  email,
  canSignOut,
}: {
  role: Role
  queueCount: number
  email: string
  /** Demo mode has no session to end, so the control would do nothing. */
  canSignOut: boolean
}) {
  const pathname = usePathname()
  const [paletteOpen, setPaletteOpen] = useState(false)
  const visible = NAV.filter((item) => canViewScreen(role, item.screen))

  return (
    <>
      <header className="bar sticky top-0 z-30 border-b">
        <div className="mx-auto flex h-[var(--bar-h)] max-w-shell items-center gap-2 px-[var(--shell-pad)]">
          {/* Logo → home, on every screen. Non-negotiable. */}
          <Link
            href="/pipeline"
            className="mr-2 flex-none text-[15px] font-bold tracking-[.3em] text-ink"
            aria-label={`${speaker.wordmark} home`}
          >
            {speaker.wordmark}
            <span className="text-accent">·</span>
          </Link>

          <nav className="hidden flex-1 items-center gap-1 md:flex">
            {visible.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`pill ${active ? 'pill-accent' : 'pill-ghost'}`}
                  aria-current={active ? 'page' : undefined}
                >
                  {item.label}
                  {item.href === '/queue' && queueCount > 0 ? (
                    <span className={active ? '' : 'pill-count'}>{queueCount}</span>
                  ) : null}
                  <NavPending />
                </Link>
              )
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              className="pill pill-ghost"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search (Command K)"
            >
              <span aria-hidden="true">⌕</span>
              <span className="hidden sm:inline">⌘K</span>
            </button>
            <NotificationBell />
            <ThemeToggle />
            {canViewScreen(role, 'settings') ? (
              <Link href="/settings" className="pill pill-ghost" aria-label="Settings">
                <span aria-hidden="true">⚙</span>
              </Link>
            ) : null}
            {canSignOut ? (
              <button
                type="button"
                className="pill pill-ghost"
                onClick={() => signOut({ callbackUrl: '/signin' })}
                // The address matters on a shared laptop: it is the only place in the app
                // that answers "who am I signed in as" before you click.
                title={`Sign out ${email}`}
                aria-label={`Sign out ${email}`}
              >
                <span aria-hidden="true">⏻</span>
                <span className="hidden lg:inline">Sign out</span>
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </>
  )
}
