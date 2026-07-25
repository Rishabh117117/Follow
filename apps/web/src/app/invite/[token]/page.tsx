'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { useSession, signIn } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { api, authFetch } from '@/lib/api-client'

interface InviteInfo {
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  inviterName: string
  role: 'admin' | 'editor' | 'viewer'
  email: string | null
}

async function fetchInvite(token: string): Promise<InviteInfo | null> {
  const res = await authFetch(`/api/public/invite/${token}`)
  if (!res.ok) return null
  const body = await res.json()
  return body.data ?? null
}

export default function InvitePage() {
  const params = useParams<{ token: string }>()
  const token = params?.token as string
  const router = useRouter()
  const { status: sessionStatus } = useSession()

  const { data: invite, isLoading } = useQuery({
    queryKey: ['invite', token],
    queryFn: () => fetchInvite(token),
    enabled: !!token,
    retry: false,
  })

  const accept = useMutation({
    mutationFn: async () => {
      if (!invite) return null
      const res = await api.post(`/api/workspaces/${invite.workspaceId}/join`, { token })
      return res
    },
    onSuccess: (result) => {
      if (result?.data && invite) {
        router.push(`/workspace/${invite.workspaceId}`)
      }
    },
  })

  const handleAccept = () => {
    if (sessionStatus === 'authenticated') {
      accept.mutate()
    } else {
      signIn(undefined, { callbackUrl: `/invite/${token}` })
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ backgroundColor: 'var(--n100)' }}
    >
      <div className="w-full max-w-[440px]">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center">
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
        </div>

        <div
          className="rounded-xl border bg-white p-8 text-center shadow-sm"
          style={{ borderColor: 'var(--n200)' }}
        >
          {isLoading ? (
            <p className="text-[13px]" style={{ color: 'var(--n500)' }}>
              Loading invitation…
            </p>
          ) : !invite ? (
            <>
              <h1
                className="mb-2 text-[22px]"
                style={{
                  fontFamily: 'Newsreader, Georgia, serif',
                  color: 'var(--n950)',
                  fontWeight: 500,
                }}
              >
                This invite is no longer valid
              </h1>
              <p className="mb-6 text-[13px]" style={{ color: 'var(--n500)' }}>
                The invitation may have been revoked or already used. Ask the workspace owner to
                send a new one.
              </p>
              <Link
                href="/"
                className="inline-flex rounded-lg px-4 py-2 text-[13px] font-medium text-white"
                style={{ backgroundColor: 'var(--n950)' }}
              >
                Back to home
              </Link>
            </>
          ) : (
            <>
              <p
                className="mb-2 text-[12px] uppercase tracking-wider"
                style={{ color: 'var(--n500)' }}
              >
                You&rsquo;ve been invited
              </p>
              <h1
                className="mb-2 text-[24px] leading-tight"
                style={{
                  fontFamily: 'Newsreader, Georgia, serif',
                  color: 'var(--n950)',
                  fontWeight: 500,
                }}
              >
                {invite.inviterName} invited you to{' '}
                <strong style={{ fontWeight: 600 }}>{invite.workspaceName}</strong>
              </h1>
              <p className="mb-6 text-[13px]" style={{ color: 'var(--n500)' }}>
                Joining as{' '}
                <span className="capitalize" style={{ color: 'var(--n700)' }}>
                  {invite.role}
                </span>
              </p>

              {accept.isError && (
                <div
                  className="mb-4 rounded-md border px-3 py-2 text-[12px]"
                  style={{
                    backgroundColor: 'var(--errS)',
                    borderColor: '#FCA5A5',
                    color: 'var(--err)',
                  }}
                >
                  Could not accept the invitation. Please try again.
                </div>
              )}

              <button
                onClick={handleAccept}
                disabled={accept.isPending}
                className="w-full rounded-lg px-4 py-2.5 text-[13px] font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--n950)' }}
              >
                {sessionStatus === 'authenticated'
                  ? accept.isPending
                    ? 'Accepting…'
                    : 'Accept Invitation'
                  : 'Sign in to accept'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
