# GWS Extension — Session Reference (March 18, 2026)

## What Was Accomplished — Previous Session

### 1. Chat with Document Context ✅
- Google Docs API OAuth2 connected (Chrome Extension type client)
- Client ID: `502240205650-kifr5qovf2810ejno2rb3j1k1r1vsg8v.apps.googleusercontent.com`
- Test user: `darshulrishabh@gmail.com`
- Document text fetched via Google Docs API export endpoint (17,710 chars)
- System prompt updated (`packages/api/src/services/chat/system-prompt.ts`) to include `documentContent` even without a linked Follow file (line ~365 fallback block)

### 2. Annotated Canvas Discovery ✅
- Google Docs uses canvas rendering — no DOM text nodes
- `window._docs_annotate_canvas_by_ext` enables SVG annotation layer
- SVG `<rect>` elements in `.kix-canvas-tile-text svg > g > rect` have exact text bounding boxes
- Early content script (`canvas-annotate-init.ts`) sets this at `document_start` in `MAIN` world

### 3. Canvas Position Adapter ✅
- `src/content/canvas-position-adapter.ts` — parses SVG rects, maps paragraph indices to viewport DOMRects
- Must use `getBoundingClientRect()` on SVG `<rect>` elements (NOT manual coordinate math)

### 4. Canvas Selection Detection ✅
- `src/services/canvas-selection-tracker.ts` — detects text selection in canvas mode
- Clipboard text capture: injected MAIN world script reads `navigator.clipboard.readText()`, posts back via `window.postMessage`

### 5. SelectionMenu on Canvas ✅
- Appears automatically when text is selected
- Shows Rewrite, Shorten, Strengthen, Tone, Grammar chips + custom instruction input

## What Was Accomplished — Current Session

### P1: Highlight & Underline from Chat ✅
- **`src/hooks/useChat.ts`** — Added `annotations` SSE event handler + `AnnotationPayload` type
- **`src/lib/text-matcher.ts`** (new) — `matchSpanToRange(spanText, paragraphTexts)` maps AI spanText to `(startPara, startChar, endPara, endChar)` offsets
- **`src/content/dom-bridge.ts`** — Added `getParagraphTextsForMatching()` (DOM + canvas), canvas fallback in `getTextRangeRects()` using canvas-position-adapter
- **`src/components/floating-unit/UnitChatPanel.tsx`** — `handleAnnotations` callback wires SSE annotations → `useOverlayStore.setMarks()` → `DocIntelMarksOverlay` renders underlines
- Flow: user asks "highlight important parts" → AI calls `annotate_document` tool → backend SSE `type: 'annotations'` → client matches text → colored underlines appear

### P2: HighlightRevision from Chip Clicks ✅
- **`src/services/ai-edit-service.ts`** (new) — `requestEditSuggestion(text, chipMode, customInstruction?)` calls `/api/doc-intelligence-web/suggest`
- **`src/components/overlays/SelectionMenu.tsx`** — Chip clicks now call real AI API, show pending revision immediately, update with result
- **Custom instruction** input wired — Enter/Run button calls `requestEditSuggestion` with custom prompt
- **`src/components/overlays/HighlightRevision.tsx`** — Loading spinner for pending revisions, disabled Accept/Edit/Regen buttons while pending

### P3: Ghost Draft Canvas Positioning ✅
- Already implemented in previous session — `GhostDraft.tsx` uses `canvasGetInsertionPoint()` in canvas mode
- Verified code is correct, needs E2E test

### P4: Materialization (Google Docs API Write) ✅
- **`manifest.json`** — Upgraded OAuth scopes: `documents.readonly` → `documents`, added `spreadsheets` and `presentations`
- **`src/lib/google-workspace-write.ts`** (new) — Full CRUD for Docs (batchUpdate, insertText, replaceAllText, replaceRange), Sheets (getValues, updateValues), Slides (batchUpdate, replaceAllText)
- **`src/services/materialization-service.ts`** (new) — `materializeReplacement()` and `materializeInsertion()` try API first, fall back to clipboard paste
- **`HighlightRevision.tsx`** — Accept now uses `materializeReplacement()` (API → clipboard fallback)
- **`GhostDraft.tsx`** — Commit now uses `materializeInsertion()` (API → clipboard fallback)

### P5: Sheets & Slides Support ✅
- **`src/content/sheets-adapter.ts`** (new) — Cell selection detection, formula bar reading, visible cell values extraction
- **`src/content/slides-adapter.ts`** (new) — Shape text selection, slide index tracking, speaker notes reading
- Host permissions added for `sheets.googleapis.com` and `slides.googleapis.com`
- Content scripts already match Sheets and Slides URLs

## New Files Created This Session
- `src/lib/text-matcher.ts` — spanText → paragraph/char offset matching
- `src/services/ai-edit-service.ts` — AI edit API client
- `src/lib/google-workspace-write.ts` — Google Workspace write APIs (Docs/Sheets/Slides)
- `src/services/materialization-service.ts` — Orchestrates API write with clipboard fallback
- `src/content/sheets-adapter.ts` — Google Sheets DOM adapter
- `src/content/slides-adapter.ts` — Google Slides DOM adapter

## Modified Files This Session
- `src/hooks/useChat.ts` — `annotations` SSE event + `onAnnotations` callback
- `src/content/dom-bridge.ts` — `getParagraphTextsForMatching()`, canvas fallback in `getTextRangeRects()`
- `src/components/floating-unit/UnitChatPanel.tsx` — `handleAnnotations` wires annotations → overlay store
- `src/components/overlays/SelectionMenu.tsx` — Real AI edit API calls, custom instruction support
- `src/components/overlays/HighlightRevision.tsx` — Loading state, API materialization on accept
- `src/components/overlays/GhostDraft.tsx` — API materialization on commit
- `manifest.json` — Full read/write OAuth scopes, Sheets/Slides host permissions

## Key Technical Gotchas
1. **Extension reload required** after manifest changes — click reload in chrome://extensions
2. **OAuth scope upgrade**: After changing scopes in manifest.json, users must re-authorize. The old readonly token won't work for writes.
3. **MAIN vs ISOLATED world**: content script = isolated, page = main. CustomEvents on `window` DO cross worlds.
4. **SVG rect coordinates**: MUST use `getBoundingClientRect()` on `<rect>` elements
5. **`documentContent` in chat**: server only includes it in system prompt when no linked Follow file exists
6. **`GoogleDocType` values**: `'docs'` | `'sheets'` | `'slides'` (not 'document'/'spreadsheet'/'presentation')

## Build & Test
```bash
cd "C:\Dev\Workspace App\apps\gws-extension"
node scripts/build.mjs
# Then: chrome://extensions → reload Follow → reload Google Doc page
```

## Extension ID
`hmmanjibicfpahoimfffeakklgmcgbga`

## What Could Be Done Next
- Wire Sheets adapter into SelectionMenu for cell-based editing
- Wire Slides adapter for shape text selection + speaker notes editing
- Add `insertIndex` calculation for Ghost Draft API commits (requires doc content length)
- Regen button on HighlightRevision (call `requestRegeneration()`)
- E2E test all flows on real Google Docs/Sheets/Slides
