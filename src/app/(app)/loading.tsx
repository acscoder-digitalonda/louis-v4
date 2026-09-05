import { Skeleton, SkeletonRows } from '@/components/ui'

/**
 * Shown the instant a nav link is clicked, before the server has finished.
 *
 * These screens read from Airtable, which allows 5 requests a second, so a page holding
 * hundreds of records takes a beat. Without this the browser sits on the *old* page with
 * no feedback, which reads as a dead button — and people click again, queueing more work
 * behind the request they are already waiting on.
 *
 * One file at the group root covers every screen under it; a segment with a different
 * shape can add its own.
 */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-6 w-40" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <SkeletonRows rows={6} />
    </div>
  )
}
