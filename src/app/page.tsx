import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Home routes to the user's landing page — Liezel lands on the Review Queue,
 * everyone else on the Pipeline (Handoff §3.1, a per-user setting).
 */
export default async function Home() {
  const user = await currentUser()
  redirect(user?.landingPage ?? '/pipeline')
}
