# CLEAN-3 — fork resolution (2026-06-02)

Part of `master-run/2026-06-02`. One canonical version of each forked component. Full measurements: `_reports/clean-3-forks.md`.

## Outcome (no HALTs)

| Fork                              | Live state                                                             | Action                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `doc-top-bar` vs `doc-top-bar-v2` | `doc-top-bar.tsx` already deleted in CLEAN-1; `-v2` sole (2 importers) | none — already resolved                                                                                                        |
| AddToIndex **panel vs modal**     | panel `add-to-index.tsx` does **not exist**; only `AddToIndexModal`    | **no HALT** — no live fork to decide (decision-B HALT was conditional on the fork existing); stale KNOWN_ISSUES note corrected |
| `workspace-sidebar-new`           | sole sidebar, no un-suffixed sibling                                   | **de-suffixed** → `workspace-sidebar` (file + `WorkspaceSidebar` symbol + 2 importers)                                         |

Decision B (HALT on AddToIndex panel-vs-modal / ties) did not trigger because the panel surface was already removed before this run — the only honest outcome is "no fork," not a human-decision HALT over a non-existent file.

## Gates

web TS 0 → 0 · web tests 956✓/13✗ unchanged · eslint clean. Commits prefixed `CLEAN-3:` (archive snapshot + de-suffix).
