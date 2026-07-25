---
sprint: WEB-TSC-CUT-DEBT-COMBINED-1
date: 2026-04-23
author: Claude (Opus 4.7)
status: Complete — apps/web tsc 3 → 0; build type-check fully passes; static-export residual on /auth/login documented in §7
---

# WEB-TSC-CUT-DEBT-COMBINED-1 — Notebook-list API rewrite + `'prov'` → `'memory'` rename

## 1. Purpose + scope recap

Closed the final 3 CUT-DEBT tsc errors in two sequential parts:

- **Part A — Notebook-list API rewrite (2 errors, behavior-changing):**
  `notebook-picker.tsx` and `notebooks-grid.tsx` read a plural
  `notebooks` map from `useNotebookStore()` which no longer exists
  after the store's strip-arc refactor (now singular
  `notebook: Notebook | null`). Rewrote both to fetch the list via
  the files API + client-side filter — same pattern the dashboard
  views use.
- **Part B — `'prov'` → `'memory'` rename (1 error, behavior-preserving):**
  Residual rename debt in `unit-chat-panel.tsx:107`'s `MODE_BUTTONS`
  array; the `UnitActiveMode` union had already dropped `'prov'` in
  favor of `'memory'` but this one literal site lagged.

**Outcome:** apps/web tsc 3 → 1 (midpoint) → **0**. Build type-check
fully passes (static pages compile 19/19). Static-export fails on a
pre-existing `/auth/login` suspense-boundary issue unrelated to this
sprint — classified as Complete-with-residual-build-blocker per
spec.

## 2. Part A baseline + endpoint discovery

**Pre-sprint SHA:** `b176058` (tip of WEB-TSC-SWEEP-PROD-NULL-1).

| Baseline           | Target | Observed  |
| ------------------ | ------ | --------- |
| `packages/api` tsc | 164    | **164** ✓ |
| `apps/web` tsc     | 3      | **3** ✓   |

**The 3 tsc errors verbatim (pre-sprint):**

```
src/components/follow/notebook-picker.tsx(12,11): error TS2339: Property 'notebooks' does not exist on type 'NotebookState'.
src/components/follow/notebooks-grid.tsx(7,11):   error TS2339: Property 'notebooks' does not exist on type 'NotebookState'.
src/components/follow/unit-chat-panel.tsx(107,5): error TS2322: Type '"prov"' is not assignable to type 'UnitActiveMode'.
```

**API endpoint discovery:**

- **No dedicated `GET /api/notebooks` list route exists.** Enumerated
  all `notebooksRouter.*` registrations in `packages/api/src/routes/notebooks.ts`:
  `POST /` (create), `GET /:id`, `GET /by-file/:fileId`, `PATCH /:id`,
  `DELETE /:id`, and page/block sub-routes. No bulk list.
- **Notebook-listing is done via the files API.** Four neighboring
  components (`dash-grid-view`, `dash-list-view`, `doc-list`,
  `items-view`) all use the pattern
  `useQuery` + `api.get<FileItem[]>('/api/files?workspaceId=...')`
  and then filter client-side by
  `editorType === 'notebook' || mimeType === 'application/vnd.workspace.notebook'`.
- **Client helper:** `api.get<T>(path)` from `@/lib/api-client`
  wraps `fetch` with the `x-user-id` / `x-workspace-id` auth
  headers. No notebook-specific helper exists.

**Path classification: PATH-2 variant.** The endpoint exists (files
list) and the client wrapper exists (`api.get`), but notebook-
specific retrieval happens via client-side filter. Followed the
neighbor pattern exactly — no new helper file created (scope creep
avoided per spec).

**Test constraint surfaced during Phase A-1:** both `notebook-picker.test.tsx`
and `notebooks-grid.test.tsx` are **source-grep tests** that assert
specific string tokens exist in the source (e.g.,
`expect(source).toContain('useNotebookStore')`,
`'notebookList.map'`, `'nb.title'`, `'pages'`). Rewrite had to
preserve those tokens literally — constrained the design but was
easy to honor.

