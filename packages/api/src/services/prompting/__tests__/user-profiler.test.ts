import { describe, it, expect, beforeEach } from 'vitest'
import {
  getProfile,
  recordPromptShown,
  recordPromptResponse,
  learnFact,
  updateExpertise,
  shouldShowPrompt,
  isTriggerEnabled,
  updatePreferences,
} from '../user-profiler'
import type { PromptCard } from '../card-generator'

const workspaceId = 'ws-1'
const userId = 'user-1'

function makeCard(overrides?: Partial<PromptCard>): PromptCard {
  return {
    id: 'card-1',
    workspaceId,
    userId,
    triggerKind: 'stuck_detection',
    questionType: 'single_select',
    title: 'Test',
    body: 'Test body',
    explanation: null,
    options: [
      {
        id: 'opt-1',
        label: 'Help',
        description: 'Get help',
        action: { type: 'start_chat', payload: {} },
      },
      {
        id: 'dismiss',
        label: 'Skip',
        description: 'Dismiss',
        action: { type: 'dismiss', payload: {} },
      },
    ],
    confidence: 0.8,
    priority: 3,
    expiresAt: null,
    createdAt: new Date(),
    metadata: {},
    ...overrides,
  }
}

describe('UserProfiler', () => {
  beforeEach(() => {
    // Reset by getting a fresh profile (will create default)
    // Note: In production, we'd use a DB reset. Here in-memory state persists.
    // We use unique IDs per test to avoid interference.
  })

  describe('getProfile', () => {
    it('should create default profile for new user', () => {
      const profile = getProfile('ws-unique-1', 'user-unique-1')
      expect(profile.userId).toBe('user-unique-1')
      expect(profile.workspaceId).toBe('ws-unique-1')
      expect(profile.totalPromptsShown).toBe(0)
      expect(profile.promptPreferences.maxPromptsPerHour).toBe(3)
      expect(profile.interactionStyle.prefersQuickActions).toBe(0.5)
    })

    it('should return same profile on subsequent calls', () => {
      const p1 = getProfile('ws-same', 'user-same')
      const p2 = getProfile('ws-same', 'user-same')
      expect(p1).toBe(p2)
    })
  })

  describe('recordPromptShown', () => {
    it('should increment shown counter', () => {
      const ws = 'ws-shown'
      const u = 'user-shown'
      recordPromptShown(ws, u)
      recordPromptShown(ws, u)
      const profile = getProfile(ws, u)
      expect(profile.totalPromptsShown).toBe(2)
    })
  })

  describe('recordPromptResponse', () => {
    it('should increment answered counter for non-dismiss', () => {
      const ws = 'ws-resp'
      const u = 'user-resp'
      const card = makeCard()
      recordPromptResponse(ws, u, card, 'opt-1', 3000)

      const profile = getProfile(ws, u)
      expect(profile.totalPromptsAnswered).toBe(1)
      expect(profile.totalPromptsDismissed).toBe(0)
    })

    it('should increment dismissed counter for dismiss', () => {
      const ws = 'ws-dismiss'
      const u = 'user-dismiss'
      const card = makeCard()
      recordPromptResponse(ws, u, card, 'dismiss', 1000)

      const profile = getProfile(ws, u)
      expect(profile.totalPromptsDismissed).toBe(1)
      expect(profile.totalPromptsAnswered).toBe(0)
    })

    it('should track response history', () => {
      const ws = 'ws-history'
      const u = 'user-history'
      const card = makeCard()
      recordPromptResponse(ws, u, card, 'opt-1', 2000)

      const profile = getProfile(ws, u)
      expect(profile.responseHistory.length).toBe(1)
      expect(profile.responseHistory[0]!.optionChosen).toBe('opt-1')
      expect(profile.responseHistory[0]!.responseTimeMs).toBe(2000)
    })
  })

  describe('learnFact', () => {
    it('should add new facts', () => {
      const ws = 'ws-fact'
      const u = 'user-fact'
      learnFact(ws, u, 'role', 'frontend developer', 'prompt_response', 0.9)

      const profile = getProfile(ws, u)
      expect(profile.knownFacts.length).toBe(1)
      expect(profile.knownFacts[0]!.key).toBe('role')
      expect(profile.knownFacts[0]!.value).toBe('frontend developer')
    })

    it('should update existing facts with higher confidence', () => {
      const ws = 'ws-fact-update'
      const u = 'user-fact-update'
      learnFact(ws, u, 'role', 'developer', 'inferred', 0.5)
      learnFact(ws, u, 'role', 'frontend developer', 'prompt_response', 0.9)

      const profile = getProfile(ws, u)
      expect(profile.knownFacts.length).toBe(1)
      expect(profile.knownFacts[0]!.value).toBe('frontend developer')
      expect(profile.knownFacts[0]!.confidence).toBe(0.9)
    })
  })

  describe('updateExpertise', () => {
    it('should set expertise areas', () => {
      const ws = 'ws-exp'
      const u = 'user-exp'
      updateExpertise(ws, u, 'frontend', 0.3)
      updateExpertise(ws, u, 'backend', 0.6)

      const profile = getProfile(ws, u)
      expect(profile.expertiseAreas['frontend']).toBe(0.3)
      expect(profile.expertiseAreas['backend']).toBe(0.6)
    })

    it('should clamp to 0-1 range', () => {
      const ws = 'ws-clamp'
      const u = 'user-clamp'
      updateExpertise(ws, u, 'area', 1.5)
      const profile = getProfile(ws, u)
      expect(profile.expertiseAreas['area']).toBe(1)

      updateExpertise(ws, u, 'area', -5)
      expect(profile.expertiseAreas['area']).toBe(0)
    })
  })

  describe('shouldShowPrompt', () => {
    it('should return true for fresh users', () => {
      expect(shouldShowPrompt('ws-fresh', 'user-fresh')).toBe(true)
    })

    it('should return false when dismiss rate is too high', () => {
      const ws = 'ws-fatigue'
      const u = 'user-fatigue'
      const profile = getProfile(ws, u)

      // Simulate high dismiss rate
      profile.totalPromptsShown = 20
      profile.totalPromptsDismissed = 16 // 80% dismiss rate

      expect(shouldShowPrompt(ws, u)).toBe(false)
    })
  })

  describe('isTriggerEnabled', () => {
    it('should return true by default', () => {
      expect(isTriggerEnabled('ws-enabled', 'user-enabled', 'stuck_detection')).toBe(true)
    })

    it('should return false for disabled triggers', () => {
      const ws = 'ws-disabled'
      const u = 'user-disabled'
      updatePreferences(ws, u, { disabledTriggers: ['stuck_detection'] })

      expect(isTriggerEnabled(ws, u, 'stuck_detection')).toBe(false)
      expect(isTriggerEnabled(ws, u, 'new_member')).toBe(true)
    })
  })

  describe('updatePreferences', () => {
    it('should update partial preferences', () => {
      const ws = 'ws-prefs'
      const u = 'user-prefs'
      updatePreferences(ws, u, { maxPromptsPerHour: 5, preferredDetailLevel: 'detailed' })

      const profile = getProfile(ws, u)
      expect(profile.promptPreferences.maxPromptsPerHour).toBe(5)
      expect(profile.promptPreferences.preferredDetailLevel).toBe('detailed')
      // Other defaults should remain
      expect(profile.promptPreferences.quietHoursStart).toBeNull()
    })
  })
})
