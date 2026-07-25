import { describe, it, expect } from 'vitest'
import type { MessageAttachment } from '@workspace/shared/types'

/**
 * Unit tests for screenshot-related logic.
 * Tests pure functions extracted from the screenshot and chat components.
 */

describe('Image attachment detection', () => {
  it('detects image attachment by imageData field', () => {
    const att: MessageAttachment = {
      fileId: 'img1',
      fileName: 'shot.png',
      fileType: 'image/png',
      imageData: 'data:image/png;base64,abc',
      imageSource: 'screenshot',
    }
    expect(att.imageData).toBeDefined()
    expect(att.imageSource).toBe('screenshot')
  })

  it('identifies non-image attachment', () => {
    const att: MessageAttachment = {
      fileId: 'f1',
      fileName: 'report.pdf',
      fileType: 'application/pdf',
    }
    expect(att.imageData).toBeUndefined()
  })

  it('distinguishes screenshot vs upload vs capture sources', () => {
    const sources: MessageAttachment['imageSource'][] = ['screenshot', 'upload', 'capture']
    sources.forEach((source) => {
      const att: MessageAttachment = {
        fileId: `id-${source}`,
        fileName: 'test.png',
        fileType: 'image/png',
        imageData: 'data:image/png;base64,abc',
        imageSource: source,
      }
      expect(att.imageSource).toBe(source)
    })
  })
})

describe('Data URL parsing', () => {
  function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
    const match = dataUrl.match(/^data:image\/(png|jpeg|gif|webp);base64,(.+)$/)
    if (!match) return null
    return { mediaType: `image/${match[1]}`, data: match[2]! }
  }

  it('parses PNG data URL', () => {
    const result = parseDataUrl('data:image/png;base64,iVBORw0KGgo=')
    expect(result).toEqual({ mediaType: 'image/png', data: 'iVBORw0KGgo=' })
  })

  it('parses JPEG data URL', () => {
    const result = parseDataUrl('data:image/jpeg;base64,/9j/4AAQ=')
    expect(result).toEqual({ mediaType: 'image/jpeg', data: '/9j/4AAQ=' })
  })

  it('parses GIF data URL', () => {
    const result = parseDataUrl('data:image/gif;base64,R0lGODlh=')
    expect(result).toEqual({ mediaType: 'image/gif', data: 'R0lGODlh=' })
  })

  it('parses WebP data URL', () => {
    const result = parseDataUrl('data:image/webp;base64,UklGRi=')
    expect(result).toEqual({ mediaType: 'image/webp', data: 'UklGRi=' })
  })

  it('returns null for invalid data URL', () => {
    expect(parseDataUrl('not-a-data-url')).toBeNull()
    expect(parseDataUrl('data:text/plain;base64,abc')).toBeNull()
    expect(parseDataUrl('')).toBeNull()
  })
})

describe('Attachment rendering logic', () => {
  function shouldRenderAsThumbnail(att: MessageAttachment): boolean {
    return !!att.imageData
  }

  function getAttachmentLabel(att: MessageAttachment): string {
    if (att.imageSource === 'screenshot') return 'Screenshot'
    if (att.imageSource === 'upload') return att.fileName ?? ''
    if (att.imageSource === 'capture') return 'Web capture'
    return att.fileName ?? ''
  }

  it('renders image attachments as thumbnails', () => {
    expect(
      shouldRenderAsThumbnail({
        fileId: 'img1',
        fileName: 'shot.png',
        fileType: 'image/png',
        imageData: 'data:image/png;base64,abc',
        imageSource: 'screenshot',
      })
    ).toBe(true)
  })

  it('renders file attachments as chips', () => {
    expect(
      shouldRenderAsThumbnail({
        fileId: 'f1',
        fileName: 'doc.pdf',
        fileType: 'application/pdf',
      })
    ).toBe(false)
  })

  it('labels screenshot attachments correctly', () => {
    expect(
      getAttachmentLabel({
        fileId: 'img1',
        fileName: 'screenshot.png',
        fileType: 'image/png',
        imageData: 'base64data',
        imageSource: 'screenshot',
      })
    ).toBe('Screenshot')
  })

  it('labels upload attachments with filename', () => {
    expect(
      getAttachmentLabel({
        fileId: 'img1',
        fileName: 'photo.jpg',
        fileType: 'image/jpeg',
        imageData: 'base64data',
        imageSource: 'upload',
      })
    ).toBe('photo.jpg')
  })

  it('labels capture attachments correctly', () => {
    expect(
      getAttachmentLabel({
        fileId: 'img1',
        fileName: 'capture.png',
        fileType: 'image/png',
        imageData: 'base64data',
        imageSource: 'capture',
      })
    ).toBe('Web capture')
  })

  it('falls back to filename for unknown sources', () => {
    expect(
      getAttachmentLabel({
        fileId: 'f1',
        fileName: 'mystery.txt',
        fileType: 'text/plain',
      })
    ).toBe('mystery.txt')
  })
})

describe('Capture markdown builder', () => {
  function buildMarkdownFromCapture(
    title: string,
    sourceUrl: string,
    content: string,
    tags: string[]
  ): string {
    const tagLine = tags.length > 0 ? `\nTags: ${tags.map((t) => `\`${t}\``).join(', ')}\n` : ''
    return `# ${title}\n\n> Source: [${sourceUrl}](${sourceUrl})\n> Captured: ${new Date().toISOString().split('T')[0]}${tagLine}\n\n---\n\n${content}`
  }

  it('builds markdown with title and URL', () => {
    const md = buildMarkdownFromCapture('Test', 'https://example.com', 'Content', [])
    expect(md).toContain('# Test')
    expect(md).toContain('[https://example.com]')
    expect(md).toContain('Content')
  })

  it('includes tags when provided', () => {
    const md = buildMarkdownFromCapture('Test', 'https://example.com', 'Content', ['js', 'react'])
    expect(md).toContain('`js`')
    expect(md).toContain('`react`')
  })

  it('omits tag line when no tags', () => {
    const md = buildMarkdownFromCapture('Test', 'https://example.com', 'Content', [])
    expect(md).not.toContain('Tags:')
  })
})
