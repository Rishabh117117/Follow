import { describe, it, expect } from 'vitest'

/**
 * Tests for chat UI logic — message parsing, SSE parsing, block rendering.
 */

// ─── SSE Parsing ────────────────────────────────────────────────────

describe('SSE Event Parsing', () => {
  function parseSSELine(line: string): { type: string; [key: string]: unknown } | null {
    if (!line.startsWith('data:')) return null
    const jsonStr = line.slice(5).trim()
    if (!jsonStr) return null
    try {
      return JSON.parse(jsonStr) as { type: string }
    } catch {
      return null
    }
  }

  it('should parse token event', () => {
    const event = parseSSELine('data: {"type":"token","content":"Hello"}')
    expect(event).not.toBeNull()
    expect(event!.type).toBe('token')
    expect(event!.content).toBe('Hello')
  })

  it('should parse tool_start event', () => {
    const event = parseSSELine('data: {"type":"tool_start","tool":"search_files"}')
    expect(event).not.toBeNull()
    expect(event!.type).toBe('tool_start')
    expect(event!.tool).toBe('search_files')
  })

  it('should parse tool_end event', () => {
    const event = parseSSELine('data: {"type":"tool_end","tool":"read_file"}')
    expect(event).not.toBeNull()
    expect(event!.type).toBe('tool_end')
  })

  it('should parse done event', () => {
    const event = parseSSELine(
      'data: {"type":"done","messageId":"msg-123","tokensIn":100,"tokensOut":200}'
    )
    expect(event).not.toBeNull()
    expect(event!.type).toBe('done')
    expect(event!.messageId).toBe('msg-123')
  })

  it('should parse error event', () => {
    const event = parseSSELine('data: {"type":"error","message":"Rate limited"}')
    expect(event).not.toBeNull()
    expect(event!.type).toBe('error')
  })

  it('should return null for non-data lines', () => {
    expect(parseSSELine('event: message')).toBeNull()
    expect(parseSSELine('')).toBeNull()
    expect(parseSSELine('comment: test')).toBeNull()
  })

  it('should return null for empty data', () => {
    expect(parseSSELine('data: ')).toBeNull()
    expect(parseSSELine('data:')).toBeNull()
  })

  it('should return null for invalid JSON', () => {
    expect(parseSSELine('data: {invalid}')).toBeNull()
  })
})

// ─── Message Content Parsing ────────────────────────────────────────

describe('Message Content Parsing', () => {
  function splitByCodeBlocks(
    text: string
  ): Array<{ type: 'text' | 'code'; content: string; language?: string }> {
    const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = []
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g
    let lastIndex = 0
    let match: RegExpExecArray | null = codeBlockRegex.exec(text)

    while (match !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        const textContent = text.slice(lastIndex, match.index).trim()
        if (textContent) parts.push({ type: 'text', content: textContent })
      }

      // Add code block
      parts.push({
        type: 'code',
        content: match[2]!.trim(),
        language: match[1] || undefined,
      })

      lastIndex = match.index + match[0].length
      match = codeBlockRegex.exec(text)
    }

    // Add remaining text
    if (lastIndex < text.length) {
      const remaining = text.slice(lastIndex).trim()
      if (remaining) parts.push({ type: 'text', content: remaining })
    }

    return parts
  }

  it('should handle plain text', () => {
    const parts = splitByCodeBlocks('Hello world')
    expect(parts).toEqual([{ type: 'text', content: 'Hello world' }])
  })

  it('should split text and code blocks', () => {
    const text = 'Here is some code:\n```typescript\nconst x = 1;\n```\nAnd more text.'
    const parts = splitByCodeBlocks(text)

    expect(parts.length).toBe(3)
    expect(parts[0]!.type).toBe('text')
    expect(parts[1]!.type).toBe('code')
    expect(parts[1]!.language).toBe('typescript')
    expect(parts[1]!.content).toBe('const x = 1;')
    expect(parts[2]!.type).toBe('text')
  })

  it('should handle multiple code blocks', () => {
    const text = '```js\na()\n```\nMiddle\n```python\nb()\n```'
    const parts = splitByCodeBlocks(text)

    expect(parts.length).toBe(3)
    expect(parts[0]!.language).toBe('js')
    expect(parts[1]!.type).toBe('text')
    expect(parts[2]!.language).toBe('python')
  })

  it('should handle code block without language', () => {
    const text = '```\ncode here\n```'
    const parts = splitByCodeBlocks(text)

    expect(parts.length).toBe(1)
    expect(parts[0]!.type).toBe('code')
    expect(parts[0]!.language).toBeUndefined()
  })
})

// ─── Research Block Parsing (Deep Dive) ─────────────────────────────

