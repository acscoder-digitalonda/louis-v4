#!/usr/bin/env tsx
/**
 * Verifies the Google service-account setup end to end, before any of it is wired into
 * the app.
 *
 *   npx tsx scripts/verify-google-access.ts ~/path/to/louis-prod-xxxx.json
 *
 * The key file stays on your machine. Nothing is uploaded, logged or written anywhere,
 * and the script only ever reads.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Domain-wide delegation fails silently. A missing scope, a wrong client ID, or a
 * mailbox outside the Workspace all produce the same symptom: a token request that is
 * refused, deep inside a worker, hours later. Google also warns that a grant can take up
 * to 24 hours to propagate, so "it doesn't work yet" and "it will never work" look
 * identical until something checks each piece separately.
 *
 * This checks each piece separately and says which one is broken.
 *
 * ── The distinction that matters here ──────────────────────────────────────
 *
 * Delegation only reaches accounts *inside* the Workspace domain. Ben's calendar lives
 * on `bennemtin@gmail.com`, a consumer account, which delegation can never impersonate —
 * that one is reached only by explicitly sharing the calendar with the service account
 * (PART 3 step 9). So the calendar check is run two ways, and they mean different things.
 */

import { readFileSync } from 'node:fs'
import { createSign } from 'node:crypto'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
].join(' ')

/** Workspace mailboxes — these should be reachable by impersonation. */
const WORKSPACE_USERS = [
  'b@bennemtin.com',
  'liezel@bennemtin.com',
  'speaking@bennemtin.com',
]

/** Ben's real calendar. Consumer account: reachable only by explicit sharing. */
const BEN_CALENDAR = 'bennemtin@gmail.com'

interface KeyFile {
  client_email: string
  private_key: string
  client_id: string
  project_id: string
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Mints an access token. `subject` is the user to impersonate; omit it to act as the
 * service account itself, which is what a shared-calendar read uses.
 */
async function mintToken(key: KeyFile, subject?: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = b64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPES,
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
      ...(subject ? { sub: subject } : {}),
    }),
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  const signature = b64url(signer.sign(key.private_key))
  const assertion = `${header}.${claim}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  })
  const json = (await res.json()) as { access_token?: string; error?: string; error_description?: string }
  if (!res.ok || !json.access_token) {
    throw new Error(`${json.error ?? res.status}: ${json.error_description ?? 'no detail'}`)
  }
  return json.access_token
}

async function get(url: string, token: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  return { ok: res.ok, status: res.status, body: (await res.text()).slice(0, 200) }
}

function pass(msg: string) {
  console.info(`  PASS  ${msg}`)
}
function fail(msg: string, detail: string) {
  console.info(`  FAIL  ${msg}`)
  console.info(`        ${detail}`)
}

async function main() {
  const path = process.argv[2]
  if (!path) {
    console.error('Usage: npx tsx scripts/verify-google-access.ts <service-account-key.json>')
    process.exitCode = 1
    return
  }

  let key: KeyFile
  try {
    key = JSON.parse(readFileSync(path, 'utf8')) as KeyFile
  } catch (err) {
    console.error(`Could not read the key file: ${err instanceof Error ? err.message : err}`)
    process.exitCode = 1
    return
  }

  console.info(`Service account : ${key.client_email}`)
  console.info(`Client ID       : ${key.client_id}   ← must match Admin Console`)
  console.info(`Project         : ${key.project_id}\n`)

  let failures = 0

  // 1. The key itself. No delegation involved — proves the key is valid and the APIs
  //    are enabled on the project.
  console.info('1. Service account key')
  try {
    await mintToken(key)
    pass('key signs and Google issues a token')
  } catch (err) {
    fail('key rejected', String(err))
    console.info('\n     The key is bad or the project has no APIs enabled. Nothing below can pass.')
    process.exitCode = 1
    return
  }

  // 2. Delegation, one mailbox at a time. "unauthorized_client" here almost always means
  //    the Client ID or the scope list in the Admin Console does not match.
  console.info('\n2. Domain-wide delegation (Workspace mailboxes)')
  for (const user of WORKSPACE_USERS) {
    try {
      const token = await mintToken(key, user)
      const r = await get('https://gmail.googleapis.com/gmail/v1/users/me/profile', token)
      if (r.ok) pass(`${user} — Gmail readable`)
      else {
        fail(`${user} — token issued but Gmail refused (${r.status})`, r.body)
        failures += 1
      }
    } catch (err) {
      fail(`${user} — could not impersonate`, String(err))
      failures += 1
    }
  }

  // 3. Ben's calendar. Consumer account: delegation cannot reach it, so this tests the
  //    explicit share from PART 3 step 9 instead.
  console.info(`\n3. Ben's calendar (${BEN_CALENDAR}) — needs the explicit share, not delegation`)
  try {
    const token = await mintToken(key)
    const r = await get(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(BEN_CALENDAR)}/events?maxResults=1`,
      token,
    )
    if (r.ok) pass('calendar readable — the share in step 9 is done and working')
    else {
      fail(`calendar not readable (${r.status})`, r.body)
      console.info('        → PART 3 step 9 not done yet, or shared to the wrong address.')
      failures += 1
    }
  } catch (err) {
    fail('could not mint a service-account token', String(err))
    failures += 1
  }

  // 4. What the service account can already see. Useful for the sheets step.
  console.info('\n4. Drive visibility (Liezel\'s sheets, once shared)')
  try {
    const token = await mintToken(key)
    const r = await get(
      'https://www.googleapis.com/drive/v3/files?pageSize=10&fields=files(name,mimeType)',
      token,
    )
    if (r.ok) {
      const files = (JSON.parse(r.body || '{}') as { files?: { name: string }[] }).files ?? []
      pass(`Drive reachable — ${files.length} file(s) shared with the service account so far`)
      for (const f of files.slice(0, 5)) console.info(`        · ${f.name}`)
    } else {
      fail(`Drive not reachable (${r.status})`, r.body)
      failures += 1
    }
  } catch (err) {
    fail('Drive check failed', String(err))
    failures += 1
  }

  console.info('')
  if (failures === 0) {
    console.info('All checks passed. The credential is ready for the app to use.')
  } else {
    console.info(`${failures} check(s) failed. A fresh delegation grant can take up to 24h`)
    console.info('to propagate — if section 2 fails, re-run this in an hour before changing anything.')
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('verify failed', err)
  process.exitCode = 1
})
