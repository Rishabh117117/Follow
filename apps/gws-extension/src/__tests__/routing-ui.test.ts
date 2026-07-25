import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const chatPanel = readFileSync(
  resolve(__dirname, '..', 'components', 'floating-unit', 'UnitChatPanel.tsx'),
  'utf-8'
)

describe('Extension routing UI (Sprint CTX-2)', () => {
  it('renders routing label for directory queries', () => {
    expect(chatPanel).toContain('routing-indicator-label')
    expect(chatPanel).toContain("'Directory'")
    expect(chatPanel).toContain("'Index'")
  })

  it('renders contested indicator for contested topics', () => {
    expect(chatPanel).toContain('routing-indicator-contested')
    expect(chatPanel).toContain('Contested')
    expect(chatPanel).toContain('showing sources')
  })

  it('renders contributor names for directory results', () => {
    expect(chatPanel).toContain('routing-indicator-contributors')
    expect(chatPanel).toContain('contributors')
    expect(chatPanel).toMatch(/contributors\.map.*\.name/)
  })
})
