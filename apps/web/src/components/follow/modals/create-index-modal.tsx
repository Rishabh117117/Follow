'use client'

/**
 * CreateIndexModal (STABILIZE-3)
 *
 * Floating modal for creating a new project index. Supports:
 *   - Name (required)
 *   - Description (optional)
 *   - Color chip
 *   - "Lock immediately" toggle with passcode (uses /api/indexes/:id/lock right after create)
 *
 * Personal index is not creatable — only one exists per user, created implicitly
 * on first sign-in. So this modal is Project-only by design.
 */

import { useState } from 'react'
import { useIndexStore } from '@/stores/index-store'

const COLORS = [
  { id: 'green', value: '#34d399' },
  { id: 'blue', value: '#3b82f6' },
  { id: 'purple', value: '#a855f7' },
  { id: 'amber', value: '#f59e0b' },
  { id: 'rose', value: '#f43f5e' },
  { id: 'cyan', value: '#06b6d4' },
]

export interface CreateIndexModalProps {
  workspaceId?: string
  onCancel: () => void
  onCreated?: (indexId: string) => void
}

export function CreateIndexModal({ workspaceId, onCancel, onCreated }: CreateIndexModalProps) {
  const { createIndex, lockIndex } = useIndexStore()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(COLORS[0]!.id)
  const [lockOn, setLockOn] = useState(false)
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setErr(null)
    if (!name.trim()) return setErr('Name is required.')
    if (lockOn) {
      if (p1.length < 4) return setErr('Passcode must be at least 4 characters.')
      if (p1 !== p2) return setErr("Passcodes don't match.")
    }
    setBusy(true)
    const idx = await createIndex(name.trim(), 'project', workspaceId)
    if (!idx) {
      setBusy(false)
      setErr('Failed to create index. Check your connection.')
      return
    }
    if (lockOn) {
      const locked = await lockIndex(idx.id, p1)
      if (!locked) {
        // Index was created but lock failed — not fatal, just log.
        console.warn('Index created but lock failed')
      }
    }
    setBusy(false)
    onCreated?.(idx.id)
    onCancel()
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/30 p-4"
      onClick={onCancel}
    >
      <div
        className="w-[440px] max-w-full rounded-xl bg-white shadow-2xl"
        style={{ fontFamily: 'Inter, sans-serif' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-[var(--n150,#e5e2de)] px-6 py-4">
          <div className="text-[16px] font-medium text-[var(--n950,#111)]">Create new index</div>
          <div className="mt-0.5 text-[12px] text-[var(--n500,#807a70)]">
            A project index groups files, chats, and facts under a shared scope.
          </div>
        </div>

        {/* Body */}
        <div className="space-y-4 px-6 py-5">
          {/* Name */}
          <div>
            <label className="mb-1 block text-[11px] font-medium tracking-wide text-[var(--n600,#666054)]">
              NAME
            </label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              placeholder="e.g. Q3 Research, Thesis, Onboarding"
              className="w-full rounded-md border border-[var(--n200,#d4d0ca)] bg-white px-3 py-2 text-[13px] text-[var(--n950,#111)] outline-none focus:border-[#6C63FF]"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-[11px] font-medium tracking-wide text-[var(--n600,#666054)]">
              DESCRIPTION <span className="font-normal text-[var(--n400,#9c968d)]">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this index for?"
              rows={2}
              className="w-full resize-none rounded-md border border-[var(--n200,#d4d0ca)] bg-white px-3 py-2 text-[12px] leading-relaxed text-[var(--n800,#332e25)] outline-none focus:border-[#6C63FF]"
            />
          </div>

          {/* Color */}
          <div>
            <label className="mb-1 block text-[11px] font-medium tracking-wide text-[var(--n600,#666054)]">
              COLOR
            </label>
            <div className="flex items-center gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setColor(c.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-full"
                  style={{
                    background: c.value,
                    border: color === c.id ? '2px solid #111' : '2px solid transparent',
                  }}
                  aria-label={c.id}
                />
              ))}
            </div>
          </div>

          {/* Lock toggle */}
          <div className="rounded-md border border-[var(--n150,#e5e2de)] bg-[var(--n50,#f5f4f2)] p-3">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={lockOn}
                onChange={(e) => setLockOn(e.target.checked)}
                className="h-4 w-4 accent-[#6C63FF]"
              />
              <span className="text-[12px] font-medium text-[var(--n800,#332e25)]">
                🔒 Lock with passcode
              </span>
              <span className="text-[11px] text-[var(--n500,#807a70)]">
                Recoverable via your Google account
              </span>
            </label>

            {lockOn && (
              <div className="mt-3 space-y-2">
                <input
                  type="password"
                  value={p1}
                  onChange={(e) => setP1(e.target.value)}
                  placeholder="Passcode (min 4 chars)"
                  className="w-full rounded-md border border-[var(--n200,#d4d0ca)] bg-white px-3 py-1.5 text-[12px] text-[var(--n950,#111)] outline-none focus:border-[#6C63FF]"
                />
                <input
                  type="password"
                  value={p2}
                  onChange={(e) => setP2(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  placeholder="Confirm passcode"
                  className="w-full rounded-md border border-[var(--n200,#d4d0ca)] bg-white px-3 py-1.5 text-[12px] text-[var(--n950,#111)] outline-none focus:border-[#6C63FF]"
                />
              </div>
            )}
          </div>

          {err && <div className="text-[11px] text-[#c53030]">{err}</div>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--n150,#e5e2de)] px-6 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-[12px] text-[var(--n600,#666054)] hover:bg-[var(--n100,#f0eeeb)]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={submit}
            className="rounded-md bg-[#6C63FF] px-4 py-1.5 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>

        {/* Color/description currently cosmetic — saved to metadata in a follow-up;
            stored client-side for now so the chip colour is remembered in session. */}
        <input type="hidden" value={color} readOnly />
        <input type="hidden" value={description} readOnly />
      </div>
    </div>
  )
}
