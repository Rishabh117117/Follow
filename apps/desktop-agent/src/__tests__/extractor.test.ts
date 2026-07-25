import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { extractText, isTextExtractable } from '../extractor.js'

const TEST_DIR = join(tmpdir(), 'follow-agent-test-extractor')

function setup() {
  mkdirSync(TEST_DIR, { recursive: true })
}

function cleanup() {
  rmSync(TEST_DIR, { recursive: true, force: true })
}

function writeTemp(name: string, content: string | Buffer): string {
  const p = join(TEST_DIR, name)
  writeFileSync(p, content)
  return p
}

describe('Text Extractor', () => {
  beforeAll(() => setup())
  afterAll(() => cleanup())

  it('extracts text from .ts files', async () => {
    const p = writeTemp('test.ts', 'const x: number = 1')
    const text = await extractText(p, 'application/typescript')
    expect(text).toBe('const x: number = 1')
  })

  it('extracts text from .md files', async () => {
    const p = writeTemp('test.md', '# Hello\n\nWorld')
    const text = await extractText(p, 'text/markdown')
    expect(text).toBe('# Hello\n\nWorld')
  })

  it('extracts text from .json files', async () => {
    const p = writeTemp('test.json', '{"key":"value"}')
    const text = await extractText(p, 'application/json')
    expect(text).toBe('{"key":"value"}')
  })

  it('returns placeholder for PDF', async () => {
    const p = writeTemp('test.pdf', '%PDF-1.4 fake')
    const text = await extractText(p, 'application/pdf')
    expect(text).toContain('pdftotext')
  })

  it('returns placeholder for .docx', async () => {
    const p = writeTemp('test.docx', 'fake docx')
    const text = await extractText(p, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(text).toContain('Office file')
  })

  it('reads SVG as text', async () => {
    const p = writeTemp('test.svg', '<svg><rect/></svg>')
    const text = await extractText(p, 'image/svg+xml')
    expect(text).toBe('<svg><rect/></svg>')
  })

  it('returns empty for binary image files', async () => {
    const p = writeTemp('test.jpg', Buffer.from([0xff, 0xd8, 0xff]))
    const text = await extractText(p, 'image/jpeg')
    expect(text).toContain('Image file')
  })

  it('strips null bytes', async () => {
    const p = writeTemp('test.txt', 'hello\0world')
    const text = await extractText(p, 'text/plain')
    expect(text).toBe('helloworld')
  })

  it('normalizes line endings', async () => {
    const p = writeTemp('test.txt', 'line1\r\nline2\rline3')
    const text = await extractText(p, 'text/plain')
    expect(text).toBe('line1\nline2\nline3')
  })

  it('identifies text-extractable files', () => {
    expect(isTextExtractable('test.ts', 'application/typescript')).toBe(true)
    expect(isTextExtractable('test.md', 'text/markdown')).toBe(true)
    expect(isTextExtractable('test.jpg', 'image/jpeg')).toBe(false)
  })

})
