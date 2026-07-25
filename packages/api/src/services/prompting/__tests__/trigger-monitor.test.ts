import { describe, it, expect, beforeEach } from 'vitest'
import {
  ingestActivity,
  checkIdleUsers,
  fireNewMemberTrigger,
  firePeriodicInsight,
  fireDormantContent,
  fireCompletionDetected,
  getRecentTriggers,
  clearUserState,
  onTrigger,
  type TriggerEvent,
} from '../trigger-monitor'

describe('TriggerMonitor', () => {
  const workspaceId = 'ws-1'
  const userId = 'user-1'

  beforeEach(() => {
    clearUserState(workspaceId, userId)
  })

  describe('ingestActivity', () => {
    it('should track page visits', () => {
      ingestActivity({ userId, workspaceId, action: 'view', page: '/workspace/ws-1/files' })
      ingestActivity({ userId, workspaceId, action: 'view', page: '/workspace/ws-1/canvas' })

      // No triggers fired yet (need more activity for stuck/context switch)
      const triggers = getRecentTriggers(workspaceId, userId)
      expect(triggers.length).toBe(0)
    })

    it('should detect page looping (stuck)', () => {
      const triggers: TriggerEvent[] = []
      const unsub = onTrigger((e) => triggers.push(e))

      // Simulate looping between 2 pages
      for (let i = 0; i < 6; i++) {
        ingestActivity({
          userId,
          workspaceId,
          action: 'view',
          page: i % 2 === 0 ? '/workspace/ws-1/files' : '/workspace/ws-1/canvas',
        })
      }

      // Should have fired a stuck_detection trigger
      const stuckTriggers = triggers.filter((t) => t.kind === 'stuck_detection')
      expect(stuckTriggers.length).toBeGreaterThanOrEqual(1)

      unsub()
    })

    it('should detect context switching', () => {
      const triggers: TriggerEvent[] = []
      const unsub = onTrigger((e) => triggers.push(e))

      // Visit many different areas quickly
      ingestActivity({
        userId,
        workspaceId,
        action: 'view',
        page: '/workspace/ws-1/files',
        objectType: 'file',
      })
      ingestActivity({
        userId,
        workspaceId,
        action: 'view',
        page: '/workspace/ws-1/canvas',
        objectType: 'canvas',
      })
      ingestActivity({
        userId,
        workspaceId,
        action: 'view',
        page: '/workspace/ws-1/timeline',
        objectType: 'timeline',
      })

      const contextSwitchTriggers = triggers.filter((t) => t.kind === 'context_switch')
      expect(contextSwitchTriggers.length).toBeGreaterThanOrEqual(1)

      unsub()
    })
  })

  describe('checkIdleUsers', () => {
    it('should fire idle trigger for inactive users', () => {
      const triggers: TriggerEvent[] = []
      const unsub = onTrigger((e) => triggers.push(e))

      // Simulate user activity that happened 6 minutes ago
      ingestActivity({ userId, workspaceId, action: 'view', page: '/workspace/ws-1/editor/doc-1' })

      // Manually set the last activity to 6 minutes ago
      // We need to clear and re-trigger after manipulating time
      clearUserState(workspaceId, userId)

      // Use fake timers approach
      const realNow = Date.now
      let fakeNow = Date.now()
      Date.now = () => fakeNow

      ingestActivity({ userId, workspaceId, action: 'view', page: '/workspace/ws-1/editor/doc-1' })

      // Advance time by 6 minutes
      fakeNow += 6 * 60 * 1000
      checkIdleUsers()

      Date.now = realNow

      const idleTriggers = triggers.filter((t) => t.kind === 'stuck_detection')
      expect(idleTriggers.length).toBeGreaterThanOrEqual(1)

      unsub()
    })
  })

  describe('Manual triggers', () => {
    it('should fire new member trigger', () => {
      const triggers: TriggerEvent[] = []
      const unsub = onTrigger((e) => triggers.push(e))

      fireNewMemberTrigger(workspaceId, userId, 'Alice')

      expect(triggers.length).toBe(1)
      expect(triggers[0]!.kind).toBe('new_member')
      expect(triggers[0]!.confidence).toBe(1.0)
      expect(triggers[0]!.data['memberName']).toBe('Alice')

      unsub()
    })

    it('should fire periodic insight trigger', () => {
      const triggers: TriggerEvent[] = []
      const unsub = onTrigger((e) => triggers.push(e))

      firePeriodicInsight(workspaceId, userId, { summary: 'Good day!' })

      expect(triggers.length).toBe(1)
      expect(triggers[0]!.kind).toBe('periodic_insight')

      unsub()
    })

    it('should fire dormant content trigger', () => {
      const triggers: TriggerEvent[] = []
      const unsub = onTrigger((e) => triggers.push(e))

      fireDormantContent(workspaceId, userId, [
        { id: 'f1', name: 'old-doc.md', lastModified: new Date('2024-01-01') },
      ])

      expect(triggers.length).toBe(1)
      expect(triggers[0]!.kind).toBe('dormant_content')

      unsub()
    })

    it('should fire completion detected trigger', () => {
      const triggers: TriggerEvent[] = []
      const unsub = onTrigger((e) => triggers.push(e))

      fireCompletionDetected(workspaceId, userId, {
        objectType: 'document',
        objectName: 'Q4 Report',
      })

      expect(triggers.length).toBe(1)
      expect(triggers[0]!.kind).toBe('completion_detected')
      expect(triggers[0]!.data['objectName']).toBe('Q4 Report')

      unsub()
    })
  })

  describe('Cooldown', () => {
    it('should not re-fire same trigger within cooldown period', () => {
      const triggers: TriggerEvent[] = []
      const unsub = onTrigger((e) => triggers.push(e))

      fireNewMemberTrigger(workspaceId, userId, 'Alice')
      fireNewMemberTrigger(workspaceId, userId, 'Bob')

      // Second trigger should be blocked by cooldown
      expect(triggers.length).toBe(1)

      unsub()
    })
  })

  describe('Listener management', () => {
    it('should support unsubscribe', () => {
      const triggers: TriggerEvent[] = []
      const unsub = onTrigger((e) => triggers.push(e))

      fireNewMemberTrigger(workspaceId, userId, 'Alice')
      expect(triggers.length).toBe(1)

      unsub()

      // Clear cooldown by using different workspace
      fireNewMemberTrigger('ws-2', userId, 'Bob')
      expect(triggers.length).toBe(1) // Should not have received the second event
    })
  })
})
