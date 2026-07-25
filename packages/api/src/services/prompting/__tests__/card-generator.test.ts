import { describe, it, expect } from 'vitest'
import { generateCard, generateCardBatch } from '../card-generator'
import type { TriggerEvent } from '../trigger-monitor'

function makeTrigger(overrides: Partial<TriggerEvent>): TriggerEvent {
  return {
    kind: 'stuck_detection',
    workspaceId: 'ws-1',
    userId: 'user-1',
    confidence: 0.8,
    data: {},
    timestamp: new Date(),
    ...overrides,
  }
}

describe('CardGenerator', () => {
  describe('generateCard', () => {
    it('should generate stuck detection card (idle)', () => {
      const trigger = makeTrigger({
        kind: 'stuck_detection',
        data: { idleSeconds: 360, currentPage: '/workspace/ws-1/editor/doc-1', actionCount: 5 },
      })

      const card = generateCard(trigger)
      expect(card).not.toBeNull()
      expect(card!.triggerKind).toBe('stuck_detection')
      expect(card!.title).toBe('Need a hand?')
      expect(card!.options.length).toBe(3)
      expect(card!.priority).toBe(3)
    })

    it('should generate stuck detection card (looping)', () => {
      const trigger = makeTrigger({
        kind: 'stuck_detection',
        data: { loopingPages: ['/files', '/canvas'], visitCount: 6 },
      })

      const card = generateCard(trigger)
      expect(card).not.toBeNull()
      expect(card!.title).toBe('Looks like you might be stuck')
      expect(card!.priority).toBe(4)
    })

    it('should generate context switch card', () => {
      const trigger = makeTrigger({
        kind: 'context_switch',
        data: { recentContexts: ['files', 'canvas', 'timeline'], currentObjectType: 'timeline' },
      })

      const card = generateCard(trigger)
      expect(card).not.toBeNull()
      expect(card!.triggerKind).toBe('context_switch')
      expect(card!.questionType).toBe('single_select')
    })

    it('should generate new member card', () => {
      const trigger = makeTrigger({
        kind: 'new_member',
        confidence: 1.0,
        data: { memberName: 'Alice' },
      })

      const card = generateCard(trigger)
      expect(card).not.toBeNull()
      expect(card!.title).toContain('Alice')
      expect(card!.options.some((o) => o.id === 'onboard')).toBe(true)
    })

    it('should generate periodic insight card', () => {
      const trigger = makeTrigger({
        kind: 'periodic_insight',
        data: { summary: 'You were productive today!' },
      })

      const card = generateCard(trigger)
      expect(card).not.toBeNull()
      expect(card!.questionType).toBe('quick_action')
    })

    it('should generate dormant content card', () => {
      const trigger = makeTrigger({
        kind: 'dormant_content',
        data: {
          items: [
            { id: 'f1', name: 'old-doc.md', lastModified: new Date('2024-01-01') },
            { id: 'f2', name: 'draft.txt', lastModified: new Date('2024-02-01') },
          ],
        },
      })

      const card = generateCard(trigger)
      expect(card).not.toBeNull()
      expect(card!.questionType).toBe('multi_select')
      expect(card!.body).toContain('old-doc.md')
    })

    it('should generate completion card', () => {
      const trigger = makeTrigger({
        kind: 'completion_detected',
        data: { objectType: 'document', objectName: 'Q4 Report' },
      })

      const card = generateCard(trigger)
      expect(card).not.toBeNull()
      expect(card!.title).toContain('Nice work')
      expect(card!.body).toContain('Q4 Report')
    })

    it('should have unique IDs', () => {
      const t1 = makeTrigger({ kind: 'new_member', data: { memberName: 'A' } })
      const t2 = makeTrigger({ kind: 'new_member', data: { memberName: 'B' } })

      const c1 = generateCard(t1)
      const c2 = generateCard(t2)

      expect(c1!.id).not.toBe(c2!.id)
    })

    it('should set expiry to 30 minutes', () => {
      const trigger = makeTrigger({ kind: 'new_member', data: { memberName: 'A' } })
      const card = generateCard(trigger)

      expect(card!.expiresAt).not.toBeNull()
      const expiryMs = card!.expiresAt!.getTime() - card!.createdAt.getTime()
      expect(expiryMs).toBe(30 * 60 * 1000)
    })

    it('should include dismiss option in all cards', () => {
      const kinds = [
        'stuck_detection',
        'context_switch',
        'new_member',
        'periodic_insight',
        'completion_detected',
      ] as const

      for (const kind of kinds) {
        const trigger = makeTrigger({
          kind,
          data:
            kind === 'new_member'
              ? { memberName: 'A' }
              : kind === 'stuck_detection'
                ? { idleSeconds: 300, currentPage: '/x' }
                : {},
        })
        const card = generateCard(trigger)
        expect(card).not.toBeNull()
        const hasDismiss = card!.options.some((o) => o.action?.type === 'dismiss')
        expect(hasDismiss).toBe(true)
      }
    })
  })

  describe('generateCardBatch', () => {
    it('should sort by priority then confidence', () => {
      const triggers: TriggerEvent[] = [
        makeTrigger({
          kind: 'context_switch',
          confidence: 0.5,
          data: { recentContexts: ['a', 'b', 'c'] },
        }), // priority 2
        makeTrigger({ kind: 'new_member', confidence: 1.0, data: { memberName: 'A' } }), // priority 3
        makeTrigger({
          kind: 'stuck_detection',
          confidence: 0.9,
          data: { loopingPages: ['a', 'b'], visitCount: 6 },
        }), // priority 4
      ]

      const cards = generateCardBatch(triggers)
      expect(cards[0]!.priority).toBeGreaterThanOrEqual(cards[1]!.priority)
    })

    it('should limit to 3 cards', () => {
      const triggers = Array.from({ length: 5 }, (_, i) =>
        makeTrigger({
          kind: 'new_member',
          confidence: 0.5 + i * 0.1,
          data: { memberName: `User${i}` },
        })
      )

      const cards = generateCardBatch(triggers)
      expect(cards.length).toBeLessThanOrEqual(3)
    })
  })
})
