import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock S3
vi.mock('../../../lib/s3', () => ({
  uploadBuffer: vi.fn().mockResolvedValue(undefined),
  downloadBuffer: vi.fn().mockResolvedValue(Buffer.from('file content')),
}))

// Mock DB
const mockInsert = vi.fn()
const mockSelect = vi.fn()
const mockValues = vi.fn()
const mockReturning = vi.fn()
const mockWhere = vi.fn()
const mockOrderBy = vi.fn()
const mockLimit = vi.fn()
const mockOffset = vi.fn()

vi.mock('../../../db/index', () => ({
  db: {
    insert: (...args: unknown[]) => {
      mockInsert(...args)
      return { values: mockValues }
    },
    select: (...args: unknown[]) => {
      mockSelect(...args)
      return {
        from: () => ({
          where: (...w: unknown[]) => {
            mockWhere(...w)
            return {
              orderBy: (...o: unknown[]) => {
                mockOrderBy(...o)
                return {
                  limit: (n: number) => {
                    mockLimit(n)
                    return []
                  },
                  offset: (n: number) => {
                    mockOffset(n)
                    return { limit: () => [] }
                  },
                }
              },
              limit: (n: number) => {
                mockLimit(n)
                return []
              },
            }
          },
        }),
      }
    },
  },
}))

import { extractText, normalizeMimeType } from '../store'

describe('Raw File Store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('extractText', () => {
    it('extracts text from text/* files', async () => {
      const buf = Buffer.from('Hello world')
      expect(await extractText(buf, 'text/plain')).toBe('Hello world')
    })

    it('extracts text from application/json', async () => {
      const buf = Buffer.from('{"key":"value"}')
      expect(await extractText(buf, 'application/json')).toBe('{"key":"value"}')
    })

    it('extracts text from application/javascript', async () => {
      const buf = Buffer.from('const x = 1')
      expect(await extractText(buf, 'application/javascript')).toBe('const x = 1')
    })

    it('extracts text from text/markdown', async () => {
      const buf = Buffer.from('# Title')
      expect(await extractText(buf, 'text/markdown')).toBe('# Title')
    })

    it('returns null for unsupported binary types', async () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff])
      expect(await extractText(buf, 'image/jpeg')).toBeNull()
    })

    it('returns null for malformed PDF (no text layer)', async () => {
      const buf = Buffer.from('%PDF-1.4')
      expect(await extractText(buf, 'application/pdf')).toBeNull()
    })

    it('extracts text from application/xml', async () => {
      const buf = Buffer.from('<root>data</root>')
      expect(await extractText(buf, 'application/xml')).toBe('<root>data</root>')
    })

    // MCP-FIX-2: Windows reports `.ts` as `video/mp2t` (MPEG Transport Stream).
    // The extension-based fallback in extractText must override that so
    // TypeScript source code gets indexed as text.
    it('extracts text from .ts file even when MIME is video/mp2t', async () => {
      const buf = Buffer.from('export const x: number = 1')
      expect(await extractText(buf, 'video/mp2t', 'foo.ts')).toBe('export const x: number = 1')
    })

    it('extracts text from .tsx file even when MIME is video/mp2t', async () => {
      const buf = Buffer.from('export const C = () => <div/>')
      expect(await extractText(buf, 'video/mp2t', 'foo.tsx')).toBe('export const C = () => <div/>')
    })

    it('extracts text when MIME is application/octet-stream but extension is text-like', async () => {
      const buf = Buffer.from('SELECT 1')
      expect(await extractText(buf, 'application/octet-stream', 'query.sql')).toBe('SELECT 1')
    })

    it('still returns null for genuinely binary files even with fileName arg', async () => {
      const buf = Buffer.from([0xff, 0xd8, 0xff])
      expect(await extractText(buf, 'image/jpeg', 'photo.jpg')).toBeNull()
    })
  })

  describe('normalizeMimeType (MCP-FIX-2)', () => {
    it('rewrites video/mp2t to text/typescript for .ts files', () => {
      expect(normalizeMimeType('video/mp2t', 'foo.ts')).toBe('text/typescript')
    })

    it('rewrites video/mp2t to text/typescript for .tsx files', () => {
      expect(normalizeMimeType('video/mp2t', 'foo.tsx')).toBe('text/typescript')
    })

    it('promotes application/octet-stream to a sensible text MIME for known extensions', () => {
      expect(normalizeMimeType('application/octet-stream', 'pkg.json')).toBe('application/json')
      expect(normalizeMimeType('application/octet-stream', 'main.js')).toBe('application/javascript')
      expect(normalizeMimeType('application/octet-stream', 'README.md')).toBe('text/markdown')
      expect(normalizeMimeType('application/octet-stream', 'config.yaml')).toBe('text/yaml')
      expect(normalizeMimeType('application/octet-stream', 'data.csv')).toBe('text/csv')
    })

    it('is idempotent for already-correct MIME types', () => {
      expect(normalizeMimeType('text/plain', 'notes.txt')).toBe('text/plain')
      expect(normalizeMimeType('application/json', 'pkg.json')).toBe('application/json')
      expect(normalizeMimeType('image/png', 'foo.png')).toBe('image/png')
    })

    it('preserves unknown binary MIME types', () => {
      expect(normalizeMimeType('image/jpeg', 'photo.jpg')).toBe('image/jpeg')
      expect(normalizeMimeType('application/pdf', 'doc.pdf')).toBe('application/pdf')
    })

    it('handles empty MIME with extension fallback', () => {
      expect(normalizeMimeType('', 'main.ts')).toBe('text/typescript')
      expect(normalizeMimeType('', 'README.md')).toBe('text/markdown')
    })

    it('returns the original MIME when no extension hint is provided', () => {
      expect(normalizeMimeType('video/mp2t')).toBe('video/mp2t')
    })
  })
})
