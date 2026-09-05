import { redirect } from 'next/navigation'
import { authModeSafe, currentUser } from '@/lib/auth'
import { db } from '@/lib/data'
import { TopBar } from '@/components/TopBar'
import { BottomTabs } from '@/components/BottomTabs'

export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  if (!user) redirect('/signin')

  // The queue badge is the one number that belongs in the chrome — it is the whole
  // reason ops opens the app.
  const provider = db()
  const [drafts, proposals] = await Promise.all([
    provider.listDrafts({ status: 'proposed' }),
    provider.listProposals('proposed'),
  ])
  const queueCount = drafts.length + proposals.length

  return (
    <div className="min-h-dvh pb-24 md:pb-10">
      <TopBar
        role={user.role}
        queueCount={queueCount}
        email={user.email}
        canSignOut={authModeSafe() === 'google'}
      />
      <main className="mx-auto max-w-shell px-[var(--shell-pad)] py-5">{children}</main>
      <BottomTabs
        role={user.role}
        queueCount={queueCount}
        email={user.email}
        canSignOut={authModeSafe() === 'google'}
      />
    </div>
  )
}
