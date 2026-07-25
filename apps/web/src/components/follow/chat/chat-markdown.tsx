'use client'

import { useState, useMemo } from 'react'

/**
 * Lightweight markdown renderer for the floating unit chat.
 * Handles: headings, bold, italic, inline code, code blocks,
 * links, lists (bullet + numbered), horizontal rules, blockquotes.
 */

interface ChatMarkdownProps {
  content: string
}

// ─── Code block with copy button ───

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg" style={{ border: '1px solid #E0E0E0' }}>
      <div
        className="flex items-center justify-between px-3 py-1"
        style={{ background: '#F5F5F5' }}
      >
        <span className="text-[10px] font-medium" style={{ color: '#9AA0A6' }}>
          {language || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className="text-[10px] transition-colors hover:text-[#3C4043]"
          style={{ color: '#9AA0A6' }}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3" style={{ background: '#FAFAFA' }}>
        <code className="text-xs" style={{ color: '#37474F' }}>
          {code}
        </code>
      </pre>
    </div>
  )
}

// ─── URL cleaner for nav: protocol links ───

/**
 * Cleans URLs that use the `nav:` or `nav-pw:` protocol prefix
 * returned by the AI backend. Strips the prefix and removes the
 * `|section` suffix to extract the real URL.
 *
 * Examples:
 *   "nav:https://en.wikipedia.org/wiki/Bees|Beehive" → "https://en.wikipedia.org/wiki/Bees"
 *   "nav-pw:https://example.com|action"               → "https://example.com"
 *   "https://normal-url.com"                           → "https://normal-url.com"
 */
function cleanUrl(raw: string): string {
  let url = raw.trim()
  // Strip nav: or nav-pw: prefix
  if (url.startsWith('nav-pw:')) {
    url = url.slice(7)
  } else if (url.startsWith('nav:')) {
    url = url.slice(4)
  }
  // Strip |section suffix (pipe-separated section hint)
  const pipeIndex = url.indexOf('|')
  if (pipeIndex > 0) {
    url = url.slice(0, pipeIndex)
  }
  return url
}

// ─── Inline markdown processor ───

function processInline(text: string): string {
  return (
    text
      // Bold: **text**
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic: *text* (but not ** which is bold)
      .replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
      // Inline code: `text`
      .replace(
        /`([^`]+)`/g,
        '<code style="background:#F0F0F0;padding:1px 5px;border-radius:4px;font-size:0.8em;color:#D32F2F;">$1</code>'
      )
      // Links: [text](url) — clean nav: prefixes before rendering
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label: string, rawUrl: string) => {
        const href = cleanUrl(rawUrl)
        return `<a href="${href}" target="_blank" rel="noopener" style="color:#1A73E8;text-decoration:underline;text-underline-offset:2px;">${label}</a>`
      })
  )
}

// ─── Block-level parser ───

interface Block {
  type: 'heading' | 'code' | 'hr' | 'listItem' | 'orderedItem' | 'blockquote' | 'paragraph'
  level?: number // heading level (1-6)
  language?: string // code block language
  content: string
  index?: number // ordered list number
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  // Split by code blocks first
  const segments = text.split(/(```[\s\S]*?```)/g)

  for (const segment of segments) {
    if (segment.startsWith('```')) {
      const match = segment.match(/```(\w+)?\n?([\s\S]*?)```/)
      blocks.push({
        type: 'code',
        language: match?.[1] ?? '',
        content: match?.[2]?.trim() ?? segment.slice(3, -3).trim(),
      })
      continue
    }

    // Process line-by-line
    const lines = segment.split('\n')
    let i = 0

    while (i < lines.length) {
      const line = lines[i]!
      const trimmed = line.trim()

      // Skip empty lines
      if (!trimmed) {
        i++
        continue
      }

      // Horizontal rule: ---, ***, ___
      if (/^[-*_]{3,}$/.test(trimmed)) {
        blocks.push({ type: 'hr', content: '' })
        i++
        continue
      }

      // Heading: # ... ####
      const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
      if (headingMatch) {
        blocks.push({
          type: 'heading',
          level: headingMatch[1]!.length,
          content: headingMatch[2]!,
        })
        i++
        continue
      }

      // Blockquote: > text
      if (trimmed.startsWith('> ')) {
        blocks.push({ type: 'blockquote', content: trimmed.slice(2) })
        i++
        continue
      }

      // Unordered list: - item or * item
      if (/^[-*+]\s+/.test(trimmed)) {
        blocks.push({ type: 'listItem', content: trimmed.replace(/^[-*+]\s+/, '') })
        i++
        continue
      }

      // Ordered list: 1. item
      const orderedMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/)
      if (orderedMatch) {
        blocks.push({
          type: 'orderedItem',
          index: parseInt(orderedMatch[1]!, 10),
          content: orderedMatch[2]!,
        })
        i++
        continue
      }

      // Paragraph (collect consecutive non-special lines)
      blocks.push({ type: 'paragraph', content: trimmed })
      i++
    }
  }

  return blocks
}

