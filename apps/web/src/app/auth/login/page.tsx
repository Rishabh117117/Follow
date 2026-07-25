'use client'

import { signIn, useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'

const ERROR_MESSAGES: Record<string, string> = {
  Signin: 'Try signing in with a different account.',
  OAuthSignin: 'Could not start sign in. Please try again.',
  OAuthCallback: 'Could not complete sign in. Please try again.',
  OAuthCreateAccount: 'Could not create your account. Please try again.',
  EmailCreateAccount: 'Could not create your account with that email.',
  Callback: 'Sign in callback failed. Please try again.',
  OAuthAccountNotLinked: 'This email is already linked to another provider.',
  EmailSignin: 'Could not send the magic link. Please try again.',
  CredentialsSignin: 'Invalid credentials.',
  SessionRequired: 'Please sign in to continue.',
  default: 'Something went wrong. Please try again.',
}

/**
 * AUTH-LOGIN-SUSPENSE-1 (2026-04-23): body extracted into a file-local
 * component so the default export can wrap it in <Suspense>. Next 14's
 * static-prerender step requires any `useSearchParams()` consumer to
 * sit under a Suspense boundary, otherwise the page cannot be statically
 * generated and `npm run build` fails at the export phase.
 */
function LoginPageContent() {
  const router = useRouter()
  const { status } = useSession()
  const searchParams = useSearchParams()
  const errorCode = searchParams.get('error')
  const errorMessage = errorCode ? (ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES['default']) : null

  const [email, setEmail] = useState('')
  const [emailSent, setEmailSent] = useState(false)
  const [loading, setLoading] = useState<null | 'google' | 'github' | 'email'>(null)

  // Already signed in? redirect.
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/workspace')
    }
  }, [status, router])

  const handleGoogle = async () => {
    setLoading('google')
    await signIn('google', { callbackUrl: '/workspace' })
  }

  const handleGithub = async () => {
    setLoading('github')
    await signIn('github', { callbackUrl: '/workspace' })
  }

  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return
    setLoading('email')
    await signIn('resend', { email, callbackUrl: '/workspace' })
    setEmailSent(true)
    setLoading(null)
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ backgroundColor: 'var(--n100)' }}
    >
      <div className="w-full max-w-[400px]">
        {/* Brand */}
        <div className="mb-10 flex flex-col items-center">
          <div className="mb-4 flex items-center gap-2.5">
            <div
              className="flex h-5 w-5 items-center justify-center rounded-[3px]"
              style={{ backgroundColor: 'var(--n950)' }}
            >
              <span className="text-[11px] font-bold leading-none text-white">F</span>
            </div>
            <span
              className="text-[22px] leading-none"
              style={{
                fontFamily: 'Newsreader, Georgia, serif',
                color: 'var(--n950)',
                fontWeight: 500,
              }}
            >
              Follow
            </span>
          </div>
          <p className="text-[13px]" style={{ color: 'var(--n500)' }}>
            Documents that remember
          </p>
        </div>

        {/* Card */}
        <div
          className="rounded-xl border bg-white p-8 shadow-sm"
          style={{ borderColor: 'var(--n200)' }}
        >
          {errorMessage && (
            <div
              className="mb-4 rounded-md border px-3 py-2 text-[12px]"
              style={{
                backgroundColor: 'var(--errS)',
                borderColor: '#FCA5A5',
                color: 'var(--err)',
              }}
            >
              {errorMessage}
            </div>
          )}

          <div className="space-y-2.5">
            <button
              onClick={handleGoogle}
              disabled={loading !== null}
              className="flex w-full items-center justify-center gap-3 rounded-lg border bg-white px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-gray-50 disabled:opacity-50"
              style={{ borderColor: 'var(--n200)', color: 'var(--n900)' }}
            >
              <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {loading === 'google' ? 'Signing in…' : 'Continue with Google'}
            </button>

            <button
              onClick={handleGithub}
              disabled={loading !== null}
              className="flex w-full items-center justify-center gap-3 rounded-lg border bg-white px-4 py-2.5 text-[13px] font-medium transition-colors hover:bg-gray-50 disabled:opacity-50"
              style={{ borderColor: 'var(--n200)', color: 'var(--n900)' }}
            >
              <svg className="h-[18px] w-[18px]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
              </svg>
              {loading === 'github' ? 'Signing in…' : 'Continue with GitHub'}
            </button>
          </div>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t" style={{ borderColor: 'var(--n200)' }} />
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-2 text-[11px]" style={{ color: 'var(--n500)' }}>
                or continue with email
              </span>
            </div>
          </div>

          {emailSent ? (
            <div
              className="rounded-md border px-3 py-3 text-center text-[12px]"
              style={{
                backgroundColor: '#F0FDF4',
                borderColor: '#BBF7D0',
                color: '#166534',
              }}
            >
              Check your email for a magic link to sign in.
            </div>
          ) : (
            <form onSubmit={handleEmail} className="space-y-2.5">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full rounded-lg border bg-white px-4 py-2.5 text-[13px] focus:outline-none focus:ring-1"
                style={{
                  borderColor: 'var(--n200)',
                  color: 'var(--n900)',
                }}
                required
              />
              <button
                type="submit"
                disabled={loading !== null || !email}
                className="w-full rounded-lg px-4 py-2.5 text-[13px] font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--n950)' }}
              >
                {loading === 'email' ? 'Sending…' : 'Send magic link'}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-[11px]" style={{ color: 'var(--n500)' }}>
          By continuing, you agree to our Terms of Service and Privacy Policy.
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageContent />
    </Suspense>
  )
}
