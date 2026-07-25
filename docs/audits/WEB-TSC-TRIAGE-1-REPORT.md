---
sprint: WEB-TSC-TRIAGE-1
date: 2026-04-23
author: Claude (Opus 4.7)
status: Complete (read-only, diagnostic)
---

# WEB-TSC-TRIAGE-1 — Categorization of 60 apps/web tsc errors

## 1. Baseline confirmation

**Pre-sprint SHA:** `dfa82da` (tip of PDF-VIEWER-OBJECTSTYLE-FIX-1)

| Baseline           | Target | Observed  |
| ------------------ | ------ | --------- |
| `packages/api` tsc | 164    | **164** ✓ |
| `apps/web` tsc     | 60     | **60** ✓  |

Provenance:

```
wc -l /tmp/web-tsc-raw.txt    → 71 lines
wc -c /tmp/web-tsc-raw.txt    → 9437 bytes
grep -c "error TS"            → 60
```

The 11-line gap between total lines (71) and error lines (60) is
tsc's multi-line "related-type" detail (`Type 'X' is not assignable
to type 'Y'. Type 'A' is not assignable to type 'B'.` hierarchies
emit as continuation lines but the canonical error line is the first
`filepath(L,C): error TSXXXX: message` line).

## 2. Parse provenance

Parser regex: `^[^(]+\([0-9]+,[0-9]+\): error TS[0-9]+` — only
matches canonical error lines, ignores continuation detail.

Structured output format: `filepath|line|col|TScode|message`.

Field-count anomaly: some messages contain literal `|` characters
(TypeScript union notation inside messages like
`Type 'string | undefined' is not assignable`). Fields 1–4 are
always clean (file, line, col, code); field 5+ is the message.
Parsing operations downstream use `$4` (code) or `$1` (file), which
are unaffected.

```
awk -F'|' '{print NF}' structured.txt | sort -u  → 5, 6, 7
wc -l structured.txt                              → 60 ✓
```

## 3. Distribution by TS error code

| Count  | Code    | Name                                       | Cluster                                               |
| ------ | ------- | ------------------------------------------ | ----------------------------------------------------- |
| 39     | TS2532  | Object is possibly 'undefined'             | strict-null in tests                                  |
| 8      | TS2322  | Type X is not assignable to type Y         | mixed: string→undefined, ref variance, literal unions |
| 6      | TS2339  | Property does not exist on type            | stale test mocks + store-refactor drift               |
| 3      | TS2739  | Type missing properties from required type | test fixture drift (EvidenceClip shape)               |
| 3      | TS18048 | Value is possibly 'undefined'              | cousin of TS2532, all in one production hook          |
| 1      | TS2366  | Function lacks ending return statement     | one test helper lambda                                |
| **60** |         |                                            |                                                       |

**Codes not in the brief's anticipated common set:** the sprint brief
expected the usual suspects (TS2769 ref variance, TS7006 implicit-any,
TS18046 unknown-catch, TS2304 cannot-find-name, TS2353 excess-property).
**None of those appear.** The actual distribution is dominated by
strict-null-check failures (TS2532 + TS18048 = 42/60, 70%) with a long
thin tail.

Implication: the "long-tail of shapes" concern that motivated this
triage sprint was wrong — the pool is tight, heavily skewed toward one
family, and 85% lives in test files (see §4).

## 4. Distribution by surface bucket

**Table A — Errors by surface bucket:**

| Bucket                    | Files  | Errors | %        |
| ------------------------- | ------ | ------ | -------- |
| TEST                      | 7      | 51     | 85%      |
| COMPONENT-follow          | 4      | 4      | 7%       |
| HOOK                      | 1      | 3      | 5%       |
| COMPONENT-other (threads) | 1      | 2      | 3%       |
| **Total**                 | **13** | **60** | **100%** |

**No ROUTE-surface errors. No STORE-surface errors. No LIB-surface
errors. No CONFIG-surface errors.** This is a substantially different
shape from what a post-strip audit would typically surface — it means
the route / store / lib layers already type-check cleanly, and the
debt is isolated to (a) tests that lag source refactors and (b) four
follow-surface components + one hook.

## 5. Top 10 files by error count

**Table B — Top 10 files:**

| Rank | File                                                               | Bucket           | Errors | Dominant code              |
| ---- | ------------------------------------------------------------------ | ---------------- | ------ | -------------------------- |
| 1    | `src/components/follow/__tests__/follow-notes.test.ts`             | TEST             | 16     | TS2532 (×13) + TS2739 (×3) |
| 2    | `src/components/follow/__tests__/polish-v2.test.ts`                | TEST             | 10     | TS2532 (×10)               |
| 3    | `src/components/threads/__tests__/threads-ui.test.ts`              | TEST             | 9      | TS2532 (×7) + TS2339 (×2)  |
| 4    | `src/components/editors/rich-text/__tests__/doc-intel-web.test.ts` | TEST             | 9      | TS2532 (×9)                |
| 5    | `src/components/notebook/__tests__/notebook.test.ts`               | TEST             | 4      | TS2322 (×2) + TS2339 (×2)  |
| 6    | `src/hooks/use-section-tracker.ts`                                 | HOOK             | 3      | TS18048 (×3, all line 77)  |
| 7    | `src/components/threads/CreateStrandFlow.tsx`                      | COMPONENT-other  | 2      | TS2322 (×2)                |
| 8    | `src/components/chat/__tests__/screenshot-logic.test.ts`           | TEST             | 2      | TS2322 (×2)                |
| 9    | `src/components/timeline/__tests__/timeline-logic.test.ts`         | TEST             | 1      | TS2366 (×1)                |
| 10   | `src/components/follow/unit-chat-panel.tsx`                        | COMPONENT-follow | 1      | TS2322 (×1)                |
| 11   | `src/components/follow/notebooks-grid.tsx`                         | COMPONENT-follow | 1      | TS2339 (×1)                |
| 12   | `src/components/follow/notebook-picker.tsx`                        | COMPONENT-follow | 1      | TS2339 (×1)                |
| 13   | `src/components/follow/dashboard/dash-grid-view.tsx`               | COMPONENT-follow | 1      | TS2322 (×1)                |

(Table is only 13 rows because only 13 distinct files carry errors —
shorter than the requested "top 10" cap but there's nothing to trim.)

## 6. Distribution by fix category

**Taxonomy note:** the brief's template categories anticipated a mix
of MECH-IMPORT / MECH-PROP / MECH-REF / MECH-UNKNOWN / MECH-EXCESS /
MECH-ANY. The actual error distribution required a **new category**:

- **MECH-NULL** — strict-null-check failures (`TS2532`, `TS18048`, or
  `TS2322` with `T | undefined → T` shape) in **production** code.
  Distinct from TEST-ONLY: the fix is a runtime null-guard or non-null
  assertion, not a fixture update.

TEST-side strict-null errors go to TEST-ONLY (the fix is typically a
fixture/mock update plus some `?.` or `!` inside test helper code —
bundled as one sweep because tests are the scope).

**Table C — Errors by fix category:**

| Category  | Count  | Representative sample file                             |
| --------- | ------ | ------------------------------------------------------ |
| TEST-ONLY | 51     | `src/components/follow/__tests__/follow-notes.test.ts` |
| MECH-NULL | 5      | `src/hooks/use-section-tracker.ts`                     |
| CUT-DEBT  | 3      | `src/components/follow/notebooks-grid.tsx`             |
| MECH-REF  | 1      | `src/components/follow/dashboard/dash-grid-view.tsx`   |
| GATED-ROT | 0      | (none)                                                 |
| UNCLEAR   | 0      | (none)                                                 |
| **Total** | **60** |                                                        |

Zero UNCLEAR — every error categorized with confidence from static
inspection plus a few surgical `Read`/`Grep` probes (store-refactor
confirmation for notebooks-grid, `UnitActiveMode` union check for
unit-chat-panel).

## 7. Per-error assignment

**Table D — 60 rows, authoritative list future sprints grep:**

| #   | File                                                             | Line | TS    | Category  |
| --- | ---------------------------------------------------------------- | ---- | ----- | --------- |
| 1   | src/components/chat/**tests**/screenshot-logic.test.ts           | 87   | 2322  | TEST-ONLY |
| 2   | src/components/chat/**tests**/screenshot-logic.test.ts           | 89   | 2322  | TEST-ONLY |
| 3   | src/components/editors/rich-text/**tests**/doc-intel-web.test.ts | 224  | 2532  | TEST-ONLY |
| 4   | src/components/editors/rich-text/**tests**/doc-intel-web.test.ts | 225  | 2532  | TEST-ONLY |
| 5   | src/components/editors/rich-text/**tests**/doc-intel-web.test.ts | 226  | 2532  | TEST-ONLY |
| 6   | src/components/editors/rich-text/**tests**/doc-intel-web.test.ts | 227  | 2532  | TEST-ONLY |
| 7   | src/components/editors/rich-text/**tests**/doc-intel-web.test.ts | 239  | 2532  | TEST-ONLY |
| 8   | src/components/editors/rich-text/**tests**/doc-intel-web.test.ts | 251  | 2532  | TEST-ONLY |
| 9   | src/components/editors/rich-text/**tests**/doc-intel-web.test.ts | 267  | 2532  | TEST-ONLY |
| 10  | src/components/editors/rich-text/**tests**/doc-intel-web.test.ts | 268  | 2532  | TEST-ONLY |
| 11  | src/components/editors/rich-text/**tests**/doc-intel-web.test.ts | 322  | 2532  | TEST-ONLY |
| 12  | src/components/follow/**tests**/follow-notes.test.ts             | 86   | 2532  | TEST-ONLY |
| 13  | src/components/follow/**tests**/follow-notes.test.ts             | 87   | 2532  | TEST-ONLY |
| 14  | src/components/follow/**tests**/follow-notes.test.ts             | 106  | 2532  | TEST-ONLY |
| 15  | src/components/follow/**tests**/follow-notes.test.ts             | 109  | 2532  | TEST-ONLY |
| 16  | src/components/follow/**tests**/follow-notes.test.ts             | 112  | 2532  | TEST-ONLY |
| 17  | src/components/follow/**tests**/follow-notes.test.ts             | 122  | 2532  | TEST-ONLY |
| 18  | src/components/follow/**tests**/follow-notes.test.ts             | 126  | 2532  | TEST-ONLY |
| 19  | src/components/follow/**tests**/follow-notes.test.ts             | 129  | 2532  | TEST-ONLY |
| 20  | src/components/follow/**tests**/follow-notes.test.ts             | 138  | 2532  | TEST-ONLY |
| 21  | src/components/follow/**tests**/follow-notes.test.ts             | 183  | 2739  | TEST-ONLY |
| 22  | src/components/follow/**tests**/follow-notes.test.ts             | 184  | 2739  | TEST-ONLY |
| 23  | src/components/follow/**tests**/follow-notes.test.ts             | 185  | 2739  | TEST-ONLY |
| 24  | src/components/follow/**tests**/follow-notes.test.ts             | 191  | 2532  | TEST-ONLY |
| 25  | src/components/follow/**tests**/follow-notes.test.ts             | 210  | 2532  | TEST-ONLY |
| 26  | src/components/follow/**tests**/follow-notes.test.ts             | 211  | 2532  | TEST-ONLY |
| 27  | src/components/follow/**tests**/follow-notes.test.ts             | 212  | 2532  | TEST-ONLY |
| 28  | src/components/follow/**tests**/polish-v2.test.ts                | 55   | 2532  | TEST-ONLY |
| 29  | src/components/follow/**tests**/polish-v2.test.ts                | 56   | 2532  | TEST-ONLY |
| 30  | src/components/follow/**tests**/polish-v2.test.ts                | 59   | 2532  | TEST-ONLY |
| 31  | src/components/follow/**tests**/polish-v2.test.ts                | 62   | 2532  | TEST-ONLY |
| 32  | src/components/follow/**tests**/polish-v2.test.ts                | 78   | 2532  | TEST-ONLY |
| 33  | src/components/follow/**tests**/polish-v2.test.ts                | 276  | 2532  | TEST-ONLY |
| 34  | src/components/follow/**tests**/polish-v2.test.ts                | 277  | 2532  | TEST-ONLY |
| 35  | src/components/follow/**tests**/polish-v2.test.ts                | 278  | 2532  | TEST-ONLY |
| 36  | src/components/follow/**tests**/polish-v2.test.ts                | 284  | 2532  | TEST-ONLY |
| 37  | src/components/follow/**tests**/polish-v2.test.ts                | 297  | 2532  | TEST-ONLY |
| 38  | src/components/follow/dashboard/dash-grid-view.tsx               | 362  | 2322  | MECH-REF  |
| 39  | src/components/follow/notebook-picker.tsx                        | 12   | 2339  | CUT-DEBT  |
| 40  | src/components/follow/notebooks-grid.tsx                         | 7    | 2339  | CUT-DEBT  |
| 41  | src/components/follow/unit-chat-panel.tsx                        | 107  | 2322  | CUT-DEBT  |
| 42  | src/components/notebook/**tests**/notebook.test.ts               | 467  | 2322  | TEST-ONLY |
| 43  | src/components/notebook/**tests**/notebook.test.ts               | 478  | 2339  | TEST-ONLY |
| 44  | src/components/notebook/**tests**/notebook.test.ts               | 575  | 2322  | TEST-ONLY |
| 45  | src/components/notebook/**tests**/notebook.test.ts               | 585  | 2339  | TEST-ONLY |
| 46  | src/components/threads/CreateStrandFlow.tsx                      | 83   | 2322  | MECH-NULL |
| 47  | src/components/threads/CreateStrandFlow.tsx                      | 96   | 2322  | MECH-NULL |
| 48  | src/components/threads/**tests**/threads-ui.test.ts              | 133  | 2532  | TEST-ONLY |
| 49  | src/components/threads/**tests**/threads-ui.test.ts              | 134  | 2532  | TEST-ONLY |
| 50  | src/components/threads/**tests**/threads-ui.test.ts              | 135  | 2532  | TEST-ONLY |
| 51  | src/components/threads/**tests**/threads-ui.test.ts              | 136  | 2532  | TEST-ONLY |
| 52  | src/components/threads/**tests**/threads-ui.test.ts              | 156  | 2532  | TEST-ONLY |
| 53  | src/components/threads/**tests**/threads-ui.test.ts              | 157  | 2532  | TEST-ONLY |
| 54  | src/components/threads/**tests**/threads-ui.test.ts              | 222  | 2532  | TEST-ONLY |
| 55  | src/components/threads/**tests**/threads-ui.test.ts              | 343  | 2339  | TEST-ONLY |
| 56  | src/components/threads/**tests**/threads-ui.test.ts              | 344  | 2339  | TEST-ONLY |
| 57  | src/components/timeline/**tests**/timeline-logic.test.ts         | 18   | 2366  | TEST-ONLY |
| 58  | src/hooks/use-section-tracker.ts                                 | 77   | 18048 | MECH-NULL |
| 59  | src/hooks/use-section-tracker.ts                                 | 77   | 18048 | MECH-NULL |
| 60  | src/hooks/use-section-tracker.ts                                 | 77   | 18048 | MECH-NULL |

Note: rows 58–60 are all on line 77 of `use-section-tracker.ts` — same
expression, three positions where `bestHeading` is read after a narrow
that tsc can't follow. One local fix resolves all three.

## 8. GATED-ROT flag inventory

**None.** All 13 error-carrying files are live in the shipping surface.
The 4 follow-surface components that have production-level errors
(`notebooks-grid`, `notebook-picker`, `unit-chat-panel`, `dash-grid-view`)
are all consumed from `follow-main.tsx` (grep-verified for
`NotebooksGrid` / `NotebookPicker` / `UnitChatPanel`) — no feature-vault
flag reference in `apps/web/src/config/feature-vault.ts` matches any of
these file paths.

Practical consequence: **nothing in the pool can be deferred by gating.**
Every error is in code that either ships today or is a test that gates
CI.

## 9. UNCLEAR entries needing diagnostic micro-sprints

**None.** Zero UNCLEAR rows. All 60 errors were assignable from static
inspection (plus two surgical probes: the `NotebookState` refactor
confirmation and the `UnitActiveMode` union check).

## 10. Recommended sprint sequence

```
Recommended sprint sequence to close the build gate:

1. WEB-TSC-SWEEP-TEST-ONLY-1 — 51 errors across 7 test files
   — est 60–90 min CC time
   — mechanical: update test fixture shapes to match current source
     types (EvidenceClip notebookId/pinnedToChatId, NotebookBlockData
     discriminated union, threads store state shape) and add strict-
     null guards or `!` assertions where fixture arrays are indexed.
     One sweep. Per-file-commit rule applies; ~7 commits + 1 report.

2. WEB-TSC-SWEEP-PROD-NULL-1 — 6 errors across 3 production files
   — est 30–45 min CC time
   — mechanical: bundle MECH-NULL (5) + MECH-REF (1) into one prod-
     side sweep. CreateStrandFlow ×2 (null-guard), use-section-tracker ×3
     (one-line guard on bestHeading read), dash-grid-view ×1 (React-ref
     variance: inline callback-ref OR cast with comment per
     PAGE-SHAPE-CLEANUP-1 pattern). 3 commits + 1 report.

3. WEB-TSC-CUT-DEBT-NOTEBOOK-STORE-1 — 2 errors
   — est 1 session (needs product judgment)
   — notebook-picker.tsx + notebooks-grid.tsx both read `.notebooks`
     (plural) from `NotebookState`, but the store was refactored to
     `notebook: Notebook | null` (singular). Decision required:
     (a) rewrite both components to list notebooks via API instead of
         reading from the store
     (b) re-add a `notebooks` collection to the store
     (c) archive both components (if strip-arc intended to drop them)
     These are live components consumed from `follow-main.tsx` so
     option (c) is unlikely without broader UI work.

4. WEB-TSC-CUT-DEBT-UNIT-CHAT-PROV-1 — 1 error
   — est 15–30 min (likely a one-liner once decided)
   — unit-chat-panel.tsx:107 references a `'prov'` mode not in
     `UnitActiveMode = 'none' | 'web' | 'doc' | 'memory' | 'notes'`.
     Decision required: add `'prov'` to the union (if the provenance
     mode is a real product feature) OR remove the button (if it was
     a draft that escaped the strip).

Total estimated fix sprints: 4
Total estimated CC time: ~2.5–3.5 hours + 2 session-level decisions
                        for sprints 3 and 4
Total expected error reduction: 60 → 0 (build gate closed)
```

**Order rationale:**

- **Sprints 1–2 first (mechanical):** 57 of 60 errors (95%) are
  mechanical sweeps with no product decisions. Running these first
  drops the tsc pool from 60 → 3 in one session's worth of work and
  makes the remaining 3 decisions crisp.
- **Sprints 3–4 last (product judgment):** these need Rishabh's call
  on what the store's shape and the unit chat modes should be.
  Putting them after the sweeps means the decision isn't contaminated
  by "fix everything now" pressure — the only thing gating `npm run build`
  at that point is 3 specific product questions.
- **Bundle rationale for sprint 2:** 5 MECH-NULL + 1 MECH-REF in 3
  files — too small for separate sprints, too distinct from TEST-ONLY
  to merge there. Production-side mechanical batch.

## 11. Cross-checks

- **Sum of category counts equals 60:** TEST-ONLY 51 + MECH-NULL 5 +
  CUT-DEBT 3 + MECH-REF 1 + GATED-ROT 0 + UNCLEAR 0 = **60** ✓
- **Every file in Table B appears in Table D:** verified by grep —
  all 13 files from Table B have at least one row in Table D rows 1–60.
- **No fixes proposed beyond category + sprint name:** report contains
  no code suggestions, no patches, no snippets. The sprint-sequence
  section describes shape-of-fix (e.g., "null-guard", "fixture
  update") but names no specific edits.
- **No source diff:** verified via Gate A in Phase 7.
- **Tsc parity preserved:** 164 api / 60 web at start and end of
  sprint — no work touched either.
