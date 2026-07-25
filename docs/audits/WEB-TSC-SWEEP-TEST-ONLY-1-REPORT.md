---
sprint: WEB-TSC-SWEEP-TEST-ONLY-1
date: 2026-04-23
author: Claude (Opus 4.7)
status: Complete (all gates green; apps/web tsc 60 → 9 as forecast)
---

# WEB-TSC-SWEEP-TEST-ONLY-1 — Mechanical sweep of 51 TEST-ONLY tsc errors

## 1. Purpose + scope recap

Mechanical sweep of the 51 TEST-ONLY errors categorized in
WEB-TSC-TRIAGE-1 Table D. No production source changes. Per-file
commit discipline preserved from LINT-BASELINE-1 precedent.

**In scope:** the 7 test files listed in Table B (see §4 below).
**Out of scope:** the 9 production-side errors (MECH-NULL ×5, CUT-DEBT
×3, MECH-REF ×1) — next sprint queue.

## 2. Phase 1 baseline

**Pre-sprint SHA:** `cef9157` (tip of WEB-TSC-TRIAGE-1).

| Baseline                           | Target | Observed                            |
| ---------------------------------- | ------ | ----------------------------------- |
| `packages/api` tsc                 | 164    | **164** ✓                           |
| `apps/web` tsc                     | 60     | **60** ✓                            |
| `apps/web` test files              | —      | 3 failed / 93 passed / 96 total     |
| `apps/web` tests                   | —      | 3 failed / 1002 passed / 1005 total |
| test-file errors (sum of per-file) | 51     | **51** ✓                            |

Per-file error counts matched WEB-TSC-TRIAGE-1 Table B exactly:

| File                       | Expected | Observed |
| -------------------------- | -------- | -------- |
| `follow-notes.test.ts`     | 16       | 16 ✓     |
| `polish-v2.test.ts`        | 10       | 10 ✓     |
| `threads-ui.test.ts`       | 9        | 9 ✓      |
| `doc-intel-web.test.ts`    | 9        | 9 ✓      |
| `notebook.test.ts`         | 4        | 4 ✓      |
| `screenshot-logic.test.ts` | 2        | 2 ✓      |
| `timeline-logic.test.ts`   | 1        | 1 ✓      |
| **Sum**                    | **51**   | **51** ✓ |

No drift from the triage inventory — scope was calibrated correctly.

## 3. Fix-pattern distribution