## 3. Part A rewrites

**`notebook-picker.tsx` (commit `9644d2d`):**

| Before                                     | After                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `const { notebooks } = useNotebookStore()` | `useQuery` + `api.get<FileItem[]>` + `.filter(isNotebookFile)`                                                              |
| `Object.entries(notebooks).map(...)`       | `(filesData?.data ?? []).filter(isNotebookFile).map(...)`                                                                   |
| Instant render from store                  | Silent loading (empty list until fetch resolves)                                                                            |
| No active-notebook awareness               | `activeNotebookId = useNotebookStore(s => s.notebook?.id ?? null)` selector — drives `data-current` flag on matching button |

**Preserved:** public API (props shape: `onSelect`, `onCreateNew`,
`onClose`), default export, all data-testids, variable names
(`notebookList`, `.map`), `useNotebookStore` import + call (required
by source-grep test).

**Loading state:** silent (filesData?.data falls back to []) — matches
original which also rendered silently while store was empty.
**Empty state:** only the `+ New Notebook` button visible — matches original.
**Error state:** silent (api.get's ApiResponse has `data: null` on error;
`?? []` handles it) — matches neighbors which silently fall through on
network errors.

**`notebooks-grid.tsx` (commit `3e73194`):**

Same rewrite pattern plus a `formatLastEdit(updatedAt?: string)` helper
turning `file.updatedAt` into the existing strings (`"Just now"`,
`"5m ago"`, `"2d ago"`, `"Recently"`).

| Before                                      | After                                                        |
| ------------------------------------------- | ------------------------------------------------------------ |
| `notebooks` read from store                 | `useQuery` + files API + filter                              |
| `pages: ((nb as {...}).pages ?? []).length` | `pages: 0` (literal; see behavior note below)                |
| `lastEdit: 'Recently'` (hardcoded)          | `lastEdit: formatLastEdit(f.updatedAt)` (real relative time) |

