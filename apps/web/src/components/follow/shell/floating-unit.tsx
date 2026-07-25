'use client'

import { useEffect, useCallback, useMemo } from 'react'
import { useFloatingUnitStore } from '@/stores/floating-unit-store'
import { useEditorLayoutStore } from '@/stores/editor-layout-store'
import { useKeyboardShortcutsStore } from '@/stores/keyboard-shortcuts-store'
import { useAIState } from '@/hooks/use-ai-state'
import { useNotifications } from '@/hooks/use-notifications'
import { usePromptCards } from '@/hooks/use-prompt-cards'
import { PromptCard } from '@/components/chat/prompt-card'
import { UnitChatPanel } from '@/components/follow/chat/unit-chat-panel'
import { ShortcutsHelpPanel } from '@/components/follow/common/shortcuts-help-panel'
import { FollowToastContainer } from '@/components/follow/notifications/follow-toast'
import { EntryWhisper } from '@/components/follow/notifications/entry-whisper'
import { DevModeButton } from '@/components/follow/shell/dev-mode-button'
import { OnboardingTooltip } from '@/components/follow/notifications/onboarding-tooltip'
import { NotificationDropdown } from '@/components/follow/notifications/notification-dropdown'

// E-3.1: trigger types we surface in Follow. Other kinds stay in the dev panel.
const FOLLOW_TRIGGER_KINDS = new Set(['stuck_detection', 'context_switch', 'completion_detected'])

interface FloatingUnitProps {
  workspaceId: string
}

