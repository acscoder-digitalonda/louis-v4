import type { DefaultSession } from 'next-auth'
import type { Role } from '@/lib/types'

declare module 'next-auth' {
  interface Session {
    user?: {
      role?: Role
      landingPage?: string
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role?: Role
    landingPage?: string
  }
}
