import { db } from '@/lib/data'
import { authenticate, bearerFrom, roleAllowed } from '@/lib/mcp/tokens'
import { dispatchBatch, PROTOCOL_VERSION, SERVER_INFO } from '@/lib/mcp/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * WP3.4 — the MCP endpoint.
 *
 * Jordan adds this URL as a connector in his own Claude and pastes a token. From there,
 * "change the questionnaire chase to T-10 and re-run the timers worker" is one line in
 * chat instead of a message to a developer.
 *
 * ── What guards it ─────────────────────────────────────────────────────────
 *
 * A bearer token, which resolves to a user, who has a role, which every tool is checked
 * against by the same `rbac` the app's own routes use. The token grants identity, not
 * permission — so demoting someone in Settings takes their token's power away without
 * anyone having to find the token.
 *
 * The endpoint is admin-only even though ops can do more than this inside the app. The
 * app is a reviewed surface with a person looking at what they are about to send. A chat
 * client is not, and the difference matters more than the convenience.
 *
 * ── Why this route does so little ──────────────────────────────────────────
 *
 * Authenticate, dispatch, shape the response. No tool logic, no protocol logic. Both of
 * those are pure modules with tests; this file is the part that cannot be tested without
 * a running server, so there is deliberately almost nothing in it to get wrong.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function unauthorised(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    // Tells a compliant client to go and get a token rather than retry the same one.
    headers: { ...JSON_HEADERS, 'WWW-Authenticate': 'Bearer realm="louis-mcp"' },
  })
}

export async function POST(request: Request): Promise<Response> {
  const raw = bearerFrom(request.headers.get('authorization'))

  // Answered before the database is touched. A request with no credential cannot be
  // authorised by anything we might read, so reading is wasted — and on a metered API it
  // is worse than wasted: an unauthenticated flood would spend the month's quota.
  if (!raw) return unauthorised('A bearer token is required.')

  const provider = db()
  let tokens, users
  try {
    ;[tokens, users] = await Promise.all([provider.listApiTokens(), provider.listUsers()])
  } catch (err) {
    // The backend is unreachable. That is not the caller's fault and not a 500: it is a
    // 503 with nothing leaked about why.
    console.error('[mcp] could not read tokens or users:', err)
    return new Response(
      JSON.stringify({ error: 'The backend is unavailable. Try again shortly.' }),
      { status: 503, headers: JSON_HEADERS },
    )
  }

  const auth = authenticate(raw, tokens, users)
  if (!auth.ok || !auth.user) return unauthorised(auth.message ?? 'Unauthorised.')

  if (!roleAllowed(auth.user.role)) {
    return unauthorised('This endpoint is limited to admin accounts.')
  }
  if (auth.user.active === false) {
    return unauthorised('That account is not active.')
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response(
      JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Invalid JSON.' } }),
      { status: 400, headers: JSON_HEADERS },
    )
  }

  // Recorded after the token is known to be good, so a stream of failed attempts does not
  // write to the base. Failing quietly here is fine: a missed timestamp is not worth
  // refusing a call that is otherwise authorised.
  if (auth.token) {
    void provider
      .touchApiToken(auth.token.id, new Date().toISOString())
      .catch((err) => console.warn('[mcp] could not record token use:', err))
  }

  const result = await dispatchBatch(body, { user: auth.user })

  // A body of only notifications gets 202 and no content, which is what the spec asks for.
  if (result === null) return new Response(null, { status: 202 })
  return new Response(JSON.stringify(result), { status: 200, headers: JSON_HEADERS })
}

/**
 * A plain GET says what this is.
 *
 * Not part of MCP, and deliberately unauthenticated: it returns the protocol version and
 * nothing else, so someone who finds the URL learns it is an MCP server and learns
 * nothing about the business.
 */
export async function GET(): Promise<Response> {
  return new Response(
    JSON.stringify({
      server: SERVER_INFO,
      protocolVersion: PROTOCOL_VERSION,
      transport: 'POST JSON-RPC 2.0 with a bearer token',
    }),
    { status: 200, headers: JSON_HEADERS },
  )
}
