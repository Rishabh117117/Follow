---
sprint: PDF-VIEWER-OBJECTSTYLE-FIX-1
date: 2026-04-23
author: Claude (Opus 4.7)
status: Complete (Gate B partial — residual unrelated blocker documented in §6)
---

# PDF-VIEWER-OBJECTSTYLE-FIX-1 — Fix the `fontWeight`/ObjectStyle error

## 1. Purpose + scope recap

Fix the single source-level TypeScript error at
`apps/web/src/app/pdf-viewer/page.tsx:116` that PAGE-SHAPE-CLEANUP-1
Gate B surfaced as the next blocker of `npm run build`. Intent: close
the build-gate arc that began with LINT-BASELINE-1 and continued
through PAGE-SHAPE-CLEANUP-1.

**Scope IN:** the one error at line 116 (excess-property /
missing-property on `ObjectStyle`). **Scope OUT:** any other error
in the same file, any other file, feature-vault state changes,
dependency or config edits.

## 2. Phase 1 baseline (verbatim)

**Pre-sprint SHA:** `9cdc433` (tip of PAGE-SHAPE-CLEANUP-1 phase-7)
**api tsc:** 164 ✓
**web tsc:** 61 ✓
**Line number confirmation:** no shift since the brief was drafted —
still line 116.
**Vault posture:** `pdf-viewer` flag `active: false` (unchanged).
**Build-failure stanza:** exactly this error and only this.

**Error verbatim (from `tsc --noEmit`):**

```
src/app/pdf-viewer/page.tsx(116,7): error TS2353:
  Object literal may only specify known properties, and 'fontWeight'
  does not exist in type 'ObjectStyle'.
```

**Error verbatim (from `npm run build`, same error):**

```
./src/app/pdf-viewer/page.tsx:116:7
Type error: Object literal may only specify known properties,
and 'fontWeight' does not exist in type 'ObjectStyle'.

 114 |       textColor: '#FFFFFF',
 115 |       fontSize: 14,
>116 |       fontWeight: 'normal',
     |       ^
 117 |       fontStyle: 'normal',
 118 |       textAlign: 'left',
 119 |       cornerRadius: 8,

Next.js build worker exited with code: 1 and signal: null
```

## 3. Categorization

**CAT-4: library type mismatch (fidelity-preserving variant).**

Source of `ObjectStyle`: `packages/canvas/src/types.ts:34` — canonical
workspace type imported via `@workspace/canvas`. Actual shape:

```ts
export interface ObjectStyle {
  fillColor: string
  strokeColor: string
  strokeWidth: number
  strokeStyle: LineStyle
  opacity: number
  cornerRadius: number
  fontSize: number
  fontFamily: string // required
  textColor: string
  textAlign: TextAlign
  bold: boolean // expresses "weight" as a boolean
  italic: boolean // expresses "style" as a boolean
}
```

