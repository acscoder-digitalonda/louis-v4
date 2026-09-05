import { redirect } from 'next/navigation'
import { authMode, currentUser } from '@/lib/auth'
import type { User } from '@/lib/types'
import { SignInButton } from './SignInButton'
import { speaker } from '~/speaker.config'

export const dynamic = 'force-dynamic'

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  // In production a missing SSO config throws — correct everywhere except here, where a
  // misconfigured deploy should say what is missing rather than serve a stack trace.
  let mode: 'google' | 'demo' | 'unconfigured'
  let user: User | null = null
  try {
    mode = authMode()
    user = await currentUser()
  } catch {
    mode = 'unconfigured'
  }
  // Outside the try: redirect() signals by throwing, and swallowing that would break it.
  if (user) redirect(user.landingPage ?? '/pipeline')

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="card w-full max-w-[380px] text-center">
        <div className="mb-1 text-[15px] font-bold tracking-[.3em]">
          {speaker.wordmark}
          <span className="text-accent">·</span>
        </div>
        <p className="sub mb-6">Keynote pipeline</p>

        {mode === 'google' ? (
          <>
            <SignInButton />
            <p className="body-copy mt-5 text-ink-secondary">
              Google is the only way in. If your account is not on the allowlist, an admin adds
              you to the Users table in Airtable.
            </p>
          </>
        ) : mode === 'demo' ? (
          <p className="body-copy text-ink-secondary">
            Google SSO is not configured, so the app is running in demo mode with mock data.
            Set <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and{' '}
            <code>NEXTAUTH_SECRET</code> to enable sign-in.
          </p>
        ) : (
          <>
            <p className="body-copy text-ink-secondary">
              This deployment has no sign-in configured, and demo mode is refused in production.
              Set these three environment variables and redeploy:
            </p>
            <ul className="body-copy mt-3 text-left text-ink-secondary">
              <li>· GOOGLE_CLIENT_ID</li>
              <li>· GOOGLE_CLIENT_SECRET</li>
              <li>· NEXTAUTH_SECRET</li>
            </ul>
            <p className="body-copy mt-4 text-ink-secondary">
              Nothing is lost meanwhile: all state lives in Airtable, and the workers keep
              running against it.
            </p>
          </>
        )}

        {error ? (
          <p className="body-copy mt-4 text-danger">
            {error === 'AccessDenied'
              ? 'That account is not on the allowlist.'
              : 'Sign-in failed. Try again, or ask an admin to check the Users table.'}
          </p>
        ) : null}
      </div>
    </div>
  )
}
