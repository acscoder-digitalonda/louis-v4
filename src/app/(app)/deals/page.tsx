import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canSeeMoneyAmounts, canWrite } from '@/lib/rbac'
import { SectionTitle } from '@/components/ui'
import { NewDealButton } from '@/components/NewDealButton'
import { DealList } from '@/components/DealList'
import { ALL_STAGES } from '@/lib/stages'
import type { StageKey } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * The deals list.
 *
 * The first page is rendered on the server so the screen is useful before any JavaScript
 * runs; everything after that — search, stage, "load more" — goes through `/api/deals`,
 * which filters in Airtable rather than in the browser.
 *
 * That distinction is the whole point. The previous version read every deal on every
 * visit: nine Airtable requests to render a list nobody scrolls past the top of, on a
 * plan billed per request. This costs one.
 */
export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; historical?: string }>
}) {
  const { stage: rawStage, historical } = await searchParams
  const user = await requireUser()
  const provider = db()

  const stage = ALL_STAGES.includes(rawStage as StageKey) ? (rawStage as StageKey) : undefined
  const includeHistorical = historical === '1'

  const page = await provider.listDealsPage({ stage, includeHistorical, pageSize: 40 })

  // No count of the hidden history, deliberately. Airtable has no count endpoint, so the
  // only way to get one is to page through every record — nine requests to print a number
  // beside a checkbox, which is exactly the cost this page was rewritten to avoid. The
  // empty state says what is hidden in words instead.

  return (
    <div>
      <SectionTitle right={canWrite(user.role, 'deals').allowed ? <NewDealButton /> : undefined}>
        Deals
      </SectionTitle>

      <DealList
        initial={page.deals}
        initialCursor={page.cursor}
        showAmounts={canSeeMoneyAmounts(user)}
      />
    </div>
  )
}
