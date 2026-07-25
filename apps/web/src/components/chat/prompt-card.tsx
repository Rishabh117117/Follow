'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { api } from '@/lib/api-client'

// ─── Types ──────────────────────────────────────────────────────────

interface CardAction {
  type: 'navigate' | 'create_file' | 'start_chat' | 'run_agent' | 'dismiss'
  payload: Record<string, unknown>
}

interface PromptCardOption {
  id: string
  label: string
  description: string
  icon?: string
  action?: CardAction
}

export interface PromptCardData {
  id: string
  workspaceId: string
  userId: string
  triggerKind: string
  questionType:
    | 'single_select'
    | 'multi_select'
    | 'comparison'
    | 'quick_action'
    | 'free_text'
    | 'confirmation'
  title: string
  body: string
  explanation: string | null
  options: PromptCardOption[]
  confidence: number
  priority: number
  expiresAt: string | null
  createdAt: string
}

interface PromptCardProps {
  card: PromptCardData
  workspaceId: string
  onAction?: (action: CardAction) => void
  onDismiss?: () => void
  variant?: 'inline' | 'toast' | 'panel'
}

// ─── Component ──────────────────────────────────────────────────────

export function PromptCard({
  card,
  workspaceId,
  onAction,
  onDismiss,
  variant = 'inline',
}: PromptCardProps) {
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set())
  const [isResponding, setIsResponding] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const shownAtRef = useRef(Date.now())

  // Check for expiry
  useEffect(() => {
    if (!card.expiresAt) return
    const expiresMs = new Date(card.expiresAt).getTime() - Date.now()
    if (expiresMs <= 0) {
      setDismissed(true)
      return
    }
    const timer = setTimeout(() => setDismissed(true), expiresMs)
    return () => clearTimeout(timer)
  }, [card.expiresAt])

  const handleOptionClick = useCallback(
    async (option: PromptCardOption) => {
      if (isResponding) return

      // For multi-select, toggle the option
      if (card.questionType === 'multi_select') {
        setSelectedOptions((prev) => {
          const next = new Set(prev)
          if (next.has(option.id)) {
            next.delete(option.id)
          } else {
            next.add(option.id)
          }
          return next
        })
        return
      }

      // For other types, respond immediately
      await respond(option)
    },
    [isResponding, card.questionType]
  )

  const handleMultiSelectConfirm = useCallback(async () => {
    if (selectedOptions.size === 0) return
    const firstSelected = card.options.find((o) => selectedOptions.has(o.id))
    if (firstSelected) {
      await respond(firstSelected)
    }
  }, [selectedOptions, card.options])

  const respond = async (option: PromptCardOption) => {
    setIsResponding(true)
    const responseTimeMs = Date.now() - shownAtRef.current

    try {
      await api.post(`/api/prompting/cards/respond?workspaceId=${workspaceId}`, {
        cardId: card.id,
        optionId: option.id,
        responseTimeMs,
      })

      if (option.action?.type === 'dismiss') {
        setDismissed(true)
        onDismiss?.()
      } else if (option.action) {
        onAction?.(option.action)
      }
    } catch (err) {
      console.error('[PromptCard] Response error:', err)
    } finally {
      setIsResponding(false)
    }
  }

  if (dismissed) return null

  const isToast = variant === 'toast'
  const isPanel = variant === 'panel'

  return (
    <div
      className={`overflow-hidden rounded-xl border transition-all duration-300 ${isToast ? 'border-violet-500/30 bg-zinc-900 shadow-xl shadow-violet-500/5' : ''} ${isPanel ? 'border-zinc-700/50 bg-zinc-900/80' : ''} ${!isToast && !isPanel ? 'border-zinc-800/50 bg-zinc-900/50' : ''} `}
    >
      {/* Header */}
      <div className="flex items-start justify-between px-4 pb-1 pt-3">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/10 text-sm">
            {'\u2728'}
          </div>
          <h4 className="text-sm font-semibold text-zinc-100">{card.title}</h4>
        </div>
        <button
          onClick={() => {
            setDismissed(true)
            onDismiss?.()
          }}
          className="rounded p-0.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-400"
        >
          {'\u2715'}
        </button>
      </div>

      {/* Body */}
      <p className="px-4 py-1.5 text-xs leading-relaxed text-zinc-400">{card.body}</p>

      {/* Explanation */}
      {card.explanation && (
        <div className="mx-4 mb-2 rounded-md bg-zinc-800/50 px-2.5 py-1.5 text-[10px] text-zinc-500">
          {card.explanation}
        </div>
      )}

      {/* Options */}
      <div className="space-y-1.5 px-4 pb-3">
        {card.options.map((option) => {
          const isSelected = selectedOptions.has(option.id)
          const isDismissOption = option.action?.type === 'dismiss'

          return (
            <button
              key={option.id}
              onClick={() => handleOptionClick(option)}
              disabled={isResponding}
              className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-all ${isSelected ? 'border-violet-500/50 bg-violet-500/10' : 'border-zinc-800/50 bg-zinc-950/50'} ${isDismissOption ? 'opacity-60' : ''} hover:border-zinc-700 hover:bg-zinc-800/50 disabled:opacity-40`}
            >
              {option.icon && <span className="text-sm">{option.icon}</span>}
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium text-zinc-200">{option.label}</div>
                <div className="text-[10px] text-zinc-500">{option.description}</div>
              </div>
              {card.questionType === 'multi_select' && (
                <div
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    isSelected ? 'border-violet-500 bg-violet-500 text-white' : 'border-zinc-700'
                  }`}
                >
                  {isSelected && '\u2713'}
                </div>
              )}
            </button>
          )
        })}

        {/* Multi-select confirm button */}
        {card.questionType === 'multi_select' && selectedOptions.size > 0 && (
          <button
            onClick={handleMultiSelectConfirm}
            disabled={isResponding}
            className="mt-1 w-full rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-40"
          >
            {isResponding ? 'Processing...' : `Confirm (${selectedOptions.size} selected)`}
          </button>
        )}
      </div>

      {/* Confidence indicator */}
      {card.confidence < 0.7 && (
        <div className="border-t border-zinc-800/30 px-4 py-1.5">
          <div className="flex items-center gap-1.5 text-[9px] text-zinc-600">
            <div className="h-1 w-8 rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-violet-500/50"
                style={{ width: `${Math.round(card.confidence * 100)}%` }}
              />
            </div>
            <span>Relevance: {Math.round(card.confidence * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Toast Container ────────────────────────────────────────────────

interface PromptToastContainerProps {
  cards: PromptCardData[]
  workspaceId: string
  onAction?: (action: CardAction) => void
  onDismiss?: (cardId: string) => void
}

export function PromptToastContainer({
  cards,
  workspaceId,
  onAction,
  onDismiss,
}: PromptToastContainerProps) {
  if (cards.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[340px] flex-col gap-2">
      {cards.slice(0, 3).map((card) => (
        <div key={card.id} className="animate-in slide-in-from-right">
          <PromptCard
            card={card}
            workspaceId={workspaceId}
            variant="toast"
            onAction={onAction}
            onDismiss={() => onDismiss?.(card.id)}
          />
        </div>
      ))}
    </div>
  )
}