export function FloatingUnit({ workspaceId }: FloatingUnitProps) {
  const { unitState, activeMode, restore, collapse, minimize, expand, setActiveMode, chatFileId } =
    useFloatingUnitStore()
  const {
    setRightPanelTab,
    setRightPanelOpen,
    toggleLeftPanel,
    toggleRightPanel,
    editorMode,
    setEditorMode,
  } = useEditorLayoutStore()

  // AI state for tension badge + entry whisper
  const { tensions, newFromTeam, hasUnsurfacedTeamUpdates, markTeamUpdateSurfaced } = useAIState(
    workspaceId,
    chatFileId || undefined
  )

  // Notifications
  const notifications = useNotifications(workspaceId)

  // E-3.1: Proactive cards — poll every 30s, surface the highest-priority
  // Follow-eligible card above the floating unit. Respects 15-min cooldown
  // inherited from user-profiler (enforced server-side).
  const { cards, dismissCard } = usePromptCards({ workspaceId, enabled: !!workspaceId })
  const activePromptCard = useMemo(() => {
    const eligible = cards.filter((c) => FOLLOW_TRIGGER_KINDS.has(c.triggerKind))
    if (eligible.length === 0) return null
    // highest priority wins (ties broken by newest)
    return [...eligible].sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    })[0]
  }, [cards])

  const handleCardAction = useCallback(
    (action: { type: string; payload: Record<string, unknown> }) => {
      // The card's configured action decides what happens. For the three
      // Follow triggers we expect `start_chat` with a pre-filled prompt.
      if (action.type === 'start_chat') {
        const prompt = typeof action.payload?.prompt === 'string' ? action.payload.prompt : ''
        useFloatingUnitStore.getState().expand()
        if (prompt) {
          // Broadcast prompt fill — UnitChatPanel listens for this event.
          window.dispatchEvent(new CustomEvent('follow-prefill-chat', { detail: { prompt } }))
        }
      }
    },
    []
  )

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey

      // Cmd+J / Ctrl+J — toggle collapsed/expanded
      if (mod && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        if (unitState === 'collapsed') {
          expand()
        } else if (unitState === 'expanded') {
          collapse()
        } else if (unitState === 'dot') {
          restore()
        }
      }

      // Cmd+/ — toggle keyboard shortcuts help
      if (mod && e.key === '/') {
        e.preventDefault()
        useKeyboardShortcutsStore.getState().toggleHelp()
      }

      // Cmd+Shift+N — switch right panel to Notes tab
      if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setRightPanelTab('notes')
        setRightPanelOpen(true)
      }

      // Cmd+Shift+P — switch right panel to Prov tab
      if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setRightPanelTab('prov')
        setRightPanelOpen(true)
      }

      // Cmd+Shift+I — toggle Canvas/Focus mode
      if (mod && e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        setEditorMode(editorMode === 'canvas' ? 'focus' : 'canvas')
      }

      // Cmd+\ — toggle left panel
      if (mod && e.key === '\\') {
        e.preventDefault()
        toggleLeftPanel()
      }

      // Cmd+] — toggle right panel
      if (mod && e.key === ']') {
        e.preventDefault()
        toggleRightPanel()
      }

      // Escape — collapse or minimize
      if (e.key === 'Escape') {
        const target = e.target as Element | null
        if (target && typeof target.closest === 'function') {
          if (target.closest('.ProseMirror') || target.closest('.floating-unit-input')) {
            return
          }
        }
        if (unitState === 'expanded') {
          collapse()
        } else if (unitState === 'collapsed') {
          minimize()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    unitState,
    activeMode,
    editorMode,
    expand,
    collapse,
    minimize,
    restore,
    setActiveMode,
    setRightPanelTab,
    setRightPanelOpen,
    setEditorMode,
    toggleLeftPanel,
    toggleRightPanel,
  ])

  // Persistent overlays (rendered in all states)
  const overlays = (
    <>
      <ShortcutsHelpPanel />
      <FollowToastContainer />
      <OnboardingTooltip />
      {notifications.isOpen && (
        <NotificationDropdown
          items={notifications.notifications}
          unreadCount={notifications.unreadCount}
          onClose={notifications.close}
          onMarkRead={notifications.markRead}
          onMarkAllRead={notifications.markAllRead}
        />
      )}
    </>
  )

  // E-3.2: Amber pulse when medium+ severity tension exists
  const tensionPulseSeverity = tensions.find(
    (t) => !t.tentative && (t.severity === 'medium' || t.severity === 'high')
  )?.severity

  // Dot state — minimal 38px circle with scale-in animation
  if (unitState === 'dot') {
    return (
      <>
        <div className="fixed bottom-4 right-4 z-50">
          {tensionPulseSeverity && (
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 animate-ping rounded-full"
              style={{
                background:
                  tensionPulseSeverity === 'high'
                    ? 'rgba(220,38,38,0.28)'
                    : 'rgba(245,158,11,0.28)',
              }}
            />
          )}
          <button
            onClick={(e) => {
              if (notifications.unreadCount > 0 && !e.shiftKey) {
                notifications.toggleOpen()
              } else {
                restore()
              }
            }}
            className="relative flex h-[38px] w-[38px] animate-[scaleIn_200ms_ease-out] items-center justify-center rounded-full text-white shadow-lg transition-transform hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
            style={{ background: '#6366F1', boxShadow: '0 4px 12px rgba(99,102,241,0.4)' }}
            aria-label={
              notifications.unreadCount > 0
                ? `Open Follow chat (${notifications.unreadCount} unread notifications)`
                : 'Open Follow chat'
            }
            title={
              notifications.unreadCount > 0
                ? `${notifications.unreadCount} unread notifications (Shift+click to restore unit)`
                : 'Restore AI unit (Cmd+J)'
            }
          >
            <span className="text-sm font-bold">F</span>
            {notifications.unreadCount > 0 && (
              <span
                className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-bold text-white"
                style={{ background: '#EF4444', boxShadow: '0 0 0 2px white' }}
                aria-label={`${notifications.unreadCount} unread notifications`}
              >
                {notifications.unreadCount > 9 ? '9+' : notifications.unreadCount}
              </span>
            )}
          </button>
        </div>
        <DevModeButton position="dot" />
        {overlays}
      </>
    )
  }

  // Non-dot states — unified panel always renders.
  // Provenance and Notes panels now live in the right panel (D2), no more slide-in overlays.
  return (
    <div style={{ position: 'relative' }}>
      {/* Entry Whisper — ambient notification above floating unit */}
      {hasUnsurfacedTeamUpdates && (
        <EntryWhisper
          items={newFromTeam.filter((m) => !m.surfaced)}
          onDismiss={markTeamUpdateSurfaced}
        />
      )}

      {/* E-3.1 Proactive card slot — renders above the unit, max 1 at a time */}
      {activePromptCard && (
        <div
          className="fixed left-1/2 z-[60] w-[min(440px,92vw)] -translate-x-1/2"
          style={{ bottom: 'calc(var(--unit-height, 110px) + 16px)' }}
        >
          <PromptCard
            card={activePromptCard}
            workspaceId={workspaceId}
            variant="toast"
            onAction={handleCardAction}
            onDismiss={() => dismissCard(activePromptCard.id)}
          />
        </div>
      )}

      {/* Unified chat panel — always present, manages its own expand/collapse */}
      <UnitChatPanel workspaceId={workspaceId} />

      <DevModeButton position={unitState === 'expanded' ? 'expanded' : 'collapsed'} />
      {overlays}
    </div>
  )
}
