# CLEAN-1 — dead-code removal (2026-06-02)

Part of `master-run/2026-06-02`. Removes web components imported nowhere outside tests.

## Method

Single `rg` pass over `apps/web/src` (`.ts`/`.tsx`, excl. `__tests__`) extracting every quoted module-path basename token, attributed to its referencing file; a component is an orphan iff its basename is referenced by no file other than itself. Static, Next-`dynamic`, and `await import()` all emit the same token, so dynamic imports are covered. Every candidate was re-verified with an independent per-file importer search, plus an extension-aware re-scan (`name.tsx`) to catch `readFileSync` source-inspection tests.

## Result

- 271 component `.tsx` scanned → **24 confirmed orphans**.
- **Removed: 23 components + 8 dead colocated tests** (snapshots in `_archive/2026-06-02-clean-1/`).
- **Deferred (1): `follow/context-bar.tsx`** — only referenced by `__tests__/unit-chat-panel.test.tsx` (a non-orphan's test that `readFileSync`s its source). Removing it needs a surgical edit to another component's test → out of CLEAN-1's mechanical-safe scope.
- **Not touched:** duplicate basenames `context-menu`, `toolbar` (each has live importers; ambiguous).
- **Fork pre-resolved:** `follow/doc-top-bar.tsx` (0 importers) deleted ⇒ Sprint-3 `doc-top-bar` fork collapses to `doc-top-bar-v2` only.

## Gates (verified)

| Gate              | Baseline     | After             | Verdict                                                            |
| ----------------- | ------------ | ----------------- | ------------------------------------------------------------------ |
| web TS errors     | 0            | 0                 | ✅                                                                 |
| total TS errors   | 198          | 198               | ✅                                                                 |
| web tests passing | 992          | 956               | ✅ (−36 = the tests in the 8 removed dead-test files; intentional) |
| web tests failing | 13 (6 files) | 13 (same 6 files) | ✅ no regression                                                   |

The −36 passing tests are entirely the colocated tests of removed orphans; the failing-test count and the set of failing files are unchanged, so nothing regressed.

Per-file deletion commits prefixed `CLEAN-1:`; archive snapshot committed first. Full derivation: `_reports/clean-1-orphans.md`.
