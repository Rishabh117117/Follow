'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api-client'

const ONBOARDING_FLAG = 'follow-onboarding-complete'

interface WorkspaceRow {
  id: string
  name: string
  slug: string
}

export default function OnboardingPage() {
  const { data: session, update } = useSession()
  const router = useRouter()
  const [step, setStep] = useState<1 | 2>(1)
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [creatingDoc, setCreatingDoc] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Pre-fill workspace name from user's display name
  useEffect(() => {
    const name = session?.user?.name ?? ''
    if (name && !workspaceName) {
      const first = name.split(' ')[0]
      setWorkspaceName(`${first}'s workspace`)
    }
  }, [session?.user?.name, workspaceName])

  // If user already has a workspace, skip onboarding
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const result = await api.get<WorkspaceRow[]>('/api/workspaces')
        if (cancelled) return
        if (result.data && result.data.length > 0) {
          router.replace(`/workspace/${result.data[0]!.id}`)
        }
      } catch {
        // network error — let user create
      }
    })()
    return () => {
      cancelled = true
    }
  }, [router])

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workspaceName.trim()) return
    setCreatingWorkspace(true)
    setError(null)

    const slug = workspaceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')

    try {
      const result = await api.post<{ id: string }>('/api/workspaces', {
        name: workspaceName.trim(),
        slug,
      })
      if (!result.data) {
        setError('Could not create workspace. Please try again.')
        setCreatingWorkspace(false)
        return
      }
      setWorkspaceId(result.data.id)
      await update({ activeWorkspaceId: result.data.id })
      setStep(2)
    } catch {
      setError('Could not create workspace. Please try again.')
    }
    setCreatingWorkspace(false)
  }

  const handleCreateDoc = async () => {
    if (!workspaceId) return
    setCreatingDoc(true)
    setError(null)

    try {
      const result = await api.post<{ id: string }>('/api/files', {
        workspaceId,
        name: 'Untitled',
        type: 'file',
        mimeType: 'text/html',
        metadata: {},
      })
      if (!result.data) {
        setError('Could not create document. Please try again.')
        setCreatingDoc(false)
        return
      }
      // Mark onboarding complete
      try {
        localStorage.setItem(ONBOARDING_FLAG, 'true')
      } catch {
        // ignore
      }
      router.push(`/workspace/${workspaceId}/editor/${result.data.id}`)
    } catch {
      setError('Could not create document. Please try again.')
      setCreatingDoc(false)
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ backgroundColor: 'var(--n100)' }}
    >
      <div className="w-full max-w-[480px]">
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

        {/* Progress */}
        <div className="mx-auto mb-6 flex w-32 gap-1.5">
          <div
            className="h-1 flex-1 rounded-full"
            style={{ backgroundColor: step >= 1 ? 'var(--n950)' : 'var(--n200)' }}
          />
          <div
            className="h-1 flex-1 rounded-full"
            style={{ backgroundColor: step >= 2 ? 'var(--n950)' : 'var(--n200)' }}
          />
        </div>

        {/* Card */}
        <div
          className="rounded-xl border bg-white p-8 shadow-sm"
          style={{ borderColor: 'var(--n200)' }}
        >
          {step === 1 ? (
            <>
              <h1
                className="mb-1.5 text-[24px] leading-tight"
                style={{
                  fontFamily: 'Newsreader, Georgia, serif',
                  color: 'var(--n950)',
                  fontWeight: 500,
                }}
              >
                Welcome to Follow
              </h1>
              <p className="mb-6 text-[13px]" style={{ color: 'var(--n500)' }}>
                Name your workspace to get started.
              </p>

              {error && (
                <div
                  className="mb-4 rounded-md border px-3 py-2 text-[12px]"
                  style={{
                    backgroundColor: 'var(--errS)',
                    borderColor: '#FCA5A5',
                    color: 'var(--err)',
                  }}
                >
                  {error}
                </div>
              )}

              <form onSubmit={handleCreateWorkspace} className="space-y-4">
                <div>
                  <label
                    className="mb-1.5 block text-[12px] font-medium"
                    style={{ color: 'var(--n700)' }}
                  >
                    Workspace name
                  </label>
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    className="w-full rounded-lg border bg-white px-4 py-2.5 text-[13px] focus:outline-none focus:ring-1"
                    style={{ borderColor: 'var(--n200)', color: 'var(--n900)' }}
                    required
                    autoFocus
                  />
                </div>
                <button
                  type="submit"
                  disabled={creatingWorkspace || !workspaceName.trim()}
                  className="w-full rounded-lg px-4 py-2.5 text-[13px] font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--n950)' }}
                >
                  {creatingWorkspace ? 'Creating…' : 'Create'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1
                className="mb-1.5 text-[24px] leading-tight"
                style={{
                  fontFamily: 'Newsreader, Georgia, serif',
                  color: 'var(--n950)',
                  fontWeight: 500,
                }}
              >
                Create your first document
              </h1>
              <p className="mb-6 text-[13px]" style={{ color: 'var(--n500)' }}>
                Start writing, thinking, and learning with Follow.
              </p>

              {error && (
                <div
                  className="mb-4 rounded-md border px-3 py-2 text-[12px]"
                  style={{
                    backgroundColor: 'var(--errS)',
                    borderColor: '#FCA5A5',
                    color: 'var(--err)',
                  }}
                >
                  {error}
                </div>
              )}

              <button
                onClick={handleCreateDoc}
                disabled={creatingDoc}
                className="group flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-12 transition-colors hover:bg-gray-50 disabled:opacity-50"
                style={{ borderColor: 'var(--n300)' }}
              >
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-full transition-colors group-hover:bg-white"
                  style={{ backgroundColor: 'var(--n100)' }}
                >
                  <svg
                    className="h-6 w-6"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: 'var(--n700)' }}
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <span
                  className="text-[13px] font-medium"
                  style={{ color: 'var(--n700)' }}
                >
                  {creatingDoc ? 'Creating…' : 'New document'}
                </span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
