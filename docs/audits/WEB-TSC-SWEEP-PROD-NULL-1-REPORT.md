---
sprint: WEB-TSC-SWEEP-PROD-NULL-1
date: 2026-04-23
author: Claude (Opus 4.7)
status: Complete (all gates green; apps/web tsc 9 → 3 as forecast)
---

# WEB-TSC-SWEEP-PROD-NULL-1 — Production strict-null + ref-variance sweep

## 1. Purpose + scope recap

Mechanical sweep of the 6 production-side errors categorized in
WEB-TSC-TRIAGE-1 Table D — 5 MECH-NULL (strict-null narrowing) across
2 files + 1 MECH-REF (React ref variance) in 1 file. Bundles the two
production categories into one sprint because the collective effort
is small (~30 min) and the fix patterns are closely related.

**In scope:** 3 source files — `CreateStrandFlow.tsx`,
`use-section-tracker.ts`, `dash-grid-view.tsx`.
**Out of scope:** 3 CUT-DEBT errors (notebook-picker, notebooks-grid,
unit-chat-panel) — product-decision sprints next.

## 2. Phase 1 baseline

**Pre-sprint SHA:** `edd9531` (tip of WEB-TSC-SWEEP-TEST-ONLY-1).

| Baseline               | Target    | Observed                            |
| ---------------------- | --------- | ----------------------------------- |
| `packages/api` tsc     | 164       | **164** ✓                           |
| `apps/web` tsc         | 9         | **9** ✓                             |
| `apps/web` tests       | —         | 3 failed / 1002 passed / 1005 total |
| target per-file counts | 2 / 3 / 1 | **2 / 3 / 1** ✓                     |

**Build baseline (verbatim):**

```
./src/components/follow/dashboard/dash-grid-view.tsx:362:10
Type error: Type 'RefObject<HTMLDivElement | null>' is not assignable
  to type 'LegacyRef<HTMLDivElement> | undefined'.
  Type 'RefObject<HTMLDivElement | null>' is not assignable to type
    'RefObject<HTMLDivElement>'.
    Type 'HTMLDivElement | null' is not assignable to type 'HTMLDivElement'.
      Type 'null' is not assignable to type 'HTMLDivElement'.
```

Unchanged from PAGE-SHAPE-CLEANUP-1 Gate B — same file, line, and
error chain.

## 3. Phase 2 per-file context findings

**CreateStrandFlow.tsx (2 errors, lines 83, 96):**

- Both errors fire where `color: string | undefined` is passed to a
  child prop typed `string`.
- Root cause at line 21: `useState(STRAND_COLORS[0])`. `STRAND_COLORS`
  is a local 10-element `const` array; under
  `noUncheckedIndexedAccess`, `[0]` is typed `string | undefined`
  even though it's always defined at runtime.
- Null-case intended behavior: **none defined** — the code is written
  assuming `color` is always a string, because it always is.
- Chosen fix: soft-fallback at the source. `useState<string>(STRAND_COLORS[0] ?? '#7C6EF7')`
  with the fallback value matching the first literal (runtime behavior
  identical; fallback is unreachable). Single edit at the declaration
  collapses both downstream errors.
- No `!` used.

**use-section-tracker.ts (3 errors, all line 77):**

- All three errors are on the same expression:
  `setCurrentSection(bestHeading.index, bestHeading.title, bestHeading.level)`.
- Root cause at line 55: `let bestHeading = headingsRef.current[0]`.
  Under `noUncheckedIndexedAccess`, that's `Heading | undefined`.
  The enclosing function early-returns at line 49 if
  `headingsRef.current.length === 0`, so `[0]` is genuinely always
  defined — but TS's flow analysis can't follow the length-check
  relationship across `useCallback` + the in-loop reassignment.
