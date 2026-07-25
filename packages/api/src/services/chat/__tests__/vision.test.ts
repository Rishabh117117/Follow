import { describe, it, expect } from 'vitest'
import { buildClaudeMessages } from '../completion'
import type { MessageAttachment } from '@workspace/shared/types'

describe('buildClaudeMessages', () => {
  const baseMessages = [
    { role: 'user', content: 'Hello', userId: 'u1', metadata: null },
    { role: 'assistant', content: 'Hi there!', userId: null, metadata: null },
    { role: 'user', content: 'What do you see?', userId: 'u1', metadata: null },
  ]

  it('returns plain text messages when no attachments', () => {
    const result = buildClaudeMessages(baseMessages, [])
    expect(result).toHaveLength(3)
    expect(result[0]!.content).toBe('Hello')
    expect(result[2]!.content).toBe('What do you see?')
  })

  it('adds file attachment context to last user message', () => {
    const attachments: MessageAttachment[] = [
      { fileId: 'f1', fileName: 'report.pdf', fileType: 'application/pdf' },
    ]
    const result = buildClaudeMessages(baseMessages, attachments)
    expect(result[2]!.content).toContain('[Attached file: report.pdf (application/pdf)]')
  })

  it('builds multi-modal content blocks for image attachments', () => {
    const attachments: MessageAttachment[] = [
      {
        fileId: 'img1',
        fileName: 'screenshot.png',
        fileType: 'image/png',
        imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ',
        imageSource: 'screenshot',
      },
    ]
    const result = buildClaudeMessages(baseMessages, attachments)
    const lastMsg = result[2]!

    // Content should be an array of blocks (multi-modal)
    expect(Array.isArray(lastMsg.content)).toBe(true)
    const blocks = lastMsg.content as Array<{ type: string }>

    // Should contain image_url block + text block
    const imageBlocks = blocks.filter((b) => b.type === 'image_url')
    const textBlocks = blocks.filter((b) => b.type === 'text')
    expect(imageBlocks).toHaveLength(1)
    expect(textBlocks).toHaveLength(1)
  })

  it('handles multiple image attachments', () => {
    const attachments: MessageAttachment[] = [
      {
        fileId: 'img1',
        fileName: 'shot1.png',
        fileType: 'image/png',
        imageData: 'data:image/png;base64,abc123',
        imageSource: 'screenshot',
      },
      {
        fileId: 'img2',
        fileName: 'shot2.jpeg',
        fileType: 'image/jpeg',
        imageData: 'data:image/jpeg;base64,def456',
        imageSource: 'upload',
      },
    ]
    const result = buildClaudeMessages(baseMessages, attachments)
    const lastMsg = result[2]!
    const blocks = lastMsg.content as Array<{ type: string }>
    const imageBlocks = blocks.filter((b) => b.type === 'image_url')
    expect(imageBlocks).toHaveLength(2)
  })

  it('handles mixed image + file attachments', () => {
    const attachments: MessageAttachment[] = [
      {
        fileId: 'img1',
        fileName: 'shot.png',
        fileType: 'image/png',
        imageData: 'data:image/png;base64,abc',
        imageSource: 'screenshot',
      },
      { fileId: 'f1', fileName: 'report.pdf', fileType: 'application/pdf' },
    ]
    const result = buildClaudeMessages(baseMessages, attachments)
    const lastMsg = result[2]!
    const blocks = lastMsg.content as Array<{ type: string; text?: string }>

    const imageBlocks = blocks.filter((b) => b.type === 'image_url')
    const textBlocks = blocks.filter((b) => b.type === 'text')
    expect(imageBlocks).toHaveLength(1)
    expect(textBlocks).toHaveLength(1)
    expect(textBlocks[0]!.text).toContain('[Attached file: report.pdf')
  })

  it('preserves full data URL in image_url format', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
    const attachments: MessageAttachment[] = [
      {
        fileId: 'img1',
        fileName: 'test.png',
        fileType: 'image/png',
        imageData: dataUrl,
        imageSource: 'screenshot',
      },
    ]
    const result = buildClaudeMessages(baseMessages, attachments)
    const blocks = result[2]!.content as Array<{
      type: string
      image_url?: { url: string }
    }>
    const imageBlock = blocks.find((b) => b.type === 'image_url')
    // OpenAI format: full data URL is preserved in image_url.url
    expect(imageBlock?.image_url?.url).toBe(dataUrl)
  })

  it('handles raw base64 without data URL prefix', () => {
    const longBase64 = 'A'.repeat(200) // Simulate raw base64
    const attachments: MessageAttachment[] = [
      {
        fileId: 'img1',
        fileName: 'raw.png',
        fileType: 'image/png',
        imageData: longBase64,
        imageSource: 'screenshot',
      },
    ]
    const result = buildClaudeMessages(baseMessages, attachments)
    const blocks = result[2]!.content as Array<{
      type: string
      image_url?: { url: string }
    }>
    const imageBlock = blocks.find((b) => b.type === 'image_url')
    // Should wrap raw base64 with data:image/png;base64, prefix
    expect(imageBlock?.image_url?.url).toBe(`data:image/png;base64,${longBase64}`)
  })

  it('filters out system messages', () => {
    const messagesWithSystem = [
      { role: 'system', content: 'System message', userId: null, metadata: null },
      { role: 'user', content: 'Hello', userId: 'u1', metadata: null },
    ]
    const result = buildClaudeMessages(messagesWithSystem, [])
    expect(result).toHaveLength(1)
    expect(result[0]!.content).toBe('Hello')
  })

  it('returns empty array for empty messages', () => {
    const result = buildClaudeMessages([], [])
    expect(result).toHaveLength(0)
  })

  it('does not modify message if last is assistant', () => {
    const msgs = [
      { role: 'user', content: 'Hi', userId: 'u1', metadata: null },
      { role: 'assistant', content: 'Hello!', userId: null, metadata: null },
    ]
    const attachments: MessageAttachment[] = [
      { fileId: 'f1', fileName: 'test.pdf', fileType: 'application/pdf' },
    ]
    const result = buildClaudeMessages(msgs, attachments)
    // Last message is assistant, so no attachment context should be added
    expect(result[1]!.content).toBe('Hello!')
  })

  it('supports webp and gif media types via data URL', () => {
    const attachments: MessageAttachment[] = [
      {
        fileId: 'img1',
        fileName: 'anim.gif',
        fileType: 'image/gif',
        imageData: 'data:image/gif;base64,R0lGODlhAQABAIAAAP',
        imageSource: 'upload',
      },
      {
        fileId: 'img2',
        fileName: 'photo.webp',
        fileType: 'image/webp',
        imageData: 'data:image/webp;base64,UklGRiYAAABXRUJQ',
        imageSource: 'upload',
      },
    ]
    const result = buildClaudeMessages(baseMessages, attachments)
    const blocks = result[2]!.content as Array<{
      type: string
      image_url?: { url: string }
    }>
    const imageBlocks = blocks.filter((b) => b.type === 'image_url')
    expect(imageBlocks[0]?.image_url?.url).toContain('image/gif')
    expect(imageBlocks[1]?.image_url?.url).toContain('image/webp')
  })
})
