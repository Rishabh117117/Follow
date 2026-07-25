---
sprint: AUTH-LOGIN-SUSPENSE-1
date: 2026-04-23
author: Claude (Opus 4.7)
status: Complete — `npm run build` PASSES; infrastructure arc CLOSED
---

# AUTH-LOGIN-SUSPENSE-1 — Wrap `useSearchParams()` at `/auth/login` in `<Suspense>`

## 1. Purpose + scope recap

Close the one residual blocking `npm run build`: Next 14's static-
prerender step requires any component calling `useSearchParams()`
to sit under a `<Suspense>` boundary. The `/auth/login` page has
been failing this check since before the v5.1 strip; it only became
visible after WEB-TSC-CUT-DEBT-COMBINED-1 brought `apps/web` tsc to
zero and the build reached the static-export phase.

**In scope:** `apps/web/src/app/auth/login/page.tsx` — single-file,
~5-line fix.

**Out:** any other page with a similar issue (none surfaced — verified
via successful full build).

## 2. Phase 1 baseline

**Pre-sprint SHA:** `ef33ee1` (tip of WEB-TSC-CUT-DEBT-COMBINED-1).

| Baseline           | Target | Observed  |
| ------------------ | ------ | --------- |
| `packages/api` tsc | 164    | **164** ✓ |
| `apps/web` tsc     | 0      | **0** ✓   |

**Build failure stanza (verbatim, pre-sprint):**

```
⨯ useSearchParams() should be wrapped in a suspense boundary at page "/auth/login".
  Read more: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout

Error occurred prerendering page "/auth/login". Read more:
https://nextjs.org/docs/messages/prerender-error

> Export encountered errors on following paths:
	/auth/login/page: /auth/login
```

**File location:** `apps/web/src/app/auth/login/page.tsx` (single file;
no nested auth components).

**`useSearchParams()` call site:** directly inside the default-
exported `LoginPage` component at line 24. Page has `'use client'`
at line 1. No existing `<Suspense>` usage anywhere in the file.

**Neighbor inspection:** no `src/components/auth/` directory exists;
`/auth/login` is the only page in the `auth/` tree. No shared loader
component to match a fallback against.

## 3. Case + fallback chosen

**CASE-A** per the sprint spec — `useSearchParams()` is called
directly inside the page component that Next 14 is trying to
prerender. Wrap has to sit above the call, so extract the body into
a file-local `LoginPageContent` and make the default export a thin
`<Suspense>` around it.

**Fallback:** `null`. Justification:

- No neighboring auth loader exists to match a style against (no
  `src/components/auth/`, no sibling `signup` page).
- Login form renders essentially instantly on the client (state is
  all local; session check is synchronous from `useSession()`); a
  spinner would flash visibly for one paint frame and look worse
  than a direct render.
- Keeps the diff minimal — no new imports pulled from outside the
  file.

## 4. Before / after diff summary

```diff
 'use client'

 import { signIn, useSession } from 'next-auth/react'
 import { useRouter, useSearchParams } from 'next/navigation'
-import { useEffect, useState } from 'react'
+import { Suspense, useEffect, useState } from 'react'

 ...

-export default function LoginPage() {
+function LoginPageContent() {
   const router = useRouter()
   const { status } = useSession()
   const searchParams = useSearchParams()
   ...
 }
+
+export default function LoginPage() {
+  return (
+    <Suspense fallback={null}>
+      <LoginPageContent />
+    </Suspense>
+  )
+}
```

Net: +1 import (`Suspense`), +1 rename (`LoginPage` →
`LoginPageContent` on the body), +1 new default export (the
Suspense-wrapping shell). Body is 100% identical; no behavior change.

## 5. Gate outcomes

| Gate                | Target             | Result                                                         |
| ------------------- | ------------------ | -------------------------------------------------------------- |
| A · api tsc         | 164                | **164** ✓                                                      |
| A · web tsc         | 0                  | **0** ✓                                                        |
| B · `npm run build` | PASS               | **PASSES** ✓ (exit 0)                                          |
| C · test parity     | 3/93/1002          | **3/93/1002** ✓ identical                                      |
| D · collateral      | only 1 file + docs | ✓ 1 file changed; no other apps/web src edits                  |
| E · runtime smoke   | —                  | **Deferred** — bundle with the arc's deferred Gate Cs (see §8) |

## 6. `npm run build` status

**PASSES.** Full successful build output (tail):