// ─── Heading styles ───

const HEADING_STYLES: Record<number, { fontSize: string; fontWeight: number; marginTop: string }> =
  {
    1: { fontSize: '1.25rem', fontWeight: 700, marginTop: '16px' },
    2: { fontSize: '1.1rem', fontWeight: 700, marginTop: '14px' },
    3: { fontSize: '1rem', fontWeight: 600, marginTop: '12px' },
    4: { fontSize: '0.9rem', fontWeight: 600, marginTop: '10px' },
    5: { fontSize: '0.85rem', fontWeight: 600, marginTop: '8px' },
    6: { fontSize: '0.8rem', fontWeight: 600, marginTop: '6px' },
  }

// ─── Main component ───

export function ChatMarkdown({ content }: ChatMarkdownProps) {
  const blocks = useMemo(() => parseBlocks(content), [content])

  return (
    <div className="space-y-1">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'code':
            return <CodeBlock key={i} language={block.language ?? ''} code={block.content} />

          case 'hr':
            return (
              <hr
                key={i}
                className="my-3"
                style={{ border: 'none', borderTop: '1px solid #E0E0E0' }}
              />
            )

          case 'heading': {
            const style = HEADING_STYLES[block.level ?? 3] ?? HEADING_STYLES[3]
            return (
              <div
                key={i}
                style={{
                  fontSize: style!.fontSize,
                  fontWeight: style!.fontWeight,
                  marginTop: i === 0 ? '0' : style!.marginTop,
                  color: '#202124',
                  lineHeight: 1.4,
                }}
                dangerouslySetInnerHTML={{ __html: processInline(block.content) }}
              />
            )
          }

          case 'blockquote':
            return (
              <div
                key={i}
                className="my-1 rounded py-1 pl-3"
                style={{
                  borderLeft: '3px solid #DADCE0',
                  background: '#FAFAFA',
                  color: '#5F6368',
                }}
                dangerouslySetInnerHTML={{ __html: processInline(block.content) }}
              />
            )

          case 'listItem':
            return (
              <div key={i} className="flex gap-2 pl-2" style={{ color: '#202124' }}>
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: '#9AA0A6' }}
                />
                <span dangerouslySetInnerHTML={{ __html: processInline(block.content) }} />
              </div>
            )

          case 'orderedItem':
            return (
              <div key={i} className="flex gap-2 pl-2" style={{ color: '#202124' }}>
                <span
                  className="shrink-0 text-xs font-medium"
                  style={{ color: '#5F6368', minWidth: 16 }}
                >
                  {block.index}.
                </span>
                <span dangerouslySetInnerHTML={{ __html: processInline(block.content) }} />
              </div>
            )

          case 'paragraph':
          default:
            return (
              <div
                key={i}
                style={{ color: '#202124' }}
                dangerouslySetInnerHTML={{ __html: processInline(block.content) }}
              />
            )
        }
      })}
    </div>
  )
}
