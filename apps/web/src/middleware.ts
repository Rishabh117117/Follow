import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true'

// Auth.js v5: read the session via the `auth` wrapper (req.auth), NOT getToken.
// In v5 the session JWT is encrypted with a salt derived from the cookie name
// (`__Secure-authjs.session-token` in prod). `getToken` can't reproduce that
// salt, so it always returned null here → every Google login bounced straight
// back to /auth/login (a login loop). `auth()` decrypts with the same instance
// that signed the cookie, so the session is recognized.
export default auth((req) => {
  const { pathname } = req.nextUrl

  // Dev mode: skip auth entirely
  if (DEV_BYPASS_AUTH) {
    if (pathname === '/auth/login') {
      return NextResponse.redirect(new URL('/workspace', req.nextUrl))
    }
    return NextResponse.next()
  }

  const isLoggedIn = !!req.auth

  if (pathname.startsWith('/workspace') || pathname === '/onboarding') {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL('/auth/login', req.nextUrl))
    }
  }

  if (pathname === '/auth/login' && isLoggedIn) {
    return NextResponse.redirect(new URL('/workspace', req.nextUrl))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/workspace/:path*', '/onboarding', '/auth/login'],
}
