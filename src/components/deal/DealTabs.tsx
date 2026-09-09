'use client'

import { useState, type ReactNode } from 'react'

/**
 * The deal's tabs, switched on the client.
 *
 * The page already fetches every tab's data in one go, so a tab change has nothing to
 * ask the server for. Until now each tab was a `<Link href="?tab=…">`: a full server
 * round trip — fifteen Airtable requests — with the screen unchanged until the new HTML
 * arrived. Nothing showed a `loading.tsx` either, because a search-param change on the
 * same segment does not cross a loading boundary. The press read as ignored, and the
 * person pressed again.
 *
 * Every panel arrives pre-rendered; this only decides which one is visible. The URL is
 * kept in step with `replaceState`, so a refresh, a shared link and a `router.refresh()`
 * after an edit all land on the tab the person was looking at.
 */
export function DealTabs<T extends string>({
  dealId,
  tabs,
  initial,
  panels,
}: {
  dealId: string
  tabs: readonly T[]
  initial: T
  panels: Record<T, ReactNode>
}) {
  const [active, setActive] = useState<T>(initial)

  function show(tab: T) {
    setActive(tab)
    try {
      window.history.replaceState(window.history.state, '', `/deals/${dealId}?tab=${tab}`)
    } catch {
      // A URL that cannot be updated is not worth failing the click over.
    }
  }

  return (
    <>
      <nav
        className="scroll-x no-scrollbar -mx-[var(--shell-pad)] mb-5 flex gap-2 border-b px-[var(--shell-pad)] pb-3"
        role="tablist"
      >
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={t === active}
            aria-controls={`tab-${t}`}
            className={`pill ${t === active ? 'pill-accent' : 'pill-ghost'}`}
            onClick={() => show(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      <div id={`tab-${active}`} role="tabpanel">
        {panels[active]}
      </div>
    </>
  )
}
