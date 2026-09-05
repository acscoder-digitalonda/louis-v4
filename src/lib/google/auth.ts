/**
 * Google authentication for the workers.
 *
 * Two paths, in priority order:
 *
 *  1. **Service account with domain-wide delegation** (`GOOGLE_SERVICE_ACCOUNT_JSON`).
 *     Signs a JWT and exchanges it for an access token, optionally impersonating a user
 *     via the `sub` claim. This is what lets one credential read *both* mailboxes rather
 *     than one, which is what F2 and C2 need.
 *  2. **A single user's refresh token** (`GMAIL_REFRESH_TOKEN`), the original path.
 *     One identity, no impersonation. Kept because it still works and a rollback should
 *     not require a code change.
 *
 * ── The limit worth knowing before you debug something else ────────────────
 *
 * Delegation only reaches accounts *inside* the Workspace domain. Ben's calendar lives
 * on `bennemtin@gmail.com`, a consumer account, which no amount of delegation will
 * impersonate — that one is reached by sharing the calendar with the service account
 * directly. So `accessToken()` with no subject (acting as the service account itself) is
 * the right call for shared resources, and `accessToken(user)` is for Workspace mailboxes.
 */

import { createSign } from 'node:crypto'

export const GMAIL_READ = 'https://www.googleapis.com/auth/gmail.readonly'
export const GMAIL_COMPOSE = 'https://www.googleapis.com/auth/gmail.compose'
export const CALENDAR = 'https://www.googleapis.com/auth/calendar'
export const DRIVE = 'https://www.googleapis.com/auth/drive'
export const SHEETS = 'https://www.googleapis.com/auth/spreadsheets'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
/** Refresh a minute early rather than discover expiry mid-batch. */
const SKEW_MS = 60_000

interface ServiceAccountKey {
  client_email: string
  private_key: string
  project_id?: string
}

export type GoogleAuthMode = 'service-account' | 'refresh-token' | 'none'

export function authMode(): GoogleAuthMode {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return 'service-account'
  if (
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN
  ) {
    return 'refresh-token'
  }
  return 'none'
}

export function googleConfigured(): boolean {
  return authMode() !== 'none'
}

let cachedKey: ServiceAccountKey | null = null

function serviceAccountKey(): ServiceAccountKey {
  if (cachedKey) return cachedKey
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set')
  let parsed: ServiceAccountKey
  try {
    parsed = JSON.parse(raw) as ServiceAccountKey
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON')
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key')
  }
  // Env vars often carry the key with literal \n rather than real newlines.
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
  cachedKey = parsed
  return parsed
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

interface CacheEntry {
  token: string
  expiresAt: number
}

const tokens = new Map<string, CacheEntry>()

/**
 * An access token for the given scopes, optionally as `subject`.
 *
 * Cached per (mode, subject, scopes) — a batch that reads two mailboxes should mint two
 * tokens, not two hundred.
 */
export async function accessToken(scopes: string[], subject?: string): Promise<string> {
  const mode = authMode()
  const key = `${mode}|${subject ?? '-'}|${[...scopes].sort().join(' ')}`
  const hit = tokens.get(key)
  if (hit && hit.expiresAt > Date.now() + SKEW_MS) return hit.token

  const fresh = mode === 'service-account'
    ? await mintServiceAccountToken(scopes, subject)
    : await mintRefreshToken()

  tokens.set(key, fresh)
  return fresh.token
}

async function mintServiceAccountToken(
  scopes: string[],
  subject?: string,
): Promise<CacheEntry> {
  const key = serviceAccountKey()
  const now = Math.floor(Date.now() / 1000)

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: scopes.join(' '),
      aud: TOKEN_URL,
      exp: now + 3600,
      iat: now,
      ...(subject ? { sub: subject } : {}),
    }),
  )

  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  const assertion = `${header}.${claim}.${b64url(signer.sign(key.private_key))}`

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })

  const json = (await res.json()) as {
    access_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }

  if (!res.ok || !json.access_token) {
    // `unauthorized_client` here is almost always the Admin Console grant, not the key:
    // a wrong Client ID, or a scope on the JWT that the grant does not list.
    const detail = json.error_description ?? json.error ?? `HTTP ${res.status}`
    throw new Error(
      `Google token request failed${subject ? ` for ${subject}` : ''}: ${detail}` +
        (json.error === 'unauthorized_client'
          ? ' — check the domain-wide delegation grant lists this Client ID and every scope requested.'
          : ''),
    )
  }

  return {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  }
}

async function mintRefreshToken(): Promise<CacheEntry> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { access_token: string; expires_in: number }
  return { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 }
}

/** Drops cached tokens. Used by tests and after a credential change. */
export function resetTokenCache(): void {
  tokens.clear()
  cachedKey = null
}