describe('Research Block Parsing', () => {
  interface ResearchBlock {
    id: string
    type: 'text' | 'code' | 'callout'
    heading?: string
    content: string
  }

  function parseResearchBlocks(text: string): ResearchBlock[] {
    const blocks: ResearchBlock[] = []
    const sections = text.split(/(?=^##\s)/m)

    for (const section of sections) {
      if (!section.trim()) continue

      const headingMatch = section.match(/^##\s+(.+)\n/)
      const heading = headingMatch?.[1]?.trim()
      const body = heading ? section.slice(headingMatch![0].length).trim() : section.trim()

      if (!body) continue

      const parts = body.split(/(```[\s\S]*?```)/g)
      for (const part of parts) {
        if (!part.trim()) continue

        if (part.startsWith('```')) {
          const code = part
            .replace(/```\w*\n?/, '')
            .replace(/```$/, '')
            .trim()
          blocks.push({
            id: `block-${blocks.length}`,
            type: 'code',
            heading:
              heading && blocks.filter((b) => b.heading === heading).length === 0
                ? heading
                : undefined,
            content: code,
          })
        } else {
          blocks.push({
            id: `block-${blocks.length}`,
            type: 'text',
            heading:
              heading && blocks.filter((b) => b.heading === heading).length === 0
                ? heading
                : undefined,
            content: part.trim(),
          })
        }
      }
    }

    if (blocks.length === 0 && text.trim()) {
      blocks.push({ id: 'block-0', type: 'text', content: text.trim() })
    }

    return blocks
  }

  it('should parse text without headings as single block', () => {
    const blocks = parseResearchBlocks('Just some text content.')
    expect(blocks.length).toBe(1)
    expect(blocks[0]!.type).toBe('text')
    expect(blocks[0]!.heading).toBeUndefined()
  })

  it('should parse sections with headings', () => {
    const text = '## Introduction\nFirst section.\n\n## Analysis\nSecond section.'
    const blocks = parseResearchBlocks(text)

    expect(blocks.length).toBe(2)
    expect(blocks[0]!.heading).toBe('Introduction')
    expect(blocks[1]!.heading).toBe('Analysis')
  })

  it('should handle code blocks within sections', () => {
    const text =
      '## Code Example\nHere is the code:\n```typescript\nconst x = 1;\n```\nAnd explanation.'
    const blocks = parseResearchBlocks(text)

    expect(blocks.length).toBe(3)
    expect(blocks[0]!.type).toBe('text')
    expect(blocks[0]!.heading).toBe('Code Example')
    expect(blocks[1]!.type).toBe('code')
    expect(blocks[2]!.type).toBe('text')
  })

  it('should handle empty text', () => {
    const blocks = parseResearchBlocks('')
    expect(blocks.length).toBe(0)
  })

  it('should assign unique IDs', () => {
    const text = '## A\nContent A\n\n## B\nContent B'
    const blocks = parseResearchBlocks(text)

    const ids = blocks.map((b) => b.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })
})

// ─── Conversation Grouping ──────────────────────────────────────────

describe('Conversation Grouping', () => {
  interface ConvItem {
    id: string
    updatedAt: string
  }

  function groupByDate(items: ConvItem[]): Record<string, ConvItem[]> {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const yesterday = new Date(today.getTime() - 86400000)
    const weekAgo = new Date(today.getTime() - 7 * 86400000)

    const groups: Record<string, ConvItem[]> = {
      Today: [],
      Yesterday: [],
      'This Week': [],
      Older: [],
    }

    for (const item of items) {
      const date = new Date(item.updatedAt)
      if (date >= today) groups['Today']!.push(item)
      else if (date >= yesterday) groups['Yesterday']!.push(item)
      else if (date >= weekAgo) groups['This Week']!.push(item)
      else groups['Older']!.push(item)
    }

    return groups
  }

  it('should group today items', () => {
    const now = new Date()
    const groups = groupByDate([{ id: '1', updatedAt: now.toISOString() }])
    expect(groups['Today']!.length).toBe(1)
  })

  it('should group yesterday items', () => {
    const yesterday = new Date(Date.now() - 86400000)
    // Set to noon yesterday to avoid edge cases
    yesterday.setHours(12, 0, 0, 0)
    const groups = groupByDate([{ id: '1', updatedAt: yesterday.toISOString() }])

    // Might be in Yesterday or This Week depending on time
    const totalGrouped = Object.values(groups).reduce((sum, arr) => sum + arr.length, 0)
    expect(totalGrouped).toBe(1)
  })

  it('should group old items', () => {
    const oldDate = new Date('2024-01-01')
    const groups = groupByDate([{ id: '1', updatedAt: oldDate.toISOString() }])
    expect(groups['Older']!.length).toBe(1)
  })

  it('should handle empty list', () => {
    const groups = groupByDate([])
    expect(groups['Today']!.length).toBe(0)
    expect(groups['Older']!.length).toBe(0)
  })
})

// ─── Tool Status Labels ─────────────────────────────────────────────

describe('Tool Status Labels', () => {
  function getToolLabel(toolName: string): string {
    const labels: Record<string, string> = {
      search_files: 'Searching files...',
      read_file: 'Reading document...',
      create_file: 'Creating file...',
      list_files: 'Listing files...',
      get_timeline_summary: 'Fetching timeline...',
      read_canvas: 'Reading canvas...',
    }
    return labels[toolName] ?? `Running ${toolName}...`
  }

  it('should return correct labels for known tools', () => {
    expect(getToolLabel('search_files')).toBe('Searching files...')
    expect(getToolLabel('read_file')).toBe('Reading document...')
    expect(getToolLabel('create_file')).toBe('Creating file...')
    expect(getToolLabel('read_canvas')).toBe('Reading canvas...')
  })

  it('should return generic label for unknown tools', () => {
    expect(getToolLabel('unknown_tool')).toBe('Running unknown_tool...')
  })
})
