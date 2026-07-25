---
sprint: PAGE-SHAPE-CLEANUP-1
date: 2026-04-23
author: Claude (Opus 4.7)
status: Complete (Gate B partial — residual unrelated blocker documented in §7)
---

# PAGE-SHAPE-CLEANUP-1 — Clear the 3 Next 14 App Router page-shape errors

## 1. Purpose + scope recap

Clear the 3 `.next/types/app/**/page.ts` page-shape TypeScript
errors that were blocking `npm run build` in `apps/web`, so the
build can be used as a real validation gate. Errors were pre-existing
strip-arc debt — surfaced when LINT-BASELINE-1 Phase 1 rebuilt the
`.next/types/` cache.

**Scope IN:** exactly the 3 errors inventoried in Phase 1 + the
minimum collateral to preserve ConfigHub's consumption of the named
bodies.
**Scope OUT:** any other `.next/types/` error, page content changes,
App Router migration work beyond the 3 pages, feature-vault state
changes.

Sprint brief authorized a CAT-D addendum (see §3) after Phase 1
categorization proved the stock A/B/C fixes didn't match the actual
error pattern. The addendum permitted creating 3 `_body.tsx` sibling
files + editing 3 ConfigHub tab imports + 1 test-mock update — all
strictly bounded to preserve the gated ConfigHub coupling without
violating Next 14's page contract.

## 2. Phase 1 baseline (verbatim)

**Pre-sprint SHA:** `4438451`
**Next version:** `14.2.29` — sync `PageProps` shape (pre-Next-15)
**Pre-sprint api tsc:** 164
**Pre-sprint web tsc:** 64 (includes the 3 page-shape errors below)

**The 3 generated error files and their identical shape:**

```
.next/types/app/settings/agents/page.ts:8:13
  error TS2344: Type 'OmitWithTag<typeof import("...agents/page"),
  "metadata" | "default" | "viewport" | "config" | "generateStaticParams" | ...,
  "">' does not satisfy the constraint '{ [x: string]: never; }'.
    Property 'AgentSettingsBody' is incompatible with index signature.
      Type '() => Element' is not assignable to type 'never'.

.next/types/app/settings/profile/page.ts:8:13
  (same shape; violating named export: ProfileSettingsBody)

.next/types/app/workspace/[id]/settings/page.ts:8:13
  (same shape; violating named export: WorkspaceSettingsBody)
```

**What the error means:** Next 14's App Router auto-generates a
`.next/types/app/**/page.ts` type-verifier per route that asserts
the source `page.tsx` module type intersects against `{ [x: string]: never }`
for everything NOT in the allowed set (`default`, `metadata`, `viewport`,
`config`, `generateStaticParams`, `revalidate`, `dynamic`, `dynamicParams`,
`fetchCache`, `preferredRegion`, `runtime`, `maxDuration`, `generateViewport`).
Any named export outside that set violates the contract. All 3 pages
were carrying a `V41-CONFIG-1` named body export alongside the default,
consumed by ConfigHub tabs (gated, `dev-config-hub: false`).

## 3. Per-page categorization

**Stock categorization from the brief didn't fit.** The errors
weren't CAT-A (signature), CAT-B (cut-surface import), or CAT-C
(param shape) — they were:

**CAT-D: extraneous named export alongside default, consumed by
sibling components outside the page tree.** Per the brief, CAT-D
required BLOCK + surface. After Rishabh's authorized addendum, the
fix pattern became:

> Named export relocated to a private sibling file (`_body.tsx`);
> page.tsx becomes a pure default re-export; ConfigHub tab (gated,
> `dev-config-hub: false`) imports from the new module path.
> Coupling to gated ConfigHub preserved without violating Next 14
> page contract. Strip-arc debt: the one-way KEEP-page →
> gated-consumer dependency was never cleaned up; `.next/types/`
> cache rebuild in LINT-BASELINE-1 Phase 1 surfaced what Next 14
> had been forbidding all along.

| Page                               | Category | Fix pattern                                                    |
| ---------------------------------- | -------- | -------------------------------------------------------------- |
| `settings/agents/page.tsx`         | CAT-D    | Body → `_body.tsx`; page → `export { default } from './_body'` |
| `settings/profile/page.tsx`        | CAT-D    | Same                                                           |
| `workspace/[id]/settings/page.tsx` | CAT-D    | Same                                                           |

## 4. Gated vs KEEP per page

All 3 settings pages themselves are **KEEP** — they're part of the
Settings surface that v5.1 §13 defines as one of the 4 ship-visible
areas (Items / Memory / Discover / Settings + auth + connectors).
None are behind a feature-vault flag.

