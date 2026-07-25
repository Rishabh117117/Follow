import { describe, it, expect } from 'vitest'
import type { z } from 'zod'
import { mcpTools } from '../index'
import { FOLLOW_API_OPERATIONS } from '@workspace/shared/schemas'

/**
 * ADAPTER-1 drift guard. Asserts the shared FollowAPI request contract agrees
 * with the backend MCP tools' JSON-Schema `required` arrays. If the backend
 * (a tool) and the adapter (the shared schema) diverge on which fields are
 * mandatory, this fails.
 */

function requiredKeysOf(schema: z.AnyZodObject): string[] {
  return Object.entries(schema.shape)
    .filter(([, v]) => !(v as z.ZodTypeAny).isOptional())
    .map(([k]) => k)
    .sort()
}

const byName = new Map(mcpTools.map((t) => [t.name, t]))

describe('FollowAPI ⇄ MCP tool contract (ADAPTER-1)', () => {
  for (const [op, def] of Object.entries(FOLLOW_API_OPERATIONS)) {
    it(`${op} → ${def.tool}: backend tool exists and required fields match`, () => {
      const tool = byName.get(def.tool)
      expect(tool, `missing MCP tool ${def.tool} for FollowAPI.${op}`).toBeDefined()
      const inputSchema = (tool!.inputSchema ?? {}) as { required?: string[] }
      const toolRequired = [...(inputSchema.required ?? [])].sort()
      const sharedRequired = requiredKeysOf(def.request as unknown as z.AnyZodObject)
      expect(sharedRequired).toEqual(toolRequired)
    })
  }

  it('canonical requests validate; missing required fields are rejected', () => {
    const ops = FOLLOW_API_OPERATIONS
    expect(ops.setScope.request.safeParse({ project_id: 'p' }).success).toBe(true)
    expect(ops.setScope.request.safeParse({}).success).toBe(false)
    expect(ops.sendMessage.request.safeParse({ to: 'a', content: 'b' }).success).toBe(true)
    expect(ops.sendMessage.request.safeParse({ to: 'a' }).success).toBe(false)
    expect(ops.directoryQuery.request.safeParse({ topic: 't' }).success).toBe(true)
    expect(ops.directoryQuery.request.safeParse({}).success).toBe(false)
    expect(
      ops.saveConversation.request.safeParse({ messages: [], source_type: 'chat' }).success
    ).toBe(true)
    expect(ops.query.request.safeParse({}).success).toBe(true) // all-optional op
  })

  it('QuerySpec discriminated union accepts each of the five modes', () => {
    const specs = [
      { mode: 'point', target: 'x' },
      { mode: 'regional', region: 'pricing' },
      { mode: 'directional', from: 'a' },
      { mode: 'trajectory', from: 'a' },
      { mode: 'contrastive', a: 'x', b: 'y' },
    ]
    for (const spec of specs) {
      expect(FOLLOW_API_OPERATIONS.query.request.safeParse({ spec }).success).toBe(true)
    }
    // a bad discriminator is rejected
    expect(FOLLOW_API_OPERATIONS.query.request.safeParse({ spec: { mode: 'nope' } }).success).toBe(
      false
    )
  })
})