- This is the "narrowing tsc can't follow" case from the spec. The
  runtime invariant is solid (verified by reading line 49's guard).
- Null-case intended behavior: per the line 49 guard, absence = no-op.
- Chosen fix: hard-narrow via one-line guard — `if (!bestHeading) return`
  before line 77. Collapses all 3 errors with one edit. Defensive
  (unreachable given line 49) but expressively honest about the
  invariant.
- No `!` used.

**dash-grid-view.tsx (1 error, line 362):**

- `<div ref={ref}>` where `ref: RefObject<HTMLDivElement | null>` from
  `useDocumentIntel()`. Built-in `<div>` ref prop expects
  `LegacyRef<HTMLDivElement>` which doesn't accept the `| null` variant.
- The hook is consumed by 2 files (dash-grid-view + doc-top-bar-v2);
  changing its declared return type would touch doc-top-bar-v2 which
  is out-of-scope per sprint constraints.
- `<div>` is a React built-in — ref-prop type is fixed.
- Chosen fix: cast-at-use-site per spec Option B —
  `ref={ref as LegacyRef<HTMLDivElement>}` with a comment naming the
  runtime variance rationale. Added `type LegacyRef` to the existing
  `react` import. Runtime behavior unchanged (RefObject and LegacyRef
  are the same mutable-ref mechanism at runtime).

**No BLOCKs.** All 3 fix patterns are mechanical, behavior-preserving,
and within the sprint's scope guardrails.

## 4. Fix patterns applied

| Pattern                        | File                     | Count             | Rationale                                                                                                                          |
| ------------------------------ | ------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Soft fallback at source        | `CreateStrandFlow.tsx`   | 1 edit → 2 errors | `useState<string>(STRAND_COLORS[0] ?? '#7C6EF7')`. Fallback unreachable (const array non-empty); match source literal.             |
| Hard narrow via one-line guard | `use-section-tracker.ts` | 1 edit → 3 errors | `if (!bestHeading) return` before the 3-read setCurrentSection call. Defensive expression of the line 49 length-guard invariant.   |
| Cast at use site with comment  | `dash-grid-view.tsx`     | 1 edit → 1 error  | `ref as LegacyRef<HTMLDivElement>`. Hook return type out-of-scope; built-in `<div>` can't be retyped. Runtime-compatible variance. |

**Zero `!` non-null assertions used in production code.** All fixes
preserve runtime behavior by either matching an existing source
literal (soft fallback), explicitly narrowing with a guard (hard
narrow), or reconciling a runtime-compatible type variance (cast).

## 5. Per-file summary

| #         | File                     | Before | After | Commit        | Pattern                                    | Notes                                                                         |
| --------- | ------------------------ | ------ | ----- | ------------- | ------------------------------------------ | ----------------------------------------------------------------------------- |
| 1         | `CreateStrandFlow.tsx`   | 2      | 0     | `73c19c4`     | Soft fallback at source                    | Single edit at line 21 `useState` declaration; threads-ui tests pass 34/34.   |
| 2         | `use-section-tracker.ts` | 3      | 0     | `f940a72`     | Hard narrow via one-line guard             | Single `if (!bestHeading) return` insert; no tests import this hook directly. |
| 3         | `dash-grid-view.tsx`     | 1      | 0     | `7e640e2`     | Cast at use site + `type LegacyRef` import | Single cast at line 362; build now advances past this file.                   |
| **Total** |                          | **6**  | **0** | **3 commits** |                                            |                                                                               |

## 6. Any BLOCKS encountered

**None.** All 3 files passed the decision-rule inspection cleanly.

- **use-section-tracker line 77** was the one case the spec flagged as
  potentially a bug-masked-as-lint situation. Inspection of lines
  48–75 confirmed the length-guard is real and the narrowing loop
  runtime-preserves presence. No BLOCK; standard narrowing-tsc-can't-
  follow case.
- **dash-grid-view** was the one case where prop-type generalization
  at the hook might have been cleaner. Inspection showed the hook is
  imported by `doc-top-bar-v2` (not destructuring `ref`), so changing
  its return type would still touch a file outside the sprint's
  3-file allowlist. Cast-at-use-site was the correct bounded fix.

## 7. Gate outcomes

| Gate                            | Target                      | Result                                                       |
| ------------------------------- | --------------------------- | ------------------------------------------------------------ |
| A · api tsc                     | 164                         | **164** ✓                                                    |
| A · web tsc                     | 3                           | **3** ✓ exact                                                |
| B · remaining 3 = CUT-DEBT rows | exact match                 | ✓ (see §9)                                                   |
| C · `npm run build`             | PASS or advance to CUT-DEBT | **Outcome 2: advances to `notebook-picker.tsx:12`** (see §8) |
| D · test parity                 | 3/93/1002                   | **3/93/1002** ✓ identical                                    |
| E · source scope bounded        | only 3 target files         | ✓ no apps/web/src changes outside the allowlist              |
| F · no tests touched            | empty                       | ✓ empty                                                      |
| G · collateral bounded          | only 3 files + docs         | ✓ empty                                                      |

## 8. `npm run build` outcome classification

**Outcome 2: advances to first CUT-DEBT error.** Exact stanza:

```
./src/components/follow/notebook-picker.tsx:12:11
Type error: Property 'notebooks' does not exist on type 'NotebookState'.

 10 |
 11 | export function NotebookPicker({ onSelect, onCreateNew, onClose: _onClose }: NotebookPickerProps) {
>12 |   const { notebooks } = useNotebookStore()
    |           ^
 13 |
 14 |   const notebookList = notebooks
 15 |     ? Object.entries(notebooks).map(([id, nb]) => ({

Next.js build worker exited with code: 1 and signal: null
```

This is **`WEB-TSC-CUT-DEBT-NOTEBOOK-STORE-1` territory** — the
product-decision sprint on what `notebook-picker.tsx` and
`notebooks-grid.tsx` should do now that the store's `notebooks`
collection has been refactored to singular `notebook: Notebook | null`.

Build-gate arc is now **two sprints + two product decisions away** from
closing (one sprint per CUT-DEBT cluster):

- `WEB-TSC-CUT-DEBT-NOTEBOOK-STORE-1` (2 errors — notebook-picker + notebooks-grid)
- `WEB-TSC-CUT-DEBT-UNIT-CHAT-PROV-1` (1 error — unit-chat-panel)

## 9. Remaining 3 errors

Verbatim from `npx tsc --noEmit`:

```
src/components/follow/notebook-picker.tsx(12,11): error TS2339: Property 'notebooks' does not exist on type 'NotebookState'.
src/components/follow/notebooks-grid.tsx(7,11):   error TS2339: Property 'notebooks' does not exist on type 'NotebookState'.
src/components/follow/unit-chat-panel.tsx(107,5): error TS2322: Type '"prov"' is not assignable to type 'UnitActiveMode'.
```

Matches WEB-TSC-TRIAGE-1 Table D CUT-DEBT rows exactly. No new errors
surfaced by this sprint's edits; no residual MECH-\* errors.

## 10. Build-gate arc status

```
Build-gate arc progress:
  LINT-BASELINE-1             ✓ lint debt cleared
  PAGE-SHAPE-CLEANUP-1        ✓ 3 Next 14 page-shape errors
  PDF-VIEWER-OBJECTSTYLE-FIX-1 ✓ 1 ObjectStyle mismatch
  WEB-TSC-TRIAGE-1            ✓ 60 errors inventoried & categorized
  WEB-TSC-SWEEP-TEST-ONLY-1   ✓ 51 test errors (60 → 9)
  WEB-TSC-SWEEP-PROD-NULL-1   ✓ 6 production errors (9 → 3)  [THIS SPRINT]
  WEB-TSC-CUT-DEBT-NOTEBOOK-STORE-1   ⏭ 2 errors, 1 session + product decision
  WEB-TSC-CUT-DEBT-UNIT-CHAT-PROV-1   ⏭ 1 error, 15–30 min + product decision
  —— build gate closes ——
```

**2 sprints and 2 product decisions remaining.**

The arc's tail has been product-decision-bound since WEB-TSC-TRIAGE-1;
this sprint delivers the predicted mechanical cleanup and leaves only
the CUT-DEBT decisions between here and `npm run build` passing clean.

---

## Commit chain

4 commits on main:

1. `73c19c4` — phase-3: CreateStrandFlow.tsx (2×TS2322 null-guard)
2. `f940a72` — phase-4: use-section-tracker.ts (3×TS18048 single-expression narrow)
3. `7e640e2` — phase-5: dash-grid-view.tsx (1×TS2322 ref variance)
4. (this commit) — phase-7: report + CLAUDE.md

---

**Sprint complete.** tsc pool 9 → 3. Next: CUT-DEBT product-decision sprints.