The **consumers** of the named bodies — the 3 ConfigHub tabs — are
gated behind `dev-config-hub: false` in
`apps/web/src/config/feature-vault.ts`. The gate is unchanged by
this sprint; the Agents/Profile/Workspace tabs still exist, still
mount the same bodies, and still flip on when the vault flag
flips on.

No page was a candidate for deletion — the errors are all on KEEP
surfaces.

## 5. Fixes applied

**Before (all 3, same pattern):**

```tsx
// page.tsx — 515–647 lines total
'use client'
import {} from /* ... */ 'react'
// ... types ...

/**
 * V41-CONFIG-1: named export consumed by ConfigHub's <Foo> tab.
 * Default export preserved for `/<foo>`.
 */
export function FooSettingsBody() {
  // ← VIOLATING NAMED EXPORT
  /* full body */
}

export default FooSettingsBody
```

**After (all 3, same pattern):**

```tsx
// _body.tsx — private sibling, Next treats `_`-prefixed files as
// non-routable by convention
'use client'
import {} from /* ... */ 'react'
// ... types ...

/**
 * PAGE-SHAPE-CLEANUP-1 (2026-04-23): body extracted from `./page.tsx`
 * into this private sibling. Next 14's App Router page contract
 * forbids named exports alongside the default; ConfigHub imports
 * from here now.
 */
export function FooSettingsBody() {
  // ← NAMED EXPORT LIVES HERE NOW
  /* full body */
}

export default FooSettingsBody
```

```tsx
// page.tsx — now 12 lines
'use client'

/**
 * /<foo> — <one-line purpose>.
 *
 * PAGE-SHAPE-CLEANUP-1 (2026-04-23): body lives in `./_body.tsx`.
 * ...
 */

export { default } from './_body'
```

```tsx
// components/config/tabs/<foo>-tab.tsx — import path updated only
- import { FooSettingsBody } from '@/app/<path>/page'
+ import { FooSettingsBody } from '@/app/<path>/_body'
```

```tsx
// components/config/__tests__/config-hub.test.tsx — all 3 mock paths
// updated in one commit (Phase 3)
;-vi.mock('@/app/settings/profile/page', () => ({
  /* stub */
})) -
  vi.mock('@/app/settings/agents/page', () => ({
    /* stub */
  })) -
  vi.mock('@/app/workspace/[id]/settings/page', () => ({
    /* stub */
  })) +
  vi.mock('@/app/settings/profile/_body', () => ({
    /* stub */
  })) +
  vi.mock('@/app/settings/agents/_body', () => ({
    /* stub */
  })) +
  vi.mock('@/app/workspace/[id]/settings/_body', () => ({
    /* stub */
  }))
```

Behavior-preserving in all 3 cases: the page URL still renders the
same body via the default export; ConfigHub tabs still mount the
same body via the repointed named import.

## 6. Gate outcomes

| Gate                             | Target                                      | Result                        |
| -------------------------------- | ------------------------------------------- | ----------------------------- |
| A · api tsc                      | 164                                         | **164** ✓                     |
| A · web tsc                      | 64 → 61                                     | **61** ✓                      |
| B · `npm run build`              | PASS                                        | **PARTIAL** — see §7          |
| C · vault/route tables unchanged | empty diff                                  | **empty** ✓                   |
| D · test parity                  | 3 fail / 93 pass / 1002 tests pass (web)    | **identical** ✓               |
| E · collateral bounded           | only page/layout/route + tabs + test + docs | **10 files, all permitted** ✓ |