The pdf-viewer literal at line 109–121 was authored against a CSS
mental model: `fontWeight: 'normal'`, `fontStyle: 'normal'`,
omitting `fontFamily`, `bold`, `italic`. None of those CSS-shaped
keys exist in `ObjectStyle` — the canvas renderer consumes the
boolean fields. The original properties were excess (unconsumed),
so removing them is lossless. The author's intent `'normal' /
'normal'` maps exactly to `bold: false, italic: false`.

**Why CAT-4 and not CAT-3:** import is correct (`@workspace/canvas`
is the canonical module), so this isn't a bad-import fix. The shape
itself diverges from what was written.

**Why no BLOCK:** visual fidelity is preserved because the dead
properties weren't being consumed. The brief's "if visual fidelity
matters, BLOCK" clause assumes the property was doing real work;
here it wasn't. The atomic swap (drop 2 excess + add 3 required)
is semantically identical to what was written.

TypeScript only reports `fontWeight` at line 116 because it halts at
the first excess-property violation on an object literal; post-fix,
a partial edit that only removed `fontWeight` would cascade to
`fontStyle` (excess) and then `bold` / `italic` / `fontFamily`
(missing). One correct edit handles all five atomically.

## 4. Fix applied

**Before (page.tsx:108–121):**

```tsx
const syntheticObject = useMemo((): CanvasObject => {
  const defaultStyle: ObjectStyle = {
    fillColor: '#18181B',
    strokeColor: '#3F3F46',
    strokeWidth: 1,
    opacity: 1,
    textColor: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'normal',     // ← excess, not in type
    fontStyle: 'normal',      // ← excess, not in type
    textAlign: 'left',
    cornerRadius: 8,
    strokeStyle: 'solid',
  }
```

**After (page.tsx:108–128):**

```tsx
const syntheticObject = useMemo((): CanvasObject => {
  // PDF-VIEWER-OBJECTSTYLE-FIX-1 (2026-04-23): the canonical
  // `ObjectStyle` type from `@workspace/canvas` expresses font
  // state via `bold` / `italic` booleans and requires `fontFamily`.
  // Previous keys `fontWeight: 'normal'` / `fontStyle: 'normal'`
  // were CSS-shaped and unconsumed by the canvas renderer — the
  // translation to the canonical shape is lossless.
  const defaultStyle: ObjectStyle = {
    fillColor: '#18181B',
    strokeColor: '#3F3F46',
    strokeWidth: 1,
    opacity: 1,
    textColor: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter, system-ui, sans-serif',   // ← added (matches DEFAULT_STYLE)
    bold: false,                                  // ← added (was implied by fontWeight:'normal')
    italic: false,                                // ← added (was implied by fontStyle:'normal')
    textAlign: 'left',
    cornerRadius: 8,
    strokeStyle: 'solid',
  }
```

Net: `-2 lines` (dropped excess), `+3 lines` (added canonical
required fields), `+6 lines` (explanatory comment block). No other
edits in the file.

## 5. Gate outcomes

| Gate                | Target                       | Result                             |
| ------------------- | ---------------------------- | ---------------------------------- |
| A · api tsc         | 164                          | **164** ✓                          |
| A · web tsc         | 61 → 60                      | **60** ✓                           |
| B · `npm run build` | PASS                         | **PARTIAL** — see §6               |
| C · no collateral   | only page.tsx + docs         | ✓ empty diff (only 1 file changed) |
| D · vault unchanged | empty diff                   | ✓ empty                            |
| E · test parity     | api 9/869/125, web 3/93/1002 | ✓ identical on both                |

## 6. `npm run build` status — Complete-with-residual-blocker

**Target error: CLEARED.** `pdf-viewer/page.tsx:116` no longer
blocks. The build advances past this and to the next source-level
type error in the 60-count pool:

```
./src/components/follow/dashboard/dash-grid-view.tsx:362:10
Type error: Type 'RefObject<HTMLDivElement | null>' is not assignable
  to type 'LegacyRef<HTMLDivElement> | undefined'.
  Type 'RefObject<HTMLDivElement | null>' is not assignable to type
    'RefObject<HTMLDivElement>'.
    Type 'HTMLDivElement | null' is not assignable to type 'HTMLDivElement'.
      Type 'null' is not assignable to type 'HTMLDivElement'.

 360 |   const { intel, isLoading, ref } = useDocumentIntel(workspaceId, fileId)
 361 |   return (
>362 |     <div ref={ref}>
     |          ^
 363 |       <DocumentIntelCard intel={intel} isLoading={isLoading} />
 364 |     </div>
 365 |   )

Next.js build worker exited with code: 1 and signal: null
```

This is React 18+ vs `@types/react` variance — `useRef` now returns
`RefObject<T | null>` but a plain DOM ref prop expects `LegacyRef<T>`
(which is `RefObject<T>` without the null). Pre-existing; in the
60-count tsc pool; completely unrelated to the ObjectStyle contract
we fixed.

**Per the sprint brief's Phase 3 Gate B clause:**

> Fails on another pre-existing error the now-advancing build has
> surfaced → document the exact stanza and mark as
> `Complete-with-residual-build-blocker`. Do NOT expand scope.
> Queue as followup.

Done. Queued as a followup candidate below.

## 7. Build-gate arc closure — partially

This is the third consecutive sprint targeting `npm run build`:

- **LINT-BASELINE-1** (2026-04-23) cleared the accumulated lint debt
  so the eslint step no longer triggered on debris.
- **PAGE-SHAPE-CLEANUP-1** (2026-04-23) cleared the 3 Next 14
  page-shape errors so the type-verifier step no longer triggered on
  generated `.next/types/`.
- **PDF-VIEWER-OBJECTSTYLE-FIX-1** (this sprint) cleared the
  `pdf-viewer` source error.

**The arc is not yet closed.** Each cleared blocker has surfaced the
next one — the 60-error tsc pool still contains source errors that
tsc wasn't exercising fully because earlier stages failed first.
A one-per-sprint cadence (whack-a-mole) eventually lands the goal
but is not the shortest path. Two honest options for what comes next:

- **Option A — continue whack-a-mole:** one small sprint per error,
  same per-file discipline. Each is cheap. 60 is an upper bound on
  tsc errors, not a lower bound on sprints (fixing one may cascade-
  resolve multiple).
- **Option B — triage sprint:** one sprint spent categorizing all 60
  errors by kind (React-ref-variance, legacy-any-coercion, test-file
  `undefined` handling, etc.), then per-category mechanical passes.
  Probably lands build-PASS in 2–3 sprints rather than 10.

My read: Option B is leaner once the tsc pool is inventoried; Option A
is correct if the 60 contains a long tail of distinct shapes. A
quick Phase-1-style `tsc --noEmit | awk '{print $NF}' | sort | uniq -c`
on the error codes would answer this in 5 minutes.

Regardless, **the pdf-viewer specific target is done**; the build
gate remains one-or-more residual errors away from being a real
validation gate for all future sprints. Recording the arc's status
transparently so the next sprint's brief can reflect reality.

## 8. Anything surprising

- **Line number didn't shift.** The brief was drafted immediately
  after PAGE-SHAPE-CLEANUP-1 and nothing else modified this file;
  116 was still 116.
- **Author's `'normal' / 'normal'` was dead code.** The canvas
  renderer has never read `ObjectStyle.fontWeight` or
  `ObjectStyle.fontStyle` — the properties were tolerated silently
  until `npm run build` started actually running. This suggests
  there may be other pdf-viewer style objects carrying the same
  CSS-shaped dead keys elsewhere in the gated PDF subsystem; none
  surfaced in tsc because only this one was typed against
  `ObjectStyle` explicitly (others inferred and the inference
  apparently forgives the excess).
- **Build still doesn't PASS.** Expected this to be the sprint that
  closes the arc; it turned out to be another step along. Not a
  surprise in the strict sense (the brief wrote the
  Complete-with-residual clause for precisely this case) but worth
  flagging because the brief's opening language ("Closes the build-
  gate arc") set an optimistic expectation.

---

**Follow-up queued: `BUILD-GATE-CLOSE-1`** (scope TBD) — either a
targeted `dash-grid-view.tsx:362` fix (Option A) or a triage sprint
over the full 60-count pool (Option B). See §7 for the choice
framing.

**Sprint complete** (in-scope objective met; build-gate arc
continues).
