/**
 * WP3.4 — MCP tokens.
 *
 * Jordan's spec asks for "a per-user token you can revoke in Settings". Three decisions
 * follow from taking that seriously.
 *
 * **Only the hash is stored.** The token is shown once, at creation, and never again. A
 * database that can print a working credential is a database whose backup is a
 * credential, and this one is exported to a git repo nightly (WP3.5).
 *
 * **The token carries no authority of its own.** It resolves to a user, the user has a
 * role, and every tool then goes through the same `rbac` the API routes use. A token is a
 * way of saying who you are, not a way of being allowed to do something — so revoking a
 * person's role revokes their token's power without anyone touching the token.
 *
 * **Revoking is a tick, not a delete.** The row stays, so an audit entry written six
 * months ago still resolves to a name.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { ApiToken, Role, User } from '../types'

/** Recognisable in a log or a config file, so a leaked one can be identified. */
export const TOKEN_PREFIX = 'louis_mcp_'

export interface IssuedToken {
  /** Shown once. Never stored, never logged, never returned again. */
  token: string
  hash: string
  prefix: string
}

export function issueToken(): IssuedToken {
  const secret = randomBytes(32).toString('base64url')
  const token = `${TOKEN_PREFIX}${secret}`
  return {
    token,
    hash: hashToken(token),
    // Enough to tell two tokens apart in a list, far too little to reconstruct one.
    prefix: `${TOKEN_PREFIX}${secret.slice(0, 6)}`,
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Constant-time compare of two hex digests. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

export type AuthFailure =
  | 'missing'
  | 'malformed'
  | 'unknown'
  | 'revoked'
  | 'expired'
  | 'no-user'
  | 'role'

export interface AuthResult {
  ok: boolean
  user?: User
  token?: ApiToken
  failure?: AuthFailure
  /** Safe to return to the caller: never says whether a token exists. */
  message?: string
}

/** Pulls the token out of an Authorization header. */
export function bearerFrom(header: string | null | undefined): string | null {
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

/**
 * Resolves a token to the user it belongs to.
 *
 * Every failure returns the same message. Distinguishing "no such token" from "revoked"
 * would let anyone with the endpoint enumerate which tokens once existed, and the caller
 * can do nothing differently with the distinction anyway.
 */
export function authenticate(
  raw: string | null,
  tokens: ApiToken[],
  users: User[],
  now = new Date().toISOString().slice(0, 10),
): AuthResult {
  const deny = (failure: AuthFailure): AuthResult => ({
    ok: false,
    failure,
    message: 'Unauthorised. Check the token in Settings, or ask an admin to issue one.',
  })

  if (!raw) return deny('missing')
  if (!raw.startsWith(TOKEN_PREFIX)) return deny('malformed')

  const hash = hashToken(raw)
  const token = tokens.find((t) => sameHash(t.tokenHash, hash))
  if (!token) return deny('unknown')
  if (token.revoked) return deny('revoked')
  if (token.expiresAt && token.expiresAt < now) return deny('expired')

  const user = users.find((u) => u.email.toLowerCase() === token.userEmail.toLowerCase())
  // A token whose user was deleted is not a token belonging to nobody — it is a token
  // belonging to somebody who no longer works here.
  if (!user) return deny('no-user')

  return { ok: true, user, token }
}

/**
 * The roles that may reach the endpoint at all.
 *
 * Jordan: "scope it to admin roles". Ops is deliberately excluded even though ops can do
 * more than this in the app: the app is a reviewed surface with a person looking at what
 * they are about to send, and a chat client is not.
 */
export const MCP_ROLES: Role[] = ['admin']

export function roleAllowed(role: Role): boolean {
  return MCP_ROLES.includes(role)
}
