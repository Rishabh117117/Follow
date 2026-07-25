/**
 * AUTH-FIX-1 — API bearer-token mint route.
 *
 * Same-origin route hit by the browser (cookie is sent). It reads the NextAuth
 * session SERVER-SIDE via `auth()` and, ONLY for a valid session, signs a
 * short-lived HS256 JWT (`sub = user.id`) with `AUTH_API_SECRET`. The web
 * api-client sends this as `Authorization: Bearer …` to the API, which verifies
 * it (packages/api/src/lib/api-token.ts) — so identity comes from a verified
 * credential, never a forgeable header. The signing secret lives only here,
 * server-side; it never reaches the browser.
 */
import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { auth } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Must match packages/api/src/lib/api-token.ts (API_TOKEN_ISSUER/AUDIENCE).
const ISSUER = 'workspace-web'
const AUDIENCE = 'workspace-api'
const TTL_SECONDS = 30 * 60 // 30 min (AUTH-FIX-1 decision); client re-mints near expiry.

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
      { status: 401 }
    )
  }

  const secret = process.env.AUTH_API_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: { code: 'CONFIG', message: 'AUTH_API_SECRET not configured' } },
      { status: 500 }
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const exp = now + TTL_SECONDS
  const token = await new SignJWT({ email: session.user.email ?? undefined })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.user.id)
    .setIssuedAt(now)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(exp)
    .sign(new TextEncoder().encode(secret))

  return NextResponse.json({
    token,
    expiresAt: exp * 1000, // ms epoch, for the client's re-mint timer
    activeWorkspaceId: session.user.activeWorkspaceId ?? null,
  })
}
