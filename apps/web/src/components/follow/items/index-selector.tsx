'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useIndexStore, type FollowIndex } from '@/stores/index-store'
import { CreateIndexModal } from '@/components/follow/modals/create-index-modal'

type ModalState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'delete'; index: FollowIndex }
  | { kind: 'lock'; index: FollowIndex }
  | { kind: 'unlock'; index: FollowIndex }

const RECOVER_FLAG = 'follow.recover-index'

export function IndexSelector() {
  const {
    activeIndexId,
    indexes,
    dropdownOpen,
    setActiveIndex,
    toggleDropdown,
    fetchIndexes,
    deleteIndex,
    lockIndex,
    unlockIndex,
    recoverIndex,
  } = useIndexStore()
  const params = useParams<{ id?: string }>()
  const workspaceId = params?.id
  const [modal, setModal] = useState<ModalState>({ kind: 'none' })

  useEffect(() => {
    fetchIndexes()
  }, [fetchIndexes])

  // Complete a Google-recovery round-trip: if we flagged an index before
  // redirecting to Google sign-in, call /recover on return.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const pending = sessionStorage.getItem(RECOVER_FLAG)
    if (!pending) return
    sessionStorage.removeItem(RECOVER_FLAG)
    ;(async () => {
      const ok = await recoverIndex(pending)
      if (ok) fetchIndexes()
    })()
  }, [recoverIndex, fetchIndexes])

  const active = indexes.find((i) => i.id === activeIndexId)
  const activeLocked = active?.locked === true
  const dotColor = active?.type === 'personal' ? '#6C63FF' : '#34d399'

  const closeModal = () => setModal({ kind: 'none' })

  // Clicking a locked index opens the unlock modal instead of activating it.
  const clickRow = (idx: FollowIndex) => {
    if (idx.locked) {
      setModal({ kind: 'unlock', index: idx })
      return
    }
    setActiveIndex(idx.id)
  }

  return (
    <div className="relative px-3 pb-2">
      <button
        onClick={toggleDropdown}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-neutral-50"
        style={{ border: '1px solid var(--n150, #e5e5e5)' }}
        data-testid="index-selector-btn"
      >
        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: dotColor }} />
        <span
          className="flex-1 truncate text-left text-[13px] font-medium"
          style={{ color: 'var(--n800, #262626)' }}
        >
          {active?.name ?? 'Select Index'}
          {activeLocked && <span className="ml-1.5 text-[11px]">🔒</span>}
        </span>
        <span className="font-mono text-[10px]" style={{ color: 'var(--n400, #a3a3a3)' }}>
          {active ? `${active.facts}f · ${active.files}fi` : ''}
        </span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          style={{ color: 'var(--n400, #a3a3a3)' }}
        >
          <path d="M2 3.5L5 6.5L8 3.5" />
        </svg>
      </button>

      {dropdownOpen && (
        <div
          className="absolute left-3 right-3 top-full z-50 mt-1 rounded-lg border bg-white shadow-lg"
          style={{ borderColor: 'var(--n150, #e5e5e5)' }}
          data-testid="index-dropdown"
        >
          <button
            onClick={() => {
              toggleDropdown()
              setModal({ kind: 'create' })
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium transition-colors hover:bg-neutral-50"
            style={{ color: '#6C63FF' }}
          >
            + Create New Index
          </button>
          <div className="h-px" style={{ background: 'var(--n100, #f5f5f5)' }} />
          {indexes.map((idx) => {
            const isActive = idx.id === activeIndexId
            const isProject = idx.type === 'project'
            return (
              <div
                key={idx.id}
                className="group flex items-center gap-2 px-3 py-2 text-[12px]"
                style={{
                  background: isActive ? 'rgba(108,99,255,0.06)' : undefined,
                }}
              >
                {/* Selector body (clickable) */}
                <button
                  onClick={() => clickRow(idx)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  data-testid={`index-row-${idx.id}`}
                >
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full"
                    style={{ background: idx.type === 'personal' ? '#6C63FF' : '#34d399' }}
                  />
                  <span className="flex-1 truncate" style={{ color: 'var(--n700, #404040)' }}>
                    {idx.name}
                    {idx.locked && <span className="ml-1.5 text-[11px]">🔒</span>}
                  </span>
                  <span className="font-mono text-[10px]" style={{ color: 'var(--n400, #a3a3a3)' }}>
                    {idx.facts}f
                  </span>
                </button>

                {/* Action cluster — only for project indexes (personal can't be locked/deleted) */}
                {isProject && (
                  <div className="flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                    <button
                      title={idx.locked ? 'Already locked' : 'Lock this index'}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (idx.locked) return
                        setModal({ kind: 'lock', index: idx })
                      }}
                      className="rounded p-1 text-[11px] hover:bg-neutral-200"
                      style={{ color: idx.locked ? '#34d399' : 'var(--n400, #a3a3a3)' }}
                    >
                      {idx.locked ? '🔒' : '🔓'}
                    </button>
                    <button
                      title="Delete index"
                      onClick={(e) => {
                        e.stopPropagation()
                        setModal({ kind: 'delete', index: idx })
                      }}
                      className="rounded p-1 text-[11px] hover:bg-neutral-200"
                      style={{ color: 'var(--n400, #a3a3a3)' }}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Modals */}
      {modal.kind === 'create' && (
        <CreateIndexModal
          workspaceId={workspaceId}
          onCancel={closeModal}
          onCreated={(id) => {
            fetchIndexes()
            setActiveIndex(id)
          }}
        />
      )}
      {modal.kind === 'delete' && (
        <DeleteModal
          index={modal.index}
          onCancel={closeModal}
          onConfirm={async () => {
            const ok = await deleteIndex(modal.index.id)
            closeModal()
            if (ok) fetchIndexes()
          }}
        />
      )}
      {modal.kind === 'lock' && (
        <LockModal
          index={modal.index}
          onCancel={closeModal}
          onConfirm={async (passcode) => {
            const ok = await lockIndex(modal.index.id, passcode)
            if (ok) closeModal()
            return ok
          }}
        />
      )}
      {modal.kind === 'unlock' && (
        <UnlockModal
          index={modal.index}
          onCancel={closeModal}
          onUnlock={async (passcode) => {
            const res = await unlockIndex(modal.index.id, passcode)
            if (res.ok) {
              closeModal()
              setActiveIndex(modal.index.id)
            }
            return res
          }}
          onRecover={() => {
            sessionStorage.setItem(RECOVER_FLAG, modal.index.id)
            // Force a fresh Google sign-in round-trip. On return we clear the lock.
            void signIn('google', { callbackUrl: window.location.href })
          }}
        />
      )}
    </div>
  )
}

// ─── Modals ────────────────────────────────────────────────────────────

function ModalShell({
  title,
  children,
  onCancel,
}: {
  title: string
  children: React.ReactNode
  onCancel: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4"
      onClick={onCancel}
    >
      <div
        className="w-[360px] max-w-full rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-[14px] font-medium text-[var(--n950,#111)]">{title}</div>
        {children}
      </div>
    </div>
  )
}

function DeleteModal({
  index,
  onCancel,
  onConfirm,
}: {
  index: FollowIndex
  onCancel: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <ModalShell title={`Delete "${index.name}"?`} onCancel={onCancel}>
      <p className="mb-4 text-[12px] text-[var(--n600,#666)]">
        The index will be removed from your sidebar. Indexed facts, files, and chats scoped to it
        will be hidden. This can be undone by an admin for a short period.
      </p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-[12px]"
          style={{ color: 'var(--n600,#666)' }}
        >
          Cancel
        </button>
        <button
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await onConfirm()
            setBusy(false)
          }}
          className="rounded bg-red-600 px-3 py-1.5 text-[12px] text-white disabled:opacity-50"
        >
          {busy ? 'Deleting…' : 'Delete'}
        </button>
      </div>
    </ModalShell>
  )
}

function LockModal({
  index,
  onCancel,
  onConfirm,
}: {
  index: FollowIndex
  onCancel: () => void
  onConfirm: (passcode: string) => Promise<boolean>
}) {
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setErr(null)
    if (p1.length < 4) return setErr('Passcode must be at least 4 characters.')
    if (p1 !== p2) return setErr("Passcodes don't match.")
    setBusy(true)
    const ok = await onConfirm(p1)
    setBusy(false)
    if (!ok) setErr('Lock failed. Check your connection.')
  }
  return (
    <ModalShell title={`Lock "${index.name}"`} onCancel={onCancel}>
      <p className="mb-3 text-[12px] text-[var(--n600,#666)]">
        Set a passcode to lock this index. You&apos;ll need to enter it to open the index again. If
        you forget it, you can recover using the Google account that created the index.
      </p>
      <input
        autoFocus
        type="password"
        value={p1}
        onChange={(e) => setP1(e.target.value)}
        placeholder="Passcode (min 4 chars)"
        className="mb-2 w-full rounded border px-2 py-1.5 text-[12px]"
        style={{ borderColor: 'var(--n200,#e5e5e5)' }}
      />
      <input
        type="password"
        value={p2}
        onChange={(e) => setP2(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Confirm passcode"
        className="mb-2 w-full rounded border px-2 py-1.5 text-[12px]"
        style={{ borderColor: 'var(--n200,#e5e5e5)' }}
      />
      {err && <div className="mb-2 text-[11px] text-red-600">{err}</div>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded px-3 py-1.5 text-[12px]"
          style={{ color: 'var(--n600,#666)' }}
        >
          Cancel
        </button>
        <button
          disabled={busy}
          onClick={submit}
          className="rounded bg-[#6C63FF] px-3 py-1.5 text-[12px] text-white disabled:opacity-50"
        >
          {busy ? 'Locking…' : 'Lock'}
        </button>
      </div>
    </ModalShell>
  )
}

function UnlockModal({
  index,
  onCancel,
  onUnlock,
  onRecover,
}: {
  index: FollowIndex
  onCancel: () => void
  onUnlock: (
    passcode: string
  ) => Promise<
    { ok: true } | { ok: false; error: string; attemptsRemaining?: number; secondsLeft?: number }
  >
  onRecover: () => void
}) {
  const [p, setP] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [showRecover, setShowRecover] = useState(false)

  const submit = async () => {
    setErr(null)
    if (!p) return
    setBusy(true)
    const res = await onUnlock(p)
    setBusy(false)
    if (!res.ok) {
      setErr(res.error)
      if (typeof res.attemptsRemaining === 'number') {
        setAttemptsRemaining(res.attemptsRemaining)
        if (res.attemptsRemaining <= 2) setShowRecover(true)
      }
      if (typeof res.secondsLeft === 'number') setShowRecover(true)
    }
  }

  return (
    <ModalShell title={`Unlock "${index.name}"`} onCancel={onCancel}>
      <input
        autoFocus
        type="password"
        value={p}
        onChange={(e) => setP(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
        placeholder="Passcode"
        className="mb-2 w-full rounded border px-2 py-1.5 text-[12px]"
        style={{ borderColor: 'var(--n200,#e5e5e5)' }}
      />
      {err && (
        <div className="mb-2 text-[11px] text-red-600">
          {err}
          {attemptsRemaining !== null && attemptsRemaining > 0 && (
            <span className="ml-1 text-[var(--n500,#888)]">({attemptsRemaining} tries left)</span>
          )}
        </div>
      )}
      <div className="flex justify-between gap-2">
        <button
          onClick={() => (showRecover ? onRecover() : setShowRecover(true))}
          className="text-[11px] text-[var(--n500,#888)] hover:underline"
        >
          {showRecover ? 'Recover with Google →' : 'Forgot passcode?'}
        </button>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-[12px]"
            style={{ color: 'var(--n600,#666)' }}
          >
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={submit}
            className="rounded bg-[#6C63FF] px-3 py-1.5 text-[12px] text-white disabled:opacity-50"
          >
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}
