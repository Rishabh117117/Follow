/**
 * Prompting Pipeline — Orchestrates the trigger → card → display flow.
 *
 * Flow:
 *  1. TriggerMonitor detects an event
 *  2. UserProfiler checks if we should show a prompt
 *  3. CardGenerator creates a prompt card
 *  4. Pipeline broadcasts the card via WebSocket
 *  5. User responds → pipeline records response and updates profile
 */

import { onTrigger, type TriggerEvent } from './trigger-monitor'
import { generateCard, type PromptCard } from './card-generator'
import {
  shouldShowPrompt,
  isTriggerEnabled,
  recordPromptShown,
  recordPromptResponse,
} from './user-profiler'

// ─── Types ──────────────────────────────────────────────────────────

type CardDeliveryFn = (card: PromptCard) => void

// ─── State ──────────────────────────────────────────────────────────

const pendingCards = new Map<string, PromptCard[]>() // userId → cards
const deliveryCallbacks = new Map<string, CardDeliveryFn[]>() // userId → callbacks
let initialized = false

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Initialize the prompting pipeline.
 * Hooks into TriggerMonitor and starts processing.
 */
export function initPromptingPipeline(): void {
  if (initialized) return
  initialized = true

  onTrigger((event: TriggerEvent) => {
    processTriger(event)
  })

  console.info('[PromptPipeline] Initialized')
}

/**
 * Register a delivery callback for a user (e.g., WebSocket connection).
 * Returns an unsubscribe function.
 */
export function registerDelivery(
  workspaceId: string,
  userId: string,
  callback: CardDeliveryFn
): () => void {
  const key = `${workspaceId}:${userId}`
  const existing = deliveryCallbacks.get(key) ?? []
  existing.push(callback)
  deliveryCallbacks.set(key, existing)

  // Deliver any pending cards immediately
  const pending = pendingCards.get(key) ?? []
  for (const card of pending) {
    callback(card)
  }
  pendingCards.delete(key)

  return () => {
    const cbs = deliveryCallbacks.get(key) ?? []
    const idx = cbs.indexOf(callback)
    if (idx >= 0) cbs.splice(idx, 1)
  }
}

/**
 * Handle user response to a prompt card.
 */
export function handleCardResponse(
  workspaceId: string,
  userId: string,
  cardId: string,
  optionId: string,
  responseTimeMs: number
): { action: PromptCard['options'][0]['action'] | null } {
  // Find the card in pending or recent
  const key = `${workspaceId}:${userId}`
  const pending = pendingCards.get(key) ?? []
  const card = pending.find((c) => c.id === cardId)

  if (!card) {
    return { action: null }
  }

  const option = card.options.find((o) => o.id === optionId)

  // Record the response in the user profile
  recordPromptResponse(workspaceId, userId, card, optionId, responseTimeMs)

  // Remove the card from pending
  pendingCards.set(
    key,
    pending.filter((c) => c.id !== cardId)
  )

  return { action: option?.action ?? null }
}

/**
 * Get pending (undelivered) cards for a user.
 * Used for polling fallback when WebSocket isn't available.
 */
export function getPendingCards(workspaceId: string, userId: string): PromptCard[] {
  const key = `${workspaceId}:${userId}`
  return pendingCards.get(key) ?? []
}

/**
 * Dismiss all pending cards for a user.
 */
export function dismissAllCards(workspaceId: string, userId: string): void {
  const key = `${workspaceId}:${userId}`
  pendingCards.delete(key)
}

// ─── Internal ───────────────────────────────────────────────────────

function processTriger(event: TriggerEvent): void {
  const { workspaceId, userId } = event

  // 1. Check user profile — should we prompt?
  if (!shouldShowPrompt(workspaceId, userId)) return

  // 2. Check if this trigger kind is enabled
  if (!isTriggerEnabled(workspaceId, userId, event.kind)) return

  // 3. Generate a card
  const card = generateCard(event)
  if (!card) return

  // 4. Record that we showed a prompt
  recordPromptShown(workspaceId, userId)

  // 5. Deliver or queue
  const key = `${workspaceId}:${userId}`
  const callbacks = deliveryCallbacks.get(key) ?? []

  if (callbacks.length > 0) {
    // Deliver via WebSocket
    for (const cb of callbacks) {
      try {
        cb(card)
      } catch (err) {
        console.error('[PromptPipeline] Delivery error:', err)
      }
    }
  } else {
    // Queue for later delivery
    const pending = pendingCards.get(key) ?? []
    pending.push(card)

    // Limit pending queue
    if (pending.length > 5) {
      pending.splice(0, pending.length - 5)
    }

    pendingCards.set(key, pending)
  }
}