**Behavior note on `pages` display:** the pre-rewrite code read
`nb.pages?.length` from the store's notebook object. Since the store
only eagerly loads `pages[]` once a user opens a specific notebook,
any notebook _not currently open_ rendered with `pages: 0`. My
rewrite fetches file metadata (which doesn't include page counts)
and shows `0 pages` as a literal default — matching the pre-rewrite
empirical behavior for most notebooks in the list. A proper page
count would require per-notebook fetch (N+1) or a new bulk server
endpoint — out of scope.

**Preserved:** public API (zero props), default render shape, all
data-testids, `useNotebookStore` import + call, `notebookList`
variable name, `'pages'` string token, `nb.title` reference
(source-grep tests).

## 4. Part A midpoint gates

| Gate                                                    | Result                |
| ------------------------------------------------------- | --------------------- |
| A-I · api 164 / web 1                                   | ✓ **164 / 1 exact**   |
| A-II · remaining error is unit-chat-panel.tsx:107       | ✓ exact               |
| A-III · build fails at unit-chat-panel:107 specifically | ✓                     |
| A-IV · test parity (both affected test files 6/6 pass)  | ✓                     |
| A-V · runtime smoke                                     | **Deferred** — see §8 |

## 5. Part B baseline + rename

**Pre-Part-B state:**

```
src/components/follow/unit-chat-panel.tsx(107,5): error TS2322:
  Type '"prov"' is not assignable to type 'UnitActiveMode'.
```

Canonical union: `UnitActiveMode = 'none' | 'web' | 'doc' | 'memory' | 'notes'`.
The `MODE_BUTTONS` array had `{ mode: 'prov', ... }` — rename debt
from the Prov → Memory sweep documented as complete.

**Other `'prov'` occurrences in follow/ (out of scope, verified different type):**

| File                           | Context                                                            | Type                                     | Status                                      |
| ------------------------------ | ------------------------------------------------------------------ | ---------------------------------------- | ------------------------------------------- |
| `right-panel.tsx` (×5)         | `RightPanelTab` union                                              | Different concept (provenance panel tab) | Out of scope — intact                       |
| `floating-unit.tsx:110`        | `setRightPanelTab('prov')`                                         | Same RightPanelTab                       | Out of scope — intact                       |
| `paragraph-provenance.tsx:128` | `setRightPanelTab('prov')`                                         | Same RightPanelTab                       | Out of scope — intact                       |
| `unit-chat-panel.test.tsx:33`  | `expect(source).not.toContain("'prov'")` reading `context-bar.tsx` | Different file                           | No impact; `context-bar.tsx` has 0 `'prov'` |

No cross-file rename needed. The `UnitActiveMode` rename is truly
localized to the one line.

**Rename (commit `c6abcf9`):**

```diff
- { mode: 'prov', icon: '\uD83D\uDCCA', label: 'Prov' },
+ { mode: 'memory', icon: '\uD83D\uDCCA', label: 'Memory' },
```

Both `mode` and `label` updated (label preserves internal
consistency per spec; icon is the same bar-chart glyph). No
duplicate with pre-existing mode — `MODE_BUTTONS` previously had
`web`, `doc`, `prov`, `notes`; now has `web`, `doc`, `memory`,
`notes`.

## 6. Part B final gates

| Gate                          | Result                                        |
| ----------------------------- | --------------------------------------------- |
| B-I · api 164 / web 0         | ✓ **164 / 0**                                 |
| B-II · `npm run build` PASS   | **PARTIAL** — type-check fully passes; see §7 |
| B-III · test parity 3/93/1002 | ✓ identical                                   |
| B-IV · collateral bounded     | ✓ only 3 source files + docs                  |

## 7. `npm run build` outcome

**Type-check phase: CLEARED.** Every prior stage the build had been
failing at since LINT-BASELINE-1 is now green:

- ESLint — passes (47 remaining warnings, 0 errors; same pool queued for LINT-ANY-TYPES-1)
- `.next/types/` page-shape — passes
- Source tsc — passes (0 errors across apps/web)
- `.next/static` page-type verification — passes
- **Static page collection — passes (19/19 pages compile)**

**Residual blocker (new, pre-existing, runtime class not type class):**

```
✓ Generating static pages (19/19)

⨯ useSearchParams() should be wrapped in a suspense boundary at page "/auth/login".
  Read more: https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout

Error occurred prerendering page "/auth/login". Read more:
https://nextjs.org/docs/messages/prerender-error

> Export encountered errors on following paths:
	/auth/login/page: /auth/login
```

This is a Next 14 static-prerender constraint — pages using
`useSearchParams()` must wrap that call in `<Suspense>`, or opt the
page out of static prerendering via
`export const dynamic = 'force-dynamic'`. It's pre-existing debt
that was hiding behind the tsc failures; it fires only now that the
build reaches the static-export phase.

**Per the spec's Gate B-II "pre-existing error now surfaces" clause:**

> If it fails on a pre-existing error that neither part touched but
> which now surfaces, classify as `Complete-with-residual-build-blocker`
> and queue as followup — do NOT expand scope.

**Done.** Queued as `AUTH-LOGIN-SUSPENSE-1` — a ~5-minute one-line
fix (either wrap the `useSearchParams()`-containing body in
`<Suspense>` or add `export const dynamic = 'force-dynamic'`).

## 8. Deferred runtime checks

**Gate A-V — runtime smoke for the two rewritten components** (for
next launcher restart):

For **`NotebookPicker`** (typically mounted from follow toolbars or
context menus — verify by navigating to a view that exposes it):

- On mount: expect a brief empty render (no spinner in the
  implementation), then the list of notebooks populates as the
  files API query resolves (~100–300ms typical)
- If no notebooks exist: expect only the `+ New Notebook` button
- If the currently-open notebook matches one in the list:
  the matching button carries `data-current="true"` (DOM
  inspection; no visual style applied yet)
- If the API returns 401 / 500: expect silent empty list + a
  console error (api.get's default behavior)
- Network tab: one `GET /api/files?workspaceId=<uuid>` per mount
  with x-user-id / x-workspace-id headers

For **`NotebooksGrid`** (mounted from `follow-main.tsx` when
`sidebarView === 'notebooks'`):

- Same fetch pattern; brief empty state, then grid populates
- Each card shows `{name} / 0 pages · {relativeTime}` — the
  relativeTime is now computed from `file.updatedAt` (previously
  always showed "Recently")
- Active notebook card gets `data-current="true"` (same caveat
  as picker)
- Clicking a card navigates to `/workspace/:id/notebook/:fileId`
  (unchanged from pre-rewrite)
- Same 401/500 behavior as picker

**What to verify explicitly:**

1. Create a new notebook (via the `+` button flow, if wired) —
   confirm it appears in the grid after creation.
2. Open an existing notebook, return to the grid — confirm the
   `data-current` flag lights up on the correct card.
3. With the browser offline: confirm grid renders empty but
   doesn't crash the page.

## 9. Build-gate arc status

```
Build-gate arc progress:
  LINT-BASELINE-1                  ✓ lint debt cleared
  PAGE-SHAPE-CLEANUP-1             ✓ 3 Next 14 page-shape errors
  PDF-VIEWER-OBJECTSTYLE-FIX-1     ✓ 1 ObjectStyle mismatch
  WEB-TSC-TRIAGE-1                 ✓ 60 errors inventoried
  WEB-TSC-SWEEP-TEST-ONLY-1        ✓ 51 test errors (60 → 9)
  WEB-TSC-SWEEP-PROD-NULL-1        ✓ 6 production errors (9 → 3)
  WEB-TSC-CUT-DEBT-COMBINED-1      ✓ 3 CUT-DEBT errors (3 → 0)  [THIS SPRINT]
  —— TypeScript arc closed ——
  AUTH-LOGIN-SUSPENSE-1            ⏭ 1 Next static-prerender runtime constraint (~5 min)
  —— npm run build passes ——
```

**The TypeScript arc is closed.** Zero tsc errors remain in
`apps/web`. Every future sprint that touches apps/web now has a
meaningful tsc baseline (0) it must preserve.

`npm run build` is **one ~5-minute sprint away** from passing
cleanly — the remaining blocker is a runtime-class Next constraint,
not a type issue. Once `AUTH-LOGIN-SUSPENSE-1` lands, the full
infrastructure arc is closed and the build command becomes a real
validation gate for every future sprint.

## 10. What's next

**Infrastructure debt:** effectively zero in the TypeScript plane.
The LINT-ANY-TYPES-1 pool (~47 `no-explicit-any` warnings) and
AUTH-LOGIN-SUSPENSE-1 are the remaining hygiene items — neither
blocks product work.

**Product direction:** per the v5.1 handoff framing, the learning-
layer surface (Memory tab, shared state propagation, spoken →
written → indexed flow) is the primary product gap now that the
infrastructure arc is closing. That's the next pivot: out of infra,
into user-visible work.

---

## Commit chain

5 commits on main:

1. `9644d2d` — phase-A-2: notebook-picker.tsx API rewrite
2. `3e73194` — phase-A-3: notebooks-grid.tsx API rewrite
3. `c6abcf9` — phase-B-2: `'prov'` → `'memory'` rename
4. (this commit) — phase-R: report + CLAUDE.md

---

**Sprint complete.** TypeScript infrastructure arc closed.
`npm run build`'s last obstacle is a runtime-class Next constraint
queued as `AUTH-LOGIN-SUSPENSE-1`.