| Pattern                        | Instances | Approach                                                                                                                                                                                                                                                                                     |
| ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TS2532 `!` non-null assertion  | 39        | All array-index accesses on fixtures with known length preceded by `toHaveLength(...)`, explicit `filter` narrowing, or literal array declaration. Pattern: `items[0].foo` → `items[0]!.foo`.                                                                                                |
| TS2739 fixture-shape patch     | 3         | EvidenceClip fixtures in `follow-notes.test.ts` gained `notebookId: null` + `pinnedToChatId: null` (neutral null defaults; canonical type is `string \| null` for both).                                                                                                                     |
| TS2322 fixture-shape patch     | 2         | `NotebookBlockData` freehand variant fixtures in `notebook.test.ts` gained `svgPath: ''` (missing required field; neutral empty-string default — tests don't assert on path content).                                                                                                        |
| TS2322 declared-type narrow    | 2         | Same fixtures — changed declared type from `NotebookBlockData` (full union) to `Extract<NotebookBlockData, { type: 'freehand' }>` (the variant the test is checking), so `.points` / `.tool` no longer require per-access narrowing. This collapsed the companion TS2339 errors (see below). |
| TS2322 literal-type annotation | 1         | `threads-ui.test.ts:340` config literal typed as `TrackingConfig` (imported `type TrackingConfig from '@/stores/threads-store'`) so optional `strandId` / `consumeOnly` are part of the shape. This collapsed the companion TS2339 errors.                                                   |
| TS2322 optional-field fallback | 2         | `screenshot-logic.test.ts:87,89` `getAttachmentLabel()` returns — added `?? ''` on two branches (MessageAttachment.fileName is `string \| undefined`; neutral empty-string default).                                                                                                         |
| TS2339 collapsed by TS2322 fix | 4         | 2 in `notebook.test.ts` (dissolved by `Extract` narrowing), 2 in `threads-ui.test.ts` (dissolved by `TrackingConfig` annotation). No separate edits needed.                                                                                                                                  |
| TS2366 default-branch return   | 1         | `timeline-logic.test.ts:18` `getDefaultTimeRange` switch gained a `default: return { hoursBack: 24 }` branch for the unexercised narrow-resolution union variants (`15sec` / `5min` / `15min` / `6hr` / `12hr`).                                                                             |

Note on `!` vs `?.` choice: per the sprint's decision rules, `!` was chosen uniformly over `?.` because every site was a fixture guaranteed non-empty by adjacent `toHaveLength(...)` asserts, filter narrowing, or literal-array declaration. `?.` would have silently cascaded `undefined` on unexpected empty inputs and masked real test failures — `!` preserves the implicit "this fixture MUST contain this item" assertion.

## 4. Per-file summary

| #         | File                       | Before | After | Commit        | Patterns                                                                          |
| --------- | -------------------------- | ------ | ----- | ------------- | --------------------------------------------------------------------------------- |
| 1         | `follow-notes.test.ts`     | 16     | 0     | `e60ad53`     | 13× `!` + 3× fixture-shape (notebookId/pinnedToChatId)                            |
| 2         | `polish-v2.test.ts`        | 10     | 0     | `55baaa9`     | 10× `!` on shortcuts[0] / toasts[0]                                               |
| 3         | `threads-ui.test.ts`       | 9      | 0     | `d50cadc`     | 7× `!` on segments[0/1] / result[0] + 2× collapsed by `TrackingConfig` annotation |
| 4         | `doc-intel-web.test.ts`    | 9      | 0     | `ef89026`     | 9× `!` on result[0/1] / result.suggestions[0]                                     |
| 5         | `notebook.test.ts`         | 4      | 0     | `b2a47a7`     | 2× `svgPath: ''` + 2× collapsed by `Extract<..., { type: 'freehand' }>` narrowing |
| 6         | `screenshot-logic.test.ts` | 2      | 0     | `6bc5a89`     | 2× `?? ''` fallback on optional fileName                                          |
| 7         | `timeline-logic.test.ts`   | 1      | 0     | `a421b47`     | 1× `default:` branch with `{ hoursBack: 24 }` fallback                            |
| **Total** |                            | **51** | **0** | **7 commits** |                                                                                   |

**Incidental change in commit 4 (`ef89026`):** pre-commit hook
(lint-staged `--max-warnings=0`) caught a pre-existing
`no-explicit-any` warning at `doc-intel-web.test.ts:154`
(`isEditableField(null as any)` contract test). Annotated with
`// eslint-disable-next-line @typescript-eslint/no-explicit-any -- deferred to LINT-ANY-TYPES-1: ...`
matching the exact pattern used by the 8 other sites bundled in
LINT-BASELINE-1 phases 4+5. This is the same "absorbed hook tax"
pattern documented in LAUNCHER-LOG-BUFFER-1's phase-3 commit. Not
scope creep — the file was already open for the TS2532 fixes; the
hook refused to commit until the adjacent warning was annotated.

## 5. Fixture defaults used

The auditability record — every TS2739 / TS2322 shape-patch and the
default value chosen:

| File:Line                     | Type                                | Field added       | Default              | Rationale                                                                                  |
| ----------------------------- | ----------------------------------- | ----------------- | -------------------- | ------------------------------------------------------------------------------------------ |
| `follow-notes.test.ts:~236`   | `EvidenceClip`                      | `notebookId`      | `null`               | Canonical: `string \| null` — null = "not associated with a notebook"                      |
| `follow-notes.test.ts:~236`   | `EvidenceClip`                      | `pinnedToChatId`  | `null`               | Canonical: `string \| null` — null = "not pinned to a chat"                                |
| `follow-notes.test.ts:~249`   | `EvidenceClip`                      | `notebookId`      | `null`               | Same                                                                                       |
| `follow-notes.test.ts:~249`   | `EvidenceClip`                      | `pinnedToChatId`  | `null`               | Same                                                                                       |
| `follow-notes.test.ts:~262`   | `EvidenceClip`                      | `notebookId`      | `null`               | Same                                                                                       |
| `follow-notes.test.ts:~262`   | `EvidenceClip`                      | `pinnedToChatId`  | `null`               | Same                                                                                       |
| `notebook.test.ts:467`        | `NotebookBlockData.freehand`        | `svgPath`         | `''`                 | Canonical: `string` — empty string = "no path stored"; tests don't assert on content       |
| `notebook.test.ts:575`        | `NotebookBlockData.freehand`        | `svgPath`         | `''`                 | Same                                                                                       |
| `screenshot-logic.test.ts:87` | `MessageAttachment.fileName` return | fallback          | `att.fileName ?? ''` | Canonical: `string \| undefined` — empty string preserves return type `string`             |
| `screenshot-logic.test.ts:89` | `MessageAttachment.fileName` return | fallback          | `att.fileName ?? ''` | Same                                                                                       |
| `timeline-logic.test.ts:18`   | `Resolution` switch                 | `default:` branch | `{ hoursBack: 24 }`  | Matches the `'1hr'` branch; unexercised narrow variants (`15sec`–`12hr`) fall through here |

No fixture value invented with plausible test data — every added field used the semantically neutral default per the sprint spec.

## 6. Any BLOCKS encountered

**None.** All 7 files passed the decision rules cleanly. No property
was renamed without a clear successor; no test was checking for
absence in a way that broke the `!` pattern; no fixture required a
non-neutral default that changed test semantics.

## 7. Any `.skip` additions

**None.** All 51 errors resolved with type-level edits; no test
required a `.skip` fallback. Test counts at parity (see §10).

## 8. Gate outcomes

| Gate                             | Target                        | Result                                                                                                       |
| -------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A · api tsc                      | 164                           | **164** ✓                                                                                                    |
| A · web tsc                      | 9                             | **9** ✓ exact                                                                                                |
| B · remaining 9 match Table D    | exact match                   | ✓ see §9                                                                                                     |
| C · `npm run build` status       | still fails on dash-grid-view | ✓ unchanged (fails on same `dash-grid-view.tsx:362` React ref variance as post-PDF-VIEWER-OBJECTSTYLE-FIX-1) |
| D · test parity                  | 3/93/1002                     | **3/93/1002** ✓ identical                                                                                    |
| E · no production source touched | empty                         | ✓ all 7 diffs under `__tests__/`                                                                             |
| F · collateral bounded           | only tests + docs             | ✓ 7 test files + 1 report + CLAUDE.md                                                                        |

## 9. Remaining 9 errors

Verbatim from `npx tsc --noEmit` after the sprint — matches
WEB-TSC-TRIAGE-1 Table D non-TEST-ONLY rows exactly:

```
src/components/follow/dashboard/dash-grid-view.tsx(362,10): TS2322  MECH-REF
src/components/follow/notebook-picker.tsx(12,11):         TS2339  CUT-DEBT
src/components/follow/notebooks-grid.tsx(7,11):           TS2339  CUT-DEBT
src/components/follow/unit-chat-panel.tsx(107,5):         TS2322  CUT-DEBT
src/components/threads/CreateStrandFlow.tsx(83,15):       TS2322  MECH-NULL
src/components/threads/CreateStrandFlow.tsx(96,35):       TS2322  MECH-NULL
src/hooks/use-section-tracker.ts(77,23):                  TS18048 MECH-NULL
src/hooks/use-section-tracker.ts(77,42):                  TS18048 MECH-NULL
src/hooks/use-section-tracker.ts(77,61):                  TS18048 MECH-NULL
```

**No new errors introduced. No residual TEST-ONLY errors.** The
triage's categorization held perfectly — 51 fixed mechanically, 9
remain for next sprints.

## 10. Test-count delta

| Metric            | Baseline | After | Delta |
| ----------------- | -------- | ----- | ----- |
| Test files failed | 3        | 3     | 0     |
| Test files passed | 93       | 93    | 0     |
| Test files total  | 96       | 96    | 0     |
| Tests failed      | 3        | 3     | 0     |
| Tests passed      | 1002     | 1002  | 0     |
| Tests skipped     | 0        | 0     | 0     |
| Tests total       | 1005     | 1005  | 0     |

**Exact parity** on both files and individual tests. The 3 failing
test files are pre-existing pglite-WASM env failures (same ones that
have been parked since LINT-BASELINE-1's baseline) — unrelated to
this sprint.

Per-file passing-test counts confirmed during each phase:

- follow-notes: 16/16
- polish-v2: 31/31
- threads-ui: 34/34
- doc-intel-web: 53/53
- notebook: 33/33
- screenshot-logic: 17/17
- timeline-logic: 16/16

---

## Commit chain

8 commits on main:

1. `e60ad53` — phase-3: follow-notes.test.ts (13×TS2532 + 3×TS2739)
2. `55baaa9` — phase-4: polish-v2.test.ts (10×TS2532)
3. `d50cadc` — phase-5: threads-ui.test.ts (7×TS2532 + 2×TS2339)
4. `ef89026` — phase-6: doc-intel-web.test.ts (9×TS2532) + 1 deferred `any` annotation
5. `b2a47a7` — phase-7: notebook.test.ts (2×TS2322 + 2×TS2339)
6. `6bc5a89` — phase-8: screenshot-logic.test.ts (2×TS2322)
7. `a421b47` — phase-9: timeline-logic.test.ts (1×TS2366)
8. (this commit) — phase-11: report + CLAUDE.md

---

**Sprint complete.** `apps/web` tsc pool 60 → 9. Queue status:

- ✅ WEB-TSC-SWEEP-TEST-ONLY-1 (this sprint — 51 errors)
- ⏭ WEB-TSC-SWEEP-PROD-NULL-1 (next — 6 errors, bundles MECH-NULL + MECH-REF)
- ⏭ WEB-TSC-CUT-DEBT-NOTEBOOK-STORE-1 (2 errors, product decision)
- ⏭ WEB-TSC-CUT-DEBT-UNIT-CHAT-PROV-1 (1 error, product decision)

After the next sweep, 3 errors remain — all requiring product decisions, not mechanical fixes.
