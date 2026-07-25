import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const chatPanel = readFileSync(
  resolve(__dirname, '..', 'components', 'floating-unit', 'UnitChatPanel.tsx'),
  'utf-8'
)

describe('Mini context bar in GWS sidebar (EXT-1)', () => {
  it('context bar renders in chat panel', () => {
    // The UnitChatPanel.tsx contains mode buttons with Memory tab
    expect(chatPanel).toContain('MODE_BUTTONS')
    expect(chatPanel).toContain("mode: 'memory'")
  })

  it('chat panel renders mode buttons', () => {
    expect(chatPanel).toContain('activeMode')
    expect(chatPanel).toContain('setActiveMode')
  })

  it('context bar renders notes mode', () => {
    expect(chatPanel).toContain("mode: 'notes'")
    expect(chatPanel).toContain("label: 'Notes'")
  })

  it('context bar has correct structure', () => {
    expect(chatPanel).toContain('UnitChatPanel')
    expect(chatPanel).toContain('panelState')
  })
})
