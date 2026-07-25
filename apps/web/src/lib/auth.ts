import NextAuth from 'next-auth'
import type { Provider } from 'next-auth/providers'
import Google from 'next-auth/providers/google'
import GitHub from 'next-auth/providers/github'
import Resend from 'next-auth/providers/resend'
import { DEV_USER, DEV_WORKSPACE } from '@workspace/shared/constants'

const API_URL = process.env.NEXT_PUBLIC_API_URL || ''
const IS_DEV = process.env.NODE_ENV !== 'production'

// Only include providers that have credentials configured
const providers: Provider[] = []

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  )
}

if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  providers.push(
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    })
  )
}

if (process.env.RESEND_API_KEY) {
  providers.push(
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM ?? 'noreply@workspace.dev',
    })
  )
}

const nextAuth = NextAuth({
  // No adapter — pure JWT mode (no DB persistence for auth)
  secret: process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET,
  // Auth.js v5 runs behind Railway's reverse proxy; trust the forwarded host
  // header so it can construct callback URLs. Without this, every /api/auth/*
  // route (incl. csrf) throws UntrustedHost → 500 in production.
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/auth/login',
    newUser: '/onboarding',
  },
  providers,
  callbacks: {
    async signIn() {
      // User + workspace creation is handled by resolve-user in the JWT callback
      return true
    },
    async jwt({ token, user, trigger, session }) {
      if (user && user.email) {
        // Resolve user via the API (same lookup as extension-login)
        // This ensures web app and extension share the same user + workspace.
        try {
          const res = await fetch(`${API_URL}/api/auth/resolve-user`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: user.email,
              name: user.name ?? user.email.split('@')[0],
              avatarUrl: user.image ?? '',
            }),
          })
          if (res.ok) {
            const data = (await res.json()) as { data: { userId: string; workspaceId: string } }
            token.id = data.data.userId
            token.activeWorkspaceId = data.data.workspaceId
          } else {
            // Fallback to dev user if API is down
            token.id = IS_DEV ? DEV_USER.id : user.id
            token.activeWorkspaceId = IS_DEV ? DEV_WORKSPACE.id : undefined
          }
        } catch {
          // API not reachable — fallback
          token.id = IS_DEV ? DEV_USER.id : user.id
          token.activeWorkspaceId = IS_DEV ? DEV_WORKSPACE.id : undefined
        }
      }
      if (trigger === 'update' && session?.activeWorkspaceId) {
        token.activeWorkspaceId = session.activeWorkspaceId
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        session.user.id = token.id as string
        session.user.activeWorkspaceId = token.activeWorkspaceId as string | undefined
      }
      return session
    },
  },
})

export const { handlers, signIn, signOut, auth } = nextAuth
