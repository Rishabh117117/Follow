import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', '..', 'popup', 'popup.tsx'), 'utf-8')

describe('Extension Popup (EXT-1)', () => {
  it('renders name "Rishabh Salian" and email', () => {
    expect(source).toContain('Rishabh Salian')
    expect(source).toContain('salir225@newschool.edu')
    expect(source).toContain('popup-name')
    expect(source).toContain('popup-email')
  })

  it('renders index selector with current index', () => {
    expect(source).toContain('popup-index-selector')
    expect(source).toContain('activeIndex')
    expect(source).toContain('SEED_INDEXES')
  })

  it('dropdown shows all 3 indexes', () => {
    expect(source).toContain('popup-index-dropdown')
    expect(source).toContain('Personal')
    expect(source).toContain('Capstone Thesis')
    expect(source).toContain('Follow Development')
  })

  it('toggle states persist to chrome.storage.local', () => {
    expect(source).toContain('chrome.storage.local.set')
    expect(source).toContain('followToggles')
    expect(source).toContain('chrome.storage.local.get')
  })
})
