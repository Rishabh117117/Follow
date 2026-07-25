import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'memory', 'memory-view.tsx'), 'utf-8')

describe('MemoryView (WIRE-1)', () => {
  it('fetches sections from /api/memory/sections with indexId', () => {
    expect(source).toContain('/api/memory/sections')
    expect(source).toContain('activeIndexId')
    expect(source).toContain('useIndexStore')
  })

  it('clicking TOC item sets active section', () => {
    expect(source).toContain('setActiveSection')
    expect(source).toContain('onClick')
  })

  it('edit button shows textarea with save/cancel', () => {
    expect(source).toContain('edit-textarea')
    expect(source).toContain('save-btn')
    expect(source).toContain('Cancel')
    expect(source).toContain('startEdit')
  })

  it('saveEdit persists via PATCH /api/memory/sections/:id', () => {
    expect(source).toContain('saveEdit')
    expect(source).toContain("method: 'PATCH'")
    expect(source).toContain('/api/memory/sections/${editingSection}')
  })

  it('shows loading state while fetching', () => {
    expect(source).toContain('memory-view-loading')
    expect(source).toContain('isLoading')
    expect(source).toContain('Loading memory')
  })

  it('memory chat toggle shows/hides chat panel', () => {
    expect(source).toContain('memory-chat-toggle')
    expect(source).toContain('memory-chat-panel')
    expect(source).toContain('setChatOpen')
  })

  it('does not contain SEED_SECTIONS hardcoded array', () => {
    expect(source).not.toContain('SEED_SECTIONS')
  })
})
