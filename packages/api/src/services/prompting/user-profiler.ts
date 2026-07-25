/**
 * UserProfiler — Progressively builds a profile of each user's
 * preferences, expertise areas, and interaction patterns to
 * make proactive prompts more relevant over time.
 *
 * Profile dimensions:
 *  - Expertise areas (e.g., "frontend", "data analysis", "design")
 *  - Prompt preferences (frequency, detail level, time-of-day)
 *  - Interaction style (prefers quick actions vs. deep dives)
 *  - Known facts (gathered from prompt responses and chat)
 */

import type { PromptCard } from './card-generator'

// ─── Types ──────────────────────────────────────────────────────────

export interface ProfileData {
  userId: string
  workspaceId: string
  expertiseAreas: Record<string, number> // area → confidence 0-1
  promptPreferences: PromptPreferences
  interactionStyle: InteractionStyle
  knownFacts: KnownFact[]
  responseHistory: ResponseStat[]
  totalPromptsShown: number
  totalPromptsAnswered: number
  totalPromptsDismissed: number
  lastUpdated: Date
}

export interface PromptPreferences {
  maxPromptsPerHour: number
  preferredDetailLevel: 'minimal' | 'standard' | 'detailed'
  quietHoursStart: number | null // Hour (0-23)
  quietHoursEnd: number | null
  disabledTriggers: string[] // Trigger kinds the user has opted out of
}

export interface InteractionStyle {
  prefersQuickActions: number // 0-1 (1 = always picks quick actions)
  prefersDeepDives: number
  averageResponseTimeMs: number
  prefersChatOverCards: number // 0-1
}

export interface KnownFact {
  key: string
  value: string
  source: 'prompt_response' | 'chat' | 'profile' | 'inferred'
  confidence: number
  learnedAt: Date
}

interface ResponseStat {
  triggerKind: string
  optionChosen: string
  wasQuickAction: boolean
  responseTimeMs: number
  timestamp: Date
}

// ─── In-memory profiles ─────────────────────────────────────────────

const profiles = new Map<string, ProfileData>()

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Get or create a user profile.
 */
export function getProfile(workspaceId: string, userId: string): ProfileData {
  const key = `${workspaceId}:${userId}`
  let profile = profiles.get(key)
  if (!profile) {
    profile = createDefaultProfile(workspaceId, userId)
    profiles.set(key, profile)
  }
  return profile
}

/**
 * Record that a prompt card was shown to the user.
 */
export function recordPromptShown(workspaceId: string, userId: string): void {
  const profile = getProfile(workspaceId, userId)
  profile.totalPromptsShown++
  profile.lastUpdated = new Date()
}

/**
 * Record the user's response to a prompt card.
 */
export function recordPromptResponse(
  workspaceId: string,
  userId: string,
  card: PromptCard,
  optionId: string,
  responseTimeMs: number
): void {
  const profile = getProfile(workspaceId, userId)
  const option = card.options.find((o) => o.id === optionId)
  const isDismiss = option?.action?.type === 'dismiss'

  if (isDismiss) {
    profile.totalPromptsDismissed++
  } else {
    profile.totalPromptsAnswered++
  }

  // Track response stats
  profile.responseHistory.push({
    triggerKind: card.triggerKind,
    optionChosen: optionId,
    wasQuickAction: card.questionType === 'quick_action',
    responseTimeMs,
    timestamp: new Date(),
  })

  // Keep last 100 responses
  if (profile.responseHistory.length > 100) {
    profile.responseHistory = profile.responseHistory.slice(-100)
  }

  // Update interaction style based on patterns
  updateInteractionStyle(profile)

  profile.lastUpdated = new Date()
}

/**
 * Learn a fact about the user from a prompt response or chat.
 */
export function learnFact(
  workspaceId: string,
  userId: string,
  key: string,
  value: string,
  source: KnownFact['source'] = 'inferred',
  confidence = 0.7
): void {
  const profile = getProfile(workspaceId, userId)

  // Update existing fact or add new one
  const existing = profile.knownFacts.find((f) => f.key === key)
  if (existing) {
    existing.value = value
    existing.confidence = Math.max(existing.confidence, confidence)
    existing.learnedAt = new Date()
    existing.source = source
  } else {
    profile.knownFacts.push({
      key,
      value,
      source,
      confidence,
      learnedAt: new Date(),
    })
  }

  // Keep only 50 most recent/confident facts
  if (profile.knownFacts.length > 50) {
    profile.knownFacts.sort((a, b) => b.confidence - a.confidence)
    profile.knownFacts = profile.knownFacts.slice(0, 50)
  }

  profile.lastUpdated = new Date()
}

