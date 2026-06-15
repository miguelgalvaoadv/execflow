/**
 * Next.js Edge Middleware — session-based route protection.
 *
 * Checks for the Better Auth session cookie. If absent on a protected
 * route, redirects to /sign-in.
 *
 * This is a presence check only — full session verification happens
 * on the API server (apps/api). The middleware prevents unnecessary
 * flash of authenticated content, not as a security gate.
 *
 * Protected paths: everything under / except /sign-in and public assets.
 *
 * Architecture ref: technical-stack-decision.md §5 (Better Auth, cookie model).
 */

import { NextRequest, NextResponse } from 'next/server'

const SESSION_COOKIE = 'better-auth.session_token'

const PUBLIC_PATHS = new Set(['/sign-in'])

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true
  if (pathname.startsWith('/_next/')) return true
  if (pathname.startsWith('/api/')) return true
  if (/\.(ico|svg|png|jpg|jpeg|webp|woff2?|ttf)$/.test(pathname)) return true
  return false
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE)

  if (sessionCookie === undefined || sessionCookie.value === '') {
    const signIn = new URL('/sign-in', request.url)
    signIn.searchParams.set('from', pathname)
    return NextResponse.redirect(signIn)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all paths except static files, Next internals, and favicons.
     * Using a negative lookahead for clarity.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
