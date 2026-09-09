import { NextResponse, type NextRequest } from 'next/server'

/**
 * Stamps the browser after every write, so its next reads skip the cache.
 *
 * The read cache lives per serverless instance. A write on one instance clears that
 * instance's copy and no other, so a person could change a stage, go back to the
 * pipeline, and be served the old list by a different instance for up to 45 seconds —
 * which reads as "it didn't save". A hard refresh only worked by landing elsewhere.
 *
 * The cookie is the cross-instance signal: it travels with the browser, not the
 * instance. `readThrough` treats a fresh stamp as "load, don't serve from memory". Only
 * that browser pays for it, and only for the cache's own lifetime.
 */
export const FRESH_COOKIE = 'louis-fresh'

export function middleware(request: NextRequest) {
  const response = NextResponse.next()
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
    response.cookies.set(FRESH_COOKIE, String(Date.now()), {
      path: '/',
      maxAge: 60,
      sameSite: 'lax',
      httpOnly: true,
    })
  }
  return response
}

export const config = { matcher: ['/api/:path*'] }