/**
 * Update expertise areas based on user activity.
 */
export function updateExpertise(
  workspaceId: string,
  userId: string,
  area: string,
  delta: number
): void {
  const profile = getProfile(workspaceId, userId)
  const current = profile.expertiseAreas[area] ?? 0
  profile.expertiseAreas[area] = Math.max(0, Math.min(1, current + delta))
  profile.lastUpdated = new Date()
}

/**
 * Check if we should show a prompt to this user right now.
 */
export function shouldShowPrompt(workspaceId: string, userId: string): boolean {
  const profile = getProfile(workspaceId, userId)
  const prefs = profile.promptPreferences

  // Check quiet hours
  if (prefs.quietHoursStart !== null && prefs.quietHoursEnd !== null) {
    const hour = new Date().getHours()
    if (prefs.quietHoursStart < prefs.quietHoursEnd) {
      // e.g., 22-6 wraps around midnight
      if (hour >= prefs.quietHoursStart || hour < prefs.quietHoursEnd) return false
    } else {
      if (hour >= prefs.quietHoursStart && hour < prefs.quietHoursEnd) return false
    }
  }

  // Check rate limit — count prompts shown in the last hour
  const oneHourAgo = Date.now() - 60 * 60 * 1000
  const recentShown = profile.responseHistory.filter(
    (r) => r.timestamp.getTime() > oneHourAgo
  ).length

  if (recentShown >= prefs.maxPromptsPerHour) return false

  // Check if user is dismissing too many (fatigue detection)
  if (profile.totalPromptsShown > 10) {
    const dismissRate = profile.totalPromptsDismissed / profile.totalPromptsShown
    if (dismissRate > 0.7) return false // User is dismissing >70% — back off
  }

  return true
}

/**
 * Check if a specific trigger kind is enabled for this user.
 */
export function isTriggerEnabled(
  workspaceId: string,
  userId: string,
  triggerKind: string
): boolean {
  const profile = getProfile(workspaceId, userId)
  return !profile.promptPreferences.disabledTriggers.includes(triggerKind)
}

/**
 * Update user preferences.
 */
export function updatePreferences(
  workspaceId: string,
  userId: string,
  updates: Partial<PromptPreferences>
): void {
  const profile = getProfile(workspaceId, userId)
  profile.promptPreferences = { ...profile.promptPreferences, ...updates }
  profile.lastUpdated = new Date()
}

// ─── Internal ───────────────────────────────────────────────────────

function createDefaultProfile(workspaceId: string, userId: string): ProfileData {
  return {
    userId,
    workspaceId,
    expertiseAreas: {},
    promptPreferences: {
      maxPromptsPerHour: 3,
      preferredDetailLevel: 'standard',
      quietHoursStart: null,
      quietHoursEnd: null,
      disabledTriggers: [],
    },
    interactionStyle: {
      prefersQuickActions: 0.5,
      prefersDeepDives: 0.5,
      averageResponseTimeMs: 5000,
      prefersChatOverCards: 0.5,
    },
    knownFacts: [],
    responseHistory: [],
    totalPromptsShown: 0,
    totalPromptsAnswered: 0,
    totalPromptsDismissed: 0,
    lastUpdated: new Date(),
  }
}

function updateInteractionStyle(profile: ProfileData): void {
  const recent = profile.responseHistory.slice(-20)
  if (recent.length < 3) return

  // Calculate quick action preference
  const quickCount = recent.filter((r) => r.wasQuickAction).length
  profile.interactionStyle.prefersQuickActions = quickCount / recent.length

  // Calculate deep dive preference (based on choosing deep-dive or research options)
  const deepDiveCount = recent.filter(
    (r) => r.optionChosen.includes('deep-dive') || r.optionChosen.includes('research')
  ).length
  profile.interactionStyle.prefersDeepDives = deepDiveCount / recent.length

  // Update average response time
  const totalMs = recent.reduce((sum, r) => sum + r.responseTimeMs, 0)
  profile.interactionStyle.averageResponseTimeMs = totalMs / recent.length

  // Chat preference (based on choosing chat-related options)
  const chatCount = recent.filter(
    (r) => r.optionChosen.includes('chat') || r.optionChosen.includes('help')
  ).length
  profile.interactionStyle.prefersChatOverCards = chatCount / recent.length
}
