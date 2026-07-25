/**
 * API bearer-token verification (AUTH-FIX-1).
 *
 * Humans authenticate with a short-lived HS256 JWT minted by the web app
 * (`apps/web/.../api/auth/api-token`) and signed with `AUTH_API_SECRET` — a
 * dedicated secret shared by the web (signer) and the API (verifier),
 * deliberately decoupled from NextAuth's own session secret so the API token
 * can later be issued by other login surfaces too. Machines keep using `wsp_`
 * keys (`middleware/api-key-auth.ts`). The verified `sub` claim is the userId.
 *
 * Verification never throws: callers treat `null` as "not a usable API token"
 * and (during the AUTH-FIX-1 dual-accept window) fall back to the legacy
 * header path. Phase 3 will make an invalid token a hard 401.
 */
import { jwtVerify } from 'jose'

/** Issuer/audience pin so a stray bearer (e.g. the extension's own token) is
 *  not mistaken for an API token. The web mint route sets these. */
export const API_TOKEN_ISSUER = 'workspace-web'
export const API_TOKEN_AUDIENCE = 'workspace-api'

export interface VerifiedApiToken {
  userId: string
  email?: string
}

function getSecretKey(): Uint8Array | null {
  const secret = process.env['AUTH_API_SECRET']
  if (!secret || secret.length < 16) return null
  return new TextEncoder().encode(secret)
}

/**
 * Verify a bearer token as an API JWT. Returns the identity on success, or
 * `null` when: no usable `AUTH_API_SECRET` is configured, the token is
 * empty/malformed/expired/tampered, or the issuer/audience don't match.
 * Never throws.
 */
export async function verifyApiToken(token: string): Promise<VerifiedApiToken | null> {
  const key = getSecretKey()
  if (!key || !token) return null
  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      issuer: API_TOKEN_ISSUER,
      audience: API_TOKEN_AUDIENCE,
    })
    const sub = typeof payload.sub === 'string' ? payload.sub : null
    if (!sub) return null
    return {
      userId: sub,
      email: typeof payload['email'] === 'string' ? (payload['email'] as string) : undefined,
    }
  } catch {
    return null
  }
}
