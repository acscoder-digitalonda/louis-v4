import { Skeleton, SkeletonRows } from '@/components/ui'

/** The queue is a title and two lists, not stat tiles — so it gets its own shape. */
export default function Loading() {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the review queue</span>
      <Skeleton className="h-6 w-44" />
      <div className="flex gap-2">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-28" />
      </div>
      <SkeletonRows rows={8} />
    </div>
  )
}
