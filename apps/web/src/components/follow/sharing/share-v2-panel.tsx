'use client'

/**
 * ShareV2Panel — enhanced white-mode share panel replacing the old modal.
 *
 * Features:
 * - Right-side slide-in panel (380px) matching other Follow panels
 * - Invite by email with role selector
 * - Current access list with avatars
 * - Context sharing toggles (doc history, sources, AI trail, chats, notes)
 * - Link sharing with copy-to-clipboard
 * - White-mode styling consistent with Follow design
 */

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

interface ShareV2PanelProps {
  isOpen: boolean
  onClose: () => void
  fileId: string
  fileName: string
}

interface ShareEntry {
  id: string
  fileId: string
  userId: string | null
  permission: string
  sharedBy: string
  shareToken: string | null
  userName: string | null
  userEmail: string | null
  userAvatar: string | null
}

export function ShareV2Panel({ isOpen, onClose, fileId, fileName }: ShareV2PanelProps) {
  const queryClient = useQueryClient()

  const [inviteEmail, setInviteEmail] = useState('')
  const [invitePermission, setInvitePermission] = useState<'viewer' | 'editor'>('viewer')
  const [linkSharing, setLinkSharing] = useState(false)
  const [shareLink, setShareLink] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  // E-3.4: include a handoff summary when granting editor access
  const [includeHandoff, setIncludeHandoff] = useState(false)

  // Context sharing toggles
  const [shareDocHistory, setShareDocHistory] = useState(true)
  const [shareAttachedSources, setShareAttachedSources] = useState(true)
  const [shareAiTrail, setShareAiTrail] = useState(false)
  const [shareGeneralChats, setShareGeneralChats] = useState(false)
  const [shareNotes] = useState(false)

  const { data: sharesData } = useQuery({
    queryKey: ['file-shares-v2', fileId],
    queryFn: () => api.get<ShareEntry[]>(`/api/sharing/files/${fileId}/shares`),
    enabled: isOpen,
  })

  const shares = sharesData?.data ?? []
  const userShares = shares.filter((s) => s.userId)
  const linkShare = shares.find((s) => s.shareToken)

  const shareMutation = useMutation({
    mutationFn: (data: { email: string; permission: string }) =>
      api.post(`/api/sharing/files/${fileId}/share`, {
        ...data,
        contextSettings: {
          docHistory: shareDocHistory,
          attachedSources: shareAttachedSources,
          aiTrail: shareAiTrail,
          generalChats: shareGeneralChats,
          notes: shareNotes,
        },
      }),
    onSuccess: async (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['file-shares-v2', fileId] })
      setInviteEmail('')

      // E-3.4: generate handoff conversation if requested + editor permission
      if (includeHandoff && variables.permission === 'editor') {
        try {
          await createHandoffConversation(fileId, fileName)
        } catch (err) {
          console.error('[share-v2] handoff creation failed:', err)
        } finally {
          setIncludeHandoff(false)
        }
      }
    },
  })

  const removeShareMutation = useMutation({
    mutationFn: (userId: string) => api.delete(`/api/sharing/files/${fileId}/shares/${userId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['file-shares-v2', fileId] }),
  })

  const linkShareMutation = useMutation({
    mutationFn: (data: { permission: string }) =>
      api.post<{ shareUrl: string }>(`/api/sharing/files/${fileId}/link`, data),
    onSuccess: (result) => {
      if (result.data?.shareUrl) {
        setShareLink(result.data.shareUrl)
        setLinkSharing(true)
      }
      queryClient.invalidateQueries({ queryKey: ['file-shares-v2', fileId] })
    },
  })

  const handleInvite = useCallback(() => {
    if (!inviteEmail) return
    shareMutation.mutate({ email: inviteEmail, permission: invitePermission })
  }, [inviteEmail, invitePermission, shareMutation])

  const handleCopyLink = useCallback(() => {
    navigator.clipboard.writeText(shareLink)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }, [shareLink])

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/10 transition-opacity"
        onClick={onClose}
        data-testid="share-v2-backdrop"
      />

      {/* Right-side panel */}
      <div
        className="fixed right-0 top-0 z-50 flex h-full w-[380px] animate-[slideInRight_200ms_ease-out] flex-col bg-white shadow-xl"
        style={{ borderLeft: '1px solid var(--n200)' }}
        data-testid="share-v2-panel"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--n150)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm">🔗</span>
            <span className="text-sm font-semibold" style={{ color: 'var(--n800)' }}>
              Share
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-xs transition-colors hover:bg-[var(--n100)]"
            style={{ color: 'var(--n500)' }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-4 py-3">
          {/* Document name */}
          <div
            className="mb-4 rounded-md px-3 py-2"
            style={{ background: 'var(--n50)', border: '1px solid var(--n200)' }}
          >
            <p className="text-xs font-medium" style={{ color: 'var(--n700)' }}>
              📄 {fileName}
            </p>
          </div>

          {/* Invite by email */}
          <div className="mb-4">
            <h4
              className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--n400)' }}
            >
              Invite People
            </h4>
            <div className="flex gap-1.5">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Email address..."
                className="flex-1 rounded-md px-2.5 py-1.5 text-xs outline-none"
                style={{
                  border: '1px solid var(--n200)',
                  color: 'var(--n700)',
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              />
              <select
                value={invitePermission}
                onChange={(e) => setInvitePermission(e.target.value as 'viewer' | 'editor')}
                className="rounded-md px-1.5 py-1.5 text-[10px] outline-none"
                style={{
                  border: '1px solid var(--n200)',
                  color: 'var(--n600)',
                }}
              >
                <option value="viewer">View</option>
                <option value="editor">Edit</option>
              </select>
              <button
                onClick={handleInvite}
                disabled={!inviteEmail || shareMutation.isPending}
                className="rounded-md px-3 py-1.5 text-[10px] font-medium text-white transition-colors disabled:opacity-50"
                style={{ background: 'var(--ai)' }}
              >
                Invite
              </button>
            </div>

            {/* E-3.4: Handoff summary opt-in, shown only for Edit invites */}
            {invitePermission === 'editor' && (
              <label
                className="mt-2 flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px]"
                style={{ color: 'var(--n600)' }}
              >
                <input
                  type="checkbox"
                  checked={includeHandoff}
                  onChange={(e) => setIncludeHandoff(e.target.checked)}
                  className="h-3 w-3"
                />
                <span>
                  Include handoff summary from Follow
                  <span className="ml-1 text-[10px]" style={{ color: 'var(--n400)' }}>
                    — phase, tensions, open questions
                  </span>
                </span>
              </label>
            )}
          </div>

          {/* Current access */}
          {userShares.length > 0 && (
            <div className="mb-4">
              <h4
                className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--n400)' }}
              >
                People with Access
              </h4>
              <div className="space-y-1.5">
                {userShares.map((share) => (
                  <div
                    key={share.id}
                    className="flex items-center justify-between rounded-md px-3 py-2"
                    style={{ background: 'var(--n50)', border: '1px solid var(--n100)' }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ background: 'var(--ai)' }}
                      >
                        {(share.userName ?? share.userEmail ?? '?').charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="text-xs font-medium" style={{ color: 'var(--n700)' }}>
                          {share.userName ?? share.userEmail}
                        </p>
                        {share.userName && share.userEmail && (
                          <p className="text-[10px]" style={{ color: 'var(--n400)' }}>
                            {share.userEmail}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="rounded px-1.5 py-0.5 text-[9px] font-medium"
                        style={{ background: 'var(--n100)', color: 'var(--n500)' }}
                      >
                        {share.permission}
                      </span>
                      <button
                        onClick={() => share.userId && removeShareMutation.mutate(share.userId)}
                        className="text-[10px] transition-colors"
                        style={{ color: 'var(--n400)' }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Context Access — v8 wireframe style */}
          <div className="mb-4">
            <h4
              className="mb-2 text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--n400)' }}
            >
              Context Access
            </h4>
            <div className="space-y-1">
              <ContextToggle
                label="Edit history"
                description="Full document revision timeline"
                checked={shareDocHistory}
                onChange={setShareDocHistory}
              />
              <ContextToggle
                label="Chat threads"
                description="Document-scoped AI conversations"
                checked={shareGeneralChats}
                onChange={setShareGeneralChats}
              />
              <ContextToggle
                label="AI contributions"
                description="Ghost drafts and revision provenance"
                checked={shareAiTrail}
                onChange={setShareAiTrail}
              />
              <ContextToggle
                label="Source links"
                description="Attached sources and evidence clips"
                checked={shareAttachedSources}
                onChange={setShareAttachedSources}
              />
            </div>
          </div>

          {/* Link sharing */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h4
                  className="text-[11px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--n400)' }}
                >
                  Link Sharing
                </h4>
                <p className="text-[10px]" style={{ color: 'var(--n400)' }}>
                  Anyone with the link can access
                </p>
              </div>
              <button
                onClick={() => {
                  if (!linkSharing && !linkShare) {
                    linkShareMutation.mutate({ permission: 'viewer' })
                  } else {
                    setLinkSharing(!linkSharing)
                  }
                }}
                className="h-5 w-9 rounded-full p-0.5 transition-colors"
                style={{
                  background: linkSharing || linkShare ? 'var(--ai)' : 'var(--n200)',
                }}
              >
                <div
                  className="h-4 w-4 rounded-full bg-white transition-transform"
                  style={{
                    transform: linkSharing || linkShare ? 'translateX(16px)' : 'translateX(0)',
                  }}
                />
              </button>
            </div>

            {(linkSharing || linkShare) && (
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={shareLink || 'Generating link...'}
                  readOnly
                  className="flex-1 rounded-md px-2.5 py-1.5 text-[10px] outline-none"
                  style={{
                    background: 'var(--n50)',
                    border: '1px solid var(--n200)',
                    color: 'var(--n500)',
                  }}
                />
                <button
                  onClick={handleCopyLink}
                  className="rounded-md px-3 py-1.5 text-[10px] font-medium transition-colors"
                  style={{
                    background: linkCopied ? '#DCFCE7' : 'var(--n100)',
                    color: linkCopied ? '#166534' : 'var(--n600)',
                  }}
                >
                  {linkCopied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

/**
 * E-3.4: Create a handoff conversation thread for a document.
 *
 * Fetches the doc-memory summary, formats it as a handoff message
 * (phase, tensions, AI sections, open questions), and creates a new
 * chat thread with that summary as the first assistant message.
 */
async function createHandoffConversation(fileId: string, docTitle: string): Promise<void> {
  // 1. Fetch doc memory summary
  const memoryRes = await api.get<Record<string, unknown>>(`/api/doc-memory/${fileId}`)
  const summary = memoryRes.data || {}

  const handoff = formatHandoff(summary, docTitle)

  // 2. Create a new conversation scoped to this document
  const convRes = await api.post<{ id: string }>('/api/conversations', {
    type: 'standard',
    contextObjectId: fileId,
    contextObjectType: 'file',
    title: `Handoff: ${docTitle}`,
  })
  const conversationId = convRes.data?.id
  if (!conversationId) throw new Error('Failed to create conversation')

  // 3. Post the summary as the first assistant message
  await api.post(`/api/conversations/${conversationId}/messages`, {
    role: 'assistant',
    content: handoff,
    metadata: { isHandoff: true },
  })
}

/**
 * Format a doc-memory blob into a human-readable handoff message.
 * Keeps formatting defensive — any missing field degrades to a dash.
 */
function formatHandoff(summary: Record<string, unknown>, docTitle: string): string {
  const phase = (summary.phase as string) || '—'
  const tensions = Array.isArray(summary.activeTensions)
    ? (summary.activeTensions as Array<Record<string, unknown>>)
    : []
  const aiSections = Array.isArray(summary.aiSections)
    ? (summary.aiSections as Array<Record<string, unknown>>)
    : []
  const openQuestions = Array.isArray(summary.openQuestions)
    ? (summary.openQuestions as string[])
    : []

  const lines: string[] = []
  lines.push(`# Handoff: ${docTitle}`)
  lines.push('')
  lines.push(`**Current phase:** ${phase}`)
  lines.push('')

  if (tensions.length > 0) {
    lines.push('## Active tensions')
    for (const t of tensions) {
      const desc = (t.description as string) || 'Unnamed tension'
      const sev = (t.severity as string) || 'unknown'
      lines.push(`- (${sev}) ${desc}`)
    }
    lines.push('')
  }

  if (aiSections.length > 0) {
    lines.push('## AI-contributed sections')
    for (const s of aiSections) {
      const label = (s.section as string) || (s.title as string) || 'Section'
      lines.push(`- ${label}`)
    }
    lines.push('')
  }

  if (openQuestions.length > 0) {
    lines.push('## Open questions')
    for (const q of openQuestions) {
      lines.push(`- ${q}`)
    }
    lines.push('')
  }

  if (tensions.length === 0 && aiSections.length === 0 && openQuestions.length === 0) {
    lines.push('_Follow has not captured deeper context for this document yet._')
  }

  return lines.join('\n')
}

/** White-mode context sharing toggle */
function ContextToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-md px-2.5 py-1.5 transition-colors hover:bg-[var(--n50)]">
      <div>
        <p className="text-xs font-medium" style={{ color: 'var(--n700)' }}>
          {label}
        </p>
        <p className="text-[10px]" style={{ color: 'var(--n400)' }}>
          {description}
        </p>
      </div>
      <div
        className="h-5 w-8 shrink-0 rounded-full p-0.5 transition-colors"
        style={{ background: checked ? 'var(--n950, #0a0a0a)' : 'var(--n200, #e5e5e5)' }}
      >
        <div
          className="h-[14px] w-[14px] rounded-full bg-white transition-transform"
          style={{ transform: checked ? 'translateX(12px)' : 'translateX(0)' }}
        />
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="sr-only"
      />
    </label>
  )
}