```
├ ƒ /workspace/[id]/canvas/[fileId]      2.74 kB         418 kB
├ ƒ /workspace/[id]/captures             7.66 kB         103 kB
├ ƒ /workspace/[id]/chat                 7.15 kB         111 kB
├ ƒ /workspace/[id]/config               6.94 kB         136 kB
├ ƒ /workspace/[id]/discover             3.83 kB        99.3 kB
├ ƒ /workspace/[id]/docs                 4.03 kB         150 kB
├ ƒ /workspace/[id]/editor/[fileId]     54.9 kB         393 kB
├ ƒ /workspace/[id]/files                9.37 kB         119 kB
├ ƒ /workspace/[id]/knowledge            6.29 kB         102 kB
├ ƒ /workspace/[id]/notebook/[fileId]   23.3 kB         123 kB
├ ƒ /workspace/[id]/settings             2.63 kB         110 kB
├ ƒ /workspace/[id]/space/[spaceId]     3.47 kB         358 kB
├ ƒ /workspace/[id]/threads             11.5 kB         111 kB
└ ƒ /workspace/[id]/timeline             150 B          87.4 kB
+ First Load JS shared by all           87.3 kB

ƒ Middleware                            38 kB

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

All 19 pages compile and export. No unexpected residuals. No other
`useSearchParams()` issues surfaced — `/auth/login` was the lone
instance.

## 7. Infrastructure arc closure

```
✓ LINT-BASELINE-1                 lint debt cleared
✓ PAGE-SHAPE-CLEANUP-1            3 Next 14 page-shape errors
✓ PDF-VIEWER-OBJECTSTYLE-FIX-1    1 ObjectStyle mismatch
✓ WEB-TSC-TRIAGE-1                60 errors inventoried
✓ WEB-TSC-SWEEP-TEST-ONLY-1       51 test errors (60 → 9)
✓ WEB-TSC-SWEEP-PROD-NULL-1       6 production errors (9 → 3)
✓ WEB-TSC-CUT-DEBT-COMBINED-1     3 CUT-DEBT errors (3 → 0)
✓ AUTH-LOGIN-SUSPENSE-1           1 Next prerender constraint   [THIS SPRINT]
──────────────────────────────────────────────────────────────────
   npm run build PASSES. Arc CLOSED.
```

**`npm run build` is now a real validation gate for every future
sprint.** Any commit that introduces a lint error, a tsc error, a
page-shape violation, an objectstyle mismatch, a strict-null failure,
a cut-debt regression, or a prerender-contract violation will fail
the build. That's eight full classes of regression that the pre-infra
baseline couldn't catch.

**Arc duration:** sprints labeled LINT-BASELINE-1 through this one,
all dated 2026-04-23. Roughly four working sessions of CC time
compressed through the per-file-commit discipline.

## 8. Deferred gate bundle

The following Gate Cs / Es from earlier sprints clear on the next
launcher restart. Bundle them into one sitting rather than chasing
them individually:

| Sprint                      | Deferred gate        | What to verify                                                                                                                                                                                                                                                    |
| --------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SERVER-VAULT-DASHBOARD-1    | Gate C               | `curl -i http://localhost:3001/api/admin/server-vault` — anonymous → 401; authed → 200 with 17-flag payload                                                                                                                                                       |
| LAUNCHER-LOG-BUFFER-1       | Gate C               | `ls -la logs/api.log` — file exists, recent mtime; `grep "\[Startup\]" logs/api.log` — 5 scheduler + 11 route gated-off lines                                                                                                                                     |
| WEB-TSC-CUT-DEBT-COMBINED-1 | Gate A-V             | `/` with notebooks-grid visible: grid populates from `/api/files`; `data-current` flag on open-notebook card; `+ New` works; pages column shows "0 pages" (documented behavior). `NotebookPicker` mount → list loads; `data-current` matches open notebook if any |
| AUTH-LOGIN-SUSPENSE-1       | Gate E (this sprint) | Load `/auth/login` directly → form renders instantly, no visible flash from `fallback={null}`. Load `/auth/login?error=CredentialsSignin` → error banner appears with correct copy. No hydration warnings in console                                              |
| arc-wide                    | Build-on-restart     | `cd apps/web && npm run build` from a clean checkout → exit 0, full route table prints                                                                                                                                                                            |

**One-shot verification script (for reference; do not run now):**

```bash
# 1. Launch stack
cd /c/Dev/Workspace\ App && ./start-and-open.cmd  # (or pnpm dev:full)

# 2. In a second shell:
cd /c/Dev/Workspace\ App/apps/web && rm -rf .next && npm run build
# expect: exit 0

# 3. Dashboard + logs
curl -i http://localhost:3001/api/admin/server-vault
ls -la /c/Dev/Workspace\ App/logs/api.log
grep "\[Startup\]" /c/Dev/Workspace\ App/logs/api.log | head -20

# 4. Browser checks
#   - /auth/login loads cleanly, no console errors
#   - /auth/login?error=CredentialsSignin shows the error banner
#   - NotebookPicker / NotebooksGrid render from /api/files (check network tab)
```

## 9. What's next

**Infrastructure plane: done.** Zero open blockers on
`apps/web`. `packages/api` baseline preserved at 164 (separate arc,
separate priority).

**Product plane: learning-layer surface.** Per the v5.1 handoff,
the primary remaining product gap is the user-facing learning-layer
— Memory tab, shared-state propagation across collaborators, the
spoken → written → indexed pipeline surfacing to the user.
Concretely, the surface that makes "Follow remembers" visible and
editable to the person using the app.

The pivot happens next conversation. Infrastructure work should
pause entirely unless a new blocker surfaces from product work.

**Lingering hygiene (not blocking, not scheduled):**

- `LINT-ANY-TYPES-1` — ~47 remaining `no-explicit-any` warnings in
  apps/web (eslint warn, not error; doesn't fail build). Low
  priority; drain as fix sprints naturally re-touch those files.
- `packages/api` tsc 164 errors — pre-existing baseline, not in
  this arc's scope. Separate sprint planning needed if they start
  to cause drift.

---

## Commit chain

2 commits on main:

1. `3577934` — fix: wrap `useSearchParams` call in `<Suspense>`
2. (this commit) — report + CLAUDE.md

---

**Sprint complete. Infrastructure arc closed. Build passes.**
