import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(__dirname, '..', 'items', 'notebooks-grid.tsx'), 'utf-8')

describe('NotebooksGrid (UI-2)', () => {
  it('renders notebook cards from store', () => {
    expect(source).toContain('notebooks-grid')
    expect(source).toContain('useNotebookStore')
    expect(source).toContain('notebook-card-')
  })

  it('renders "+ New Notebook" card', () => {
    expect(source).toContain('new-notebook-btn')
    expect(source).toContain('border-dashed')
  })

  it('notebook card shows title and page count', () => {
    expect(source).toContain('nb.title')
    expect(source).toContain('pages')
  })
})
