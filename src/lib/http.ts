/**
 * API-route plumbing.
 *
 * Every route funnels errors through `fail()` so a client never sees a stack trace and
 * an operator always sees one in the logs. RBAC refusals come back as a plain sentence
 * the UI can show verbatim — "Contract is not signed yet" is more useful than "403".
 */

import { NextResponse } from 'next/server'
import { ForbiddenError, UnauthorizedError } from './auth'
import { GatewayPaused } from './gateway'
import { StageBlocked } from '@/workers/f5-stage-engine'

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as Record<string, unknown>, init)
}

export function fail(error: unknown): NextResponse {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: error.message }, { status: 403 })
  }
  if (error instanceof StageBlocked) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (error instanceof GatewayPaused) {
    return NextResponse.json({ error: error.message }, { status: 503 })
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 })
  }
  console.error('[api]', error)
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return NextResponse.json({ error: message }, { status: 500 })
}

/** Cron endpoints are protected by a shared secret, not by a user session. */
export function assertCronAuth(request: Request): void {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenError('CRON_SECRET is not configured.')
    }
    return
  }
  const header = request.headers.get('authorization')
  if (header !== `Bearer ${secret}`) {
    throw new ForbiddenError('Bad cron credentials.')
  }
}