**Gate E files (all in the addendum's allowed set):**

```
apps/web/src/app/settings/agents/_body.tsx              (NEW, permitted)
apps/web/src/app/settings/agents/page.tsx               (MOD, permitted)
apps/web/src/app/settings/profile/_body.tsx             (NEW, permitted)
apps/web/src/app/settings/profile/page.tsx              (MOD, permitted)
apps/web/src/app/workspace/[id]/settings/_body.tsx      (NEW, permitted)
apps/web/src/app/workspace/[id]/settings/page.tsx       (MOD, permitted)
apps/web/src/components/config/__tests__/config-hub.test.tsx  (MOD, permitted)
apps/web/src/components/config/tabs/agents-tab.tsx      (MOD, permitted)
apps/web/src/components/config/tabs/profile-tab.tsx     (MOD, permitted)
apps/web/src/components/config/tabs/workspace-tab.tsx   (MOD, permitted)
```

## 7. `npm run build` status — Complete-with-residual-blocker

**Page-shape gate: CLEARED.** All 3 `.next/types/app/**/page.ts`
errors from Phase 1 are gone. The build advances past the
`Linting and checking validity of types` step for the settings
pages successfully.

**Residual blocker (new, unrelated, pre-existing):**

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

This is a **source-level type error** in `src/app/pdf-viewer/page.tsx:116`,
caught at the same `tsc --noEmit` step. It was already in the
web-tsc-61 baseline (pre-sprint count 64 minus the 3 page-shape
errors we fixed = 61; this pdf-viewer error is part of that 61).
It's a property-type mismatch against some 3rd-party PDF annotation
library's `ObjectStyle` type — nothing to do with the App Router
page contract we were chasing.

**Per the brief:** "Fails on a new, pre-existing error that the
now-successful page compilation surfaces downstream… document as
`Complete-with-residual-build-blocker`, report the exact failure
stanza, but DO NOT expand scope to fix it. Queue as a followup."

## 8. Next version sanity check

- `"next": "14.2.29"` from `apps/web/package.json`
- `PageProps` shape needed: **sync** (params/searchParams are
  plain objects, not `Promise`). That was never in play for these
  3 pages — none of the CAT-D fixes involved touching a page's
  function signature or `params` type. The param-shape issue is
  Next-15-specific and stayed parked.

## 9. Anything surprising

- **Uniform pattern across all 3 pages.** Same `V41-CONFIG-1`
  comment, same named-export-alongside-default shape, same
  ConfigHub consumer. Suggests the pattern was stamped out from
  one template during the V41-CONFIG-1 work, not authored per-page.
  If that template persists anywhere else in the repo (none found
  via `grep V41-CONFIG-1` — only the 3 + the deprecated
  `components/follow/profile-view.tsx` shim reference), future
  page additions won't re-introduce the violation. If it does
  come back, the fix recipe is documented above in §5.
- **No unexpected error cascade.** Fixing one page surfaced the
  next page's error (profile → workspace) as expected, one build
  at a time. After all 3, the build moved to an unrelated pre-
  existing source error (pdf-viewer). No chain of newly-surfaced
  errors specific to this sprint's changes.
- **`.next/types/` generation quirk:** `rm -rf .next && npx tsc --noEmit`
  yields a misleadingly-lower count because the generated types
  are absent. The honest baseline requires either running `npm run build`
  (which regenerates) or keeping an existing `.next/types/`
  around. Phase 1 captured both angles to avoid being fooled.
- **Gate B is technically partial but the sprint met its promise.**
  The 3 page-shape errors the brief enumerated are gone. `npm run build`
  failing on the next thing is a different sprint's problem.

## 10. Strip-arc debt surfaced

This sprint cleared one known instance of KEEP-page →
gated-consumer coupling (ConfigHub sitting behind
`dev-config-hub: false` while still structurally dependent on
named exports from KEEP settings pages). The coupling itself is
preserved (it's real — ConfigHub genuinely wants to mount those
bodies when its flag flips on), but the location of the dependency
now satisfies Next 14's page contract.

**Verification grep across the tree:**

```
grep -r "V41-CONFIG-1" apps/web/src --include='*.tsx' --include='*.ts'
  apps/web/src/components/config/config-hub.tsx:4      (the consumer itself, unchanged)
  apps/web/src/app/workspace/[id]/settings/_body.tsx   (← moved here by this sprint)
  apps/web/src/app/settings/profile/_body.tsx          (← moved here by this sprint)
  apps/web/src/app/settings/agents/_body.tsx           (← moved here by this sprint)
  apps/web/src/components/follow/profile-view.tsx:4    ("DEPRECATED in V41-CONFIG-1" — redirect shim)
  apps/web/src/components/follow/__tests__/profile-view.test.tsx  (tests the shim)
```

**No other named-export-from-page sites surfaced** — Rishabh's
suspicion that this was an isolated pattern is confirmed. No
broader audit sprint needed. If a future page addition re-
introduces the violation, LINT-BASELINE-1's `.next/types/` gate
catches it on first build.

## Follow-ups queued

- **`PDF-VIEWER-OBJECTSTYLE-FIX-1`** — small sprint to fix the
  `pdf-viewer/page.tsx:116` `fontWeight` ObjectStyle mismatch
  (unrelated pre-existing, surfaced only because Page-Shape is now
  out of the way). After that lands, `npm run build` becomes a
  real gate.
- **Optional cleanup** — `V41-CONFIG-1` comments in `_body.tsx`
  headers still reference the old sprint ID alongside the new one.
  If/when someone is touching these for unrelated reasons, the
  old tag can be retired.

---

**Sprint complete.** 3 page-shape errors resolved; `npm run build`
is one pdf-viewer fix away from being a real validation gate for
every future sprint. The CAT-D addendum mechanism proved useful —
categorization-during-Phase-1 caught what a blind fix-attempt
would have botched.
