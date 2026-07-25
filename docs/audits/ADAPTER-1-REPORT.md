# ADAPTER-1 — FollowAPI port + QuerySpec + contract test (2026-06-02)

Part of `master-run/2026-06-02`. **Contract-only** — a window-agnostic backend contract. No behavior change (additive); the query modes are not implemented.

## Phase 1 — port (`packages/shared/src/schemas/follow-api.schema.ts`)

- **`FollowAPI`** interface — 9 operations mirroring the MCP tools: `query(QuerySpec)`, `contribute`, `getActivity`, `detectContradictions`, `setScope`, `readFile`, `directoryQuery`, `sendMessage`, `saveConversation`.
- Per-operation **Zod request/response** schemas (+ inferred types), and a `FOLLOW_API_OPERATIONS` registry mapping each op → `{ tool, request, response }` (single source of truth for the adapter and the contract test).
- **`QuerySpec`** Zod discriminated union: `point | regional | directional | trajectory | contrastive` — **schema only**, modes not implemented.

## Phase 2 — conform (`apps/web/src/lib/follow-api.ts`)

- `export const followApi: FollowAPI` — the typed web adapter. Each method validates its request against the shared schema, POSTs to the mcp-rest bridge (`/api/mcp-rest/<tool>`), and parses the response against the shared schema (lenient fallback). The `: FollowAPI` annotation makes the compiler enforce conformance. Typed structurally (no `zod` dependency added to the web package). Purely additive — no existing call site changed.

## Phase 3 — contract test (`packages/api/.../follow-api-contract.test.ts`)

A drift guard: for each of the 9 operations it asserts the shared request schema's **required-field set equals the backend MCP tool's JSON-Schema `required` array** (caught a real mismatch during authoring — `save_conversation` requires `messages` + `source_type`, not `type`). Plus canonical round-trips (valid passes / missing-required rejected) and the five QuerySpec modes. **11 tests, all pass.**

## Gates

- shared TS **0**; web TS **0**; api TS **164 → 164**.
- api tests **875 → 886 passing** (+11), 16 failing unchanged, **14 failing files unchanged** (the contract file is in the passing set). web tests unaffected (adapter is unimported).

Per-file commits prefixed `ADAPTER-1:`.
