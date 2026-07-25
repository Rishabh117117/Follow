import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('Tab rename Prov → Memory (EXT-1)', () => {
  it('floating unit tabs include "Memory" not "Prov"', () => {
    const chatPanel = readFileSync(
      resolve(__dirname, '..', 'components', 'floating-unit', 'UnitChatPanel.tsx'),
      'utf-8'
    )
    expect(chatPanel).toContain("label: 'Memory'")
    expect(chatPanel).not.toContain("label: 'Prov'")
  })

  it('store type uses "memory" not "prov"', () => {
    const store = readFileSync(
      resolve(__dirname, '..', 'stores', 'floating-unit-store.ts'),
      'utf-8'
    )
    expect(store).toContain("'memory'")
    expect(store).not.toContain("'prov'")
  })
})
