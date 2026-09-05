/**
 * QuickBooks Online — read only.
 *
 * The read-only guarantee is structural, not a promise: this module exposes exactly one
 * request function, it appends to `/query`, and there is no code path here that can issue
 * a create, update or delete. Money is the one place in this system where a machine must
 * not be able to write, and the way to guarantee that is to not write the code.
 *
 * ── Tokens rotate ──────────────────────────────────────────────────────────
 *
 * Intuit issues a new refresh token on *every* refresh and invalidates the old one. A
 * copy of the token file that has sat unused while another process kept refreshing is
 * therefore dead, not stale — which is exactly what happened to the checked-in copy in
 * `workers/quickbooks-mirror`. So the refreshed token is handed back to the caller to
 * persist, and a caller that ignores it will work once and fail forever after.
 */

export interface QboToken {
  access_token: string
  refresh_token: string
  realmId: string
  obtained_at?: number
  expires_in?: number
}

export type QboEnv = 'sandbox' | 'production'

export function qboEnv(): QboEnv {
  return process.env.QB_ENV === 'production' ? 'production' : 'sandbox'
}

function host(): string {
  return qboEnv() === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com'
}

export class QboNotConfigured extends Error {}
export class QboAuthFailed extends Error {}

/**
 * Exchanges the stored refresh token for an access token, and returns the *new* refresh
 * token alongside it. Persist what comes back.
 */
export async function refresh(token: QboToken): Promise<QboToken> {
  const id = process.env.QB_CLIENT_ID
  const secret = process.env.QB_CLIENT_SECRET
  if (!id || !secret) {
    throw new QboNotConfigured('QB_CLIENT_ID and QB_CLIENT_SECRET are not set')
  }

  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: token.refresh_token,
    }),
  })

  if (!res.ok) {
    const body = (await res.text()).slice(0, 240)
    throw new QboAuthFailed(
      `QuickBooks refresh failed: ${res.status} ${body}` +
        (body.includes('invalid_grant')
          ? ' — the refresh token has been used elsewhere or revoked. Re-authorise with auth-setup.'
          : ''),
    )
  }

  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number }
  return {
    ...token,
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_in: json.expires_in,
    obtained_at: Date.now(),
  }
}

/** The only outbound call in this module. Query text is never interpolated from a record. */
export async function query<T>(token: QboToken, statement: string): Promise<T[]> {
  const url =
    `${host()}/v3/company/${token.realmId}/query` +
    `?query=${encodeURIComponent(statement)}&minorversion=75`

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`QuickBooks query failed: ${res.status} ${(await res.text()).slice(0, 240)}`)

  const json = (await res.json()) as { QueryResponse?: Record<string, unknown> }
  const response = json.QueryResponse ?? {}
  // The entity name is the first word after "from", and QBO keys the array by it.
  const entity = statement.match(/\bfrom\s+(\w+)/i)?.[1]
  const rows = entity
    ? (response[entity] as T[] | undefined) ?? (response[entity.toLowerCase()] as T[] | undefined)
    : undefined
  return rows ?? []
}

export interface QboInvoice {
  Id: string
  DocNumber?: string
  TxnDate?: string
  DueDate?: string
  TotalAmt?: number
  Balance?: number
  CustomerRef?: { name?: string; value?: string }
  PrivateNote?: string
}

export interface QboPayment {
  Id: string
  TxnDate?: string
  TotalAmt?: number
  PaymentRefNum?: string
  CustomerRef?: { name?: string; value?: string }
  Line?: { LinkedTxn?: { TxnId?: string; TxnType?: string }[] }[]
}

export async function recentInvoices(token: QboToken, max = 500): Promise<QboInvoice[]> {
  return query<QboInvoice>(token, `select * from Invoice orderby TxnDate desc maxresults ${max}`)
}

export async function recentPayments(token: QboToken, max = 500): Promise<QboPayment[]> {
  return query<QboPayment>(token, `select * from Payment orderby TxnDate desc maxresults ${max}`)
}
