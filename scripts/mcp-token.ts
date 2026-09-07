#!/usr/bin/env tsx
/**
 * WP3.4 — issues and revokes MCP tokens.
 *
 *   npm run mcp:token -- --list
 *   npm run mcp:token -- --issue --for=jordan@bennemtin.com --label="Jordan · Claude"
 *   npm run mcp:token -- --revoke=recTOKxxxx
 *
 * The Settings screen is WP2.3 and does not exist yet. This is the same operations, in a
 * place a person can reach today, so the endpoint is usable rather than merely built.
 *
 * ── The token is printed once ──────────────────────────────────────────────
 *
 * Only the hash is stored, so there is no "show me that token again". Losing it means
 * issuing another and revoking the first, which is a two-second inconvenience and the
 * reason the nightly git backup cannot contain a working credential.
 */

import { db } from '../src/lib/data'
import { agentActor, recordEvent } from '../src/lib/audit'
import { issueToken, roleAllowed, TOKEN_PREFIX } from '../src/lib/mcp/tokens'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit?.slice(name.length + 3)
}

async function list() {
  const tokens = await db().listApiTokens()
  if (tokens.length === 0) {
    console.log('No tokens issued.')
    return
  }
  console.log(`${tokens.length} token(s):\n`)
  for (const t of tokens) {
    const state = t.revoked ? 'REVOKED' : t.expiresAt ? `expires ${t.expiresAt}` : 'active'
    console.log(`  ${t.id}  ${t.prefix}…  ${state.padEnd(18)} ${t.userEmail}`)
    console.log(`      ${t.label}  ·  last used ${t.lastUsedAt ?? 'never'}`)
  }
}

async function issue() {
  const email = arg('for')
  if (!email) {
    console.error('--for=<email> is required.')
    process.exitCode = 1
    return
  }

  const provider = db()
  const user = (await provider.listUsers()).find(
    (u) => u.email.toLowerCase() === email.toLowerCase(),
  )
  if (!user) {
    console.error(`No user ${email}. Add them in Settings first — a token needs someone to be.`)
    process.exitCode = 1
    return
  }
  // Refused here as well as at the endpoint. A token that can never work is a token
  // somebody will spend an afternoon debugging.
  if (!roleAllowed(user.role)) {
    console.error(`${email} is ${user.role}. The MCP endpoint is admin-only, so this token`)
    console.error('would authenticate and then be refused on every call.')
    process.exitCode = 1
    return
  }

  const { token, hash, prefix } = issueToken()
  const created = await provider.createApiToken({
    label: arg('label') ?? `${user.name} · MCP`,
    tokenHash: hash,
    prefix,
    userEmail: user.email,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    expiresAt: arg('expires') ?? null,
    revoked: false,
  })

  await recordEvent({
    table: 'users',
    recordId: user.id,
    what: 'MCP token issued',
    detail: `${created.id} (${prefix}…) for ${user.email}`,
    actor: agentActor('WP3.4'),
    source: 'MCP',
  })

  console.log(`\nToken for ${user.email} (${user.role}). Shown once, never again:\n`)
  console.log(`  ${token}\n`)
  console.log(`Record ${created.id}. Revoke with:`)
  console.log(`  npm run mcp:token -- --revoke=${created.id}\n`)
  console.log('Add it in Claude as a custom connector:')
  console.log(`  URL          ${process.env.NEXTAUTH_URL ?? 'https://louis-v3.vercel.app'}/api/mcp`)
  console.log('  Header       Authorization: Bearer <the token above>')
}

async function revoke(id: string) {
  const provider = db()
  const token = (await provider.listApiTokens()).find((t) => t.id === id)
  if (!token) {
    console.error(`No token ${id}. Run --list to see them.`)
    process.exitCode = 1
    return
  }
  await provider.revokeApiToken(id)
  await recordEvent({
    table: 'users',
    recordId: id,
    what: 'MCP token revoked',
    detail: `${token.prefix}… for ${token.userEmail}`,
    actor: agentActor('WP3.4'),
    source: 'MCP',
  })
  console.log(`Revoked ${token.prefix}… (${token.userEmail}). It stops working immediately.`)
}

async function main() {
  const toRevoke = arg('revoke')
  if (process.argv.includes('--list')) return list()
  if (process.argv.includes('--issue')) return issue()
  if (toRevoke) return revoke(toRevoke)

  console.log('Usage:')
  console.log('  npm run mcp:token -- --list')
  console.log(`  npm run mcp:token -- --issue --for=<email> [--label="…"] [--expires=YYYY-MM-DD]`)
  console.log('  npm run mcp:token -- --revoke=<record id>')
  console.log(`\nTokens start with ${TOKEN_PREFIX} and are stored only as a SHA-256 hash.`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
