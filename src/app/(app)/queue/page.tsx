import { requireUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { canApproveSends } from '@/lib/rbac'
import { ReviewQueue } from '@/components/ReviewQueue'
import { SeedReviewTable } from '@/components/SeedReviewTable'
import { SectionTitle } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>
}) {
  const { draft } = await searchParams
  const user = await requireUser()
  const provider = db()
  const [drafts, proposals, seedProposals, conflicts] = await Promise.all([
    provider.listDrafts({ status: 'proposed' }),
    provider.listProposals('proposed'),
    provider.listDealProposals('proposed'),
    provider.listDateConflicts(),
  ])

  // Deal names are only ever shown beside a draft or a field proposal. Loading every deal
  // to build that map cost ~2,800 records against Airtable's 5 requests/second — several
  // seconds of blank screen for a lookup that is usually not needed at all, because the
  // seeded-deal table below does not use it.
  const needNames = [
    ...drafts.map((d) => d.dealId),
    ...proposals.map((p) => p.dealId),
  ].filter((id): id is string => Boolean(id))

  const dealNames = Object.fromEntries(
    (await Promise.all([...new Set(needNames)].map((id) => provider.getDeal(id))))
      .filter((d): d is NonNullable<typeof d> => Boolean(d))
      .map((d) => [d.id, d.name]),
  )

  return (
    <div>
      <SectionTitle right={<span className="sub">{drafts.length + proposals.length} waiting</span>}>
        Review queue
      </SectionTitle>
      <ReviewQueue
        drafts={drafts}
        proposals={proposals}
        dealNames={dealNames}
        canApprove={canApproveSends(user.role)}
        focusDraftId={draft}
      />

      {seedProposals.length > 0 && (
        <>
          <SectionTitle right={<span className="sub">{seedProposals.length} proposed</span>}>
            Seeded deals
          </SectionTitle>
          <SeedReviewTable
            proposals={seedProposals}
            conflicts={conflicts}
            canApprove={canApproveSends(user.role)}
          />
        </>
      )}
    </div>
  )
}
