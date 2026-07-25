'use client'

/**
 * Passcode Dialog (Sprint FE-5)
 *
 * Modal for SH-1 passcode setup (first time) and unlock (returning).
 * On successful unlock, calls `onUnlocked(sessionToken)` so the caller
 * can stash the token in `useSharingStore.sessionToken`.
 *
 * After setup, auto-unlocks with the same passcode so the user has a
 * working session immediately.
 */

import { useState } from 'react'
import { api } from '@/lib/api-client'

export interface PasscodeDialogProps {
  isOpen: boolean
  onClose: () => void
  mode: 'setup' | 'unlock'
  onUnlocked?: (sessionToken: string, expiresAt: string | null) => void
}

interface UnlockResponse {
  sessionToken?: string
  expiresAt?: string
}

export function PasscodeDialog({ isOpen, onClose, mode, onUnlocked }: PasscodeDialogProps) {
  const [passcode, setPasscode] = useState('')
  const [confirmPasscode, setConfirmPasscode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (!isOpen) return null

  const reset = () => {
    setPasscode('')
    setConfirmPasscode('')
    setError('')
    setLoading(false)
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  const callUnlock = async (pc: string): Promise<UnlockResponse | null> => {
    const res = await api.post<UnlockResponse>('/api/sharing/passcode/unlock', { passcode: pc })
    if (res.error || !res.data?.sessionToken) {
      return null
    }
    return res.data
  }

  const handleSubmit = async () => {
    setError('')

    if (mode === 'setup') {
      if (passcode.length < 4) {
        setError('Passcode must be at least 4 characters')
        return
      }
      if (passcode !== confirmPasscode) {
        setError('Passcodes do not match')
        return
      }

      setLoading(true)
      try {
        const setupRes = await api.post<{ success: boolean }>('/api/sharing/passcode/setup', {
          passcode,
        })
        if (setupRes.error) {
          setError(setupRes.error.message ?? 'Setup failed')
          setLoading(false)
          return
        }
        // Auto-unlock with the just-set passcode
        const unlockData = await callUnlock(passcode)
        if (unlockData?.sessionToken) {
          onUnlocked?.(unlockData.sessionToken, unlockData.expiresAt ?? null)
        }
        handleClose()
      } catch {
        setError('Network error')
        setLoading(false)
      }
      return
    }

    // mode === 'unlock'
    if (!passcode) {
      setError('Enter your passcode')
      return
    }
    setLoading(true)
    try {
      const unlockData = await callUnlock(passcode)
      if (!unlockData?.sessionToken) {
        setError('Invalid passcode')
        setLoading(false)
        return
      }
      onUnlocked?.(unlockData.sessionToken, unlockData.expiresAt ?? null)
      handleClose()
    } catch {
      setError('Network error')
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      void handleSubmit()
    }
    if (e.key === 'Escape') {
      handleClose()
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="passcode-dialog-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.3)',
      }}
      onClick={handleClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: 12,
          padding: 28,
          width: 360,
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          id="passcode-dialog-title"
          style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: '#111' }}
        >
          {mode === 'setup' ? '🔐 Set Up Index Passcode' : '🔐 Unlock Your Index'}
        </div>
        <div style={{ fontSize: 12, color: '#777', marginBottom: 20, lineHeight: 1.5 }}>
          {mode === 'setup'
            ? 'Your passcode protects your AI index. Required before sharing context with collaborators.'
            : 'Enter your passcode to unlock your index for this session.'}
        </div>

        <input
          type="password"
          placeholder="Passcode"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          onKeyDown={handleKey}
          autoFocus
          style={{
            width: '100%',
            padding: '10px 12px',
            borderRadius: 8,
            border: '1px solid #E8E6E1',
            fontSize: 14,
            marginBottom: 10,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />

        {mode === 'setup' && (
          <input
            type="password"
            placeholder="Confirm passcode"
            value={confirmPasscode}
            onChange={(e) => setConfirmPasscode(e.target.value)}
            onKeyDown={handleKey}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #E8E6E1',
              fontSize: 14,
              marginBottom: 10,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        )}

        {error && (
          <div style={{ fontSize: 12, color: '#EF4444', marginBottom: 10 }} role="alert">
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button
            type="button"
            onClick={handleClose}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #E8E6E1',
              background: '#fff',
              fontSize: 13,
              color: '#777',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: 'none',
              background: '#111',
              color: '#fff',
              fontSize: 13,
              cursor: loading ? 'wait' : 'pointer',
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? '…' : mode === 'setup' ? 'Set Passcode' : 'Unlock'}
          </button>
        </div>
      </div>
    </div>
  )
}
