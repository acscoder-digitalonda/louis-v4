/**
 * Authentication (Handoff §9).
 *
 * Google SSO is the only sign-in. There is no username/password path anywhere in this
 * codebase and none should ever be added — Google owns MFA and session security, and a
 * password store is surface area we refuse to own.
 *
 * The allowlist is the `Users` table in Airtable, seeded from `speaker.config` +
 * `ALLOWLIST`. That is the break-glass path: if app auth misbehaves, an admin fixes the
 * row in Airtable, not in the app.
 *
 * When no Google credentials are configured (a fresh clone, CI, a design review) the app
 * runs in **demo mode**: no sign-in, a fixed admin identity, mock data. Demo mode refuses
 * to start in production.
 */

import type { NextAuthOptions, Session } from 'next-auth'
import GoogleProvider from 'next-auth/providers/google'
import { getServerSession } from 'next-auth'
import { db } from './data'
import { defaultNotificationPrefs } from './rbac'
import type { Role, User } from './types'
import { speaker } from '~/speaker.config'

export type AuthMode = 'google' | 'demo'

export function authMode(): AuthMode {
  const configured = Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.NEXTAUTH_SECRET,
  )
  if (configured) return 'google'
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Google SSO is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and NEXTAUTH_SECRET — ' +
        'demo mode is refused in production.',
    )
  }
  return 'demo'
}

/** `email:role` pairs from env, merged with the seed admins from speaker.config. */
export function envAllowlist(): Map<string, Role> {
  const out = new Map<string, Role>()
  for (const admin of speaker.seedAdmins) out.set(admin.toLowerCase(), 'admin')
  for (const entry of (process.env.ALLOWLIST ?? '').split(',')) {
    const [email, role] = entry.split(':').map((s) => s?.trim())
    if (!email) continue
    out.set(email.toLowerCase(), normaliseRole(role))
  }
  return out
}

function normaliseRole(value: string | undefined): Role {
  const roles: Role[] = ['owner', 'admin', 'ops', 'accountant']
  return roles.find((r) => r === value) ?? 'ops'
}

/**
 * Resolves an email to a user. The Users table wins; env is the seed that lets the
 * first admin in before the table exists.
 */
export async function resolveUser(email: string): Promise<User | null> {
  const provider = db()
  const existing = await provider.getUserByEmail(email)
  if (existing) return existing.active ? existing : null

  const seeded = envAllowlist().get(email.toLowerCase())
  if (!seeded) return null

  return provider.upsertUser({
    email: email.toLowerCase(),
    role: seeded,
    active: true,
    landingPage: seeded === 'ops' ? '/queue' : '/pipeline',
    notificationPrefs: defaultNotificationPrefs(seeded),
    showMoneyAmounts: seeded !== 'owner',
    theme: 'system',
  })
}

export const authOptions: NextAuthOptions = {
  providers:
    authModeSafe() === 'google'
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID!,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
          }),
        ]
      : [],
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin', error: '/signin' },
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false
      const resolved = await resolveUser(user.email)
      // An unlisted Google account is simply not a user here.
      return Boolean(resolved)
    },
    async jwt({ token }) {
      if (!token.email) return token
      const user = await resolveUser(token.email)
      if (user) {
        token.role = user.role
        token.landingPage = user.landingPage
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.role = (token.role as Role) ?? 'ops'
        session.user.landingPage = (token.landingPage as string) ?? '/pipeline'
      }
      return session
    },
  },
}

/** Non-throwing variant for module scope — the throwing check runs per request. */
export function authModeSafe(): AuthMode {
  try {
    return authMode()
  } catch {
    return 'google'
  }
}

export function demoUser(): User {
  const email = process.env.DEMO_USER_EMAIL ?? speaker.seedAdmins[0] ?? 'demo@example.com'
  return {
    id: 'demo',
    email,
    name: 'Demo admin',
    role: (process.env.DEMO_USER_ROLE as Role) ?? 'admin',
    active: true,
    landingPage: '/pipeline',
    notificationPrefs: defaultNotificationPrefs('admin'),
    showMoneyAmounts: true,
    theme: 'system',
  }
}

/**
 * The single source of "who is asking" for server components and API routes.
 * Returns null when nobody is signed in.
 */
export async function currentUser(): Promise<User | null> {
  if (authMode() === 'demo') {
    const demo = demoUser()
    return (await db().getUserByEmail(demo.email)) ?? demo
  }
  const session = (await getServerSession(authOptions)) as Session | null
  const email = session?.user?.email
  if (!email) return null
  return resolveUser(email)
}

/** Throws when unauthenticated — for API routes that must not fall through. */
export async function requireUser(): Promise<User> {
  const user = await currentUser()
  if (!user) throw new UnauthorizedError()
  return user
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Not signed in')
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ForbiddenError'
  }
}
