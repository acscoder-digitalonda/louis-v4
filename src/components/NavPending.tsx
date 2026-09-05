'use client'

import { useLinkStatus } from 'next/link'

/**
 * A spinner on the nav item you just clicked.
 *
 * `loading.tsx` fills the page area, but the tab you pressed still looks untouched while
 * the server works — so the press reads as ignored and people press again, which queues
 * more requests behind the one they are already waiting for. This puts the feedback on
 * the control itself.
 *
 * Must be rendered *inside* the `<Link>` it reports on: `useLinkStatus` reads the
 * pending state of the nearest enclosing link.
 */
export function NavPending() {
  const { pending } = useLinkStatus()
  if (!pending) return null
  return (
    <span
      className="ml-1 inline-block h-3 w-3 animate-spin rounded-full border border-current border-t-transparent align-[-1px]"
      role="status"
      aria-label="Loading"
    />
  )
}
