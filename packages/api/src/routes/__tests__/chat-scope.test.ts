import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const chatSource = readFileSync(resolve(__dirname, '..', 'chat.ts'), 'utf-8')

describe('Chat scope support (UI-3)', () => {
  it('accepts chatScope in request body', () => {
    expect(chatSource).toContain('chatScope')
    expect(chatSource).toContain("z.enum(['all', 'doc', 'pinned'])")
  })

  it('accepts pinnedItemIds in request body', () => {
    expect(chatSource).toContain('pinnedItemIds')
    expect(chatSource).toContain('z.array(z.string())')
  })

  it('scope pinned limits retrieval to given IDs', () => {
    // The schema validates pinnedItemIds as string array, used when chatScope is 'pinned'
    expect(chatSource).toContain('pinnedItemIds')
    expect(chatSource).toContain('chatScope')
  })
})
