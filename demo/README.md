# The portfolio Follow demo (sandbox source)

This folder is the source of the interactive Follow demo at
[rishabhsalian.design/work/follow](https://rishabhsalian.design/work/follow) — a
faithful sandbox replica of the Follow dashboard, built so visitors can explore
the product (views, transcripts, the fact graph, the MCP console, the guided
tour) without a live backend.

- `app/work/follow/` — the demo page and its components (sandbox shell, system
  diagram, dashboard views, MCP console, guided tour, ask dock).
- `lib/follow*.ts`, `lib/followChats/` — the demo's data layer: seeded
  transcripts, the fact/graph data, MCP wire samples, product copy.

These files are copied verbatim from the portfolio codebase (a separate
Next.js app), so they are **reference source, not a standalone app** — they
import portfolio-level styles and utilities that are not part of this
repository. The real system the demo replicates is the rest of this repo:
the pipeline in `packages/api/src/services/`, the dashboard in
`apps/web/src/components/follow/`, and the MCP server in
`packages/api/src/mcp/`.
