# Underline Feature — Chat-Triggered Formatting for Google Docs

## Goal
Allow the Follow Chat AI to **underline** text in Google Docs when the user asks (e.g., "underline all the verbs"). Currently the AI responds "I cannot directly underline text" because no formatting tool exists — only background-color highlighting via `annotate_google_doc`.

## Architecture Overview

The pipeline: **User prompt → AI tool call → SSE event → Extension handler → Google Docs API batchUpdate**

All the pieces already exist for highlighting. We're adding a parallel path for **text formatting** (underline, bold, italic).

---

## Changes (4 files)

### 1. `packages/api/src/services/chat/tools.ts` — New `format_google_doc` tool

Add a new tool definition alongside `annotate_google_doc`:

```ts
{
  name: 'format_google_doc',
  description: 'Apply text formatting (underline, bold, italic) to specific text spans in the Google Doc. Use when the user asks to underline, bold, or italicize words/phrases. Provide exact verbatim text from the document.',
  input_schema: {
    type: 'object',
    properties: {
      spans: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            spanText: { type: 'string', description: 'Exact verbatim text to format' },
            format: { type: 'string', enum: ['underline', 'bold', 'italic'], description: 'Formatting to apply' },
          },
          required: ['spanText', 'format'],
        },
      },
      summary: { type: 'string', description: 'Brief summary (e.g. "Underlined 12 verbs")' },
    },
    required: ['spans', 'summary'],
  },
}
```

Also add tool execution handler that returns `{ spans, summary }` passthrough (formatting applied client-side).

### 2. `packages/api/src/services/chat/system-prompt.ts` — Teach AI about the tool

Add to the GWS tool usage rules:
- `format_google_doc` — apply underline/bold/italic to text spans
- Keywords: "underline", "bold", "italicize", "format"
- Must use exact verbatim text from document

### 3. `packages/api/src/routes/chat.ts` — Emit `format_action` SSE event

In the `onToolEnd` handler, add a new block for `format_google_doc`:

```ts
if (toolName === 'format_google_doc' && toolResult) {
  await stream.writeSSE({
    data: JSON.stringify({
      type: 'format_action',
      spans: result.spans,
      summary: result.summary,
    }),
    event: 'message',
  })
}
```

### 4. `apps/gws-extension/src/lib/google-docs-api.ts` — New `formatTextInGoogleDoc()` function

```ts
export async function formatTextInGoogleDoc(
  googleDocId: string,
  spans: { spanText: string; format: 'underline' | 'bold' | 'italic' }[]
): Promise<number>
```

Uses the same `fetchDocumentRaw` → `buildIndexMap` → `findTextInDoc` pattern as `highlightTextInGoogleDoc`, but applies:
```ts
updateTextStyle: {
  range: { startIndex, endIndex },
  textStyle: { underline: true },  // or bold/italic
  fields: 'underline',             // or 'bold' / 'italic'
}
```

### 5. `apps/gws-extension/src/hooks/useChat.ts` — Handle `format_action` SSE event

Add a new case in the SSE parser and a new callback option `onFormatAction`.

### 6. `apps/gws-extension/src/components/floating-unit/UnitChatPanel.tsx` — Wire handler

Add `handleFormatAction` that calls `formatTextInGoogleDoc()` — same pattern as `handleAnnotations`.

---

## Test Plan
1. Open a Google Doc with the Follow extension active
2. In Follow Chat, type: "underline all the verbs in this document"
3. AI should call `format_google_doc` with verb spans extracted from the doc
4. Verbs should get underlined in the actual Google Doc

## Why a separate tool (not extending `annotate_google_doc`)
- Annotations = background highlight + insight cards (visual overlay). Formatting = native Google Docs text style (underline/bold/italic). Different purposes, different rendering.
- Keeps the annotation system clean — no mixing formatting concerns into insight cards.
- The `fields` parameter in `updateTextStyle` is different (`backgroundColor` vs `underline`).
