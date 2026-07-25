> **⚠ Predates CLEANUP-1 (2026-07-24).** The parked-surface strip removed every vault-gated feature (capture, canvas, rich-text/spreadsheet/presentation editors, notebooks, threads, timeline, comments, doc-intelligence, browser-nav, the off schedulers) and the dev-mode workspace chrome. Sections referencing those no longer apply — the code wins. A fresh architecture doc is planned.

# Coding Conventions

## File Naming

- React components: PascalCase (e.g., `CommandPalette.tsx`)
- Utilities/hooks: camelCase (e.g., `useTimeline.ts`, `formatDate.ts`)
- Types: PascalCase with `.types.ts` suffix for standalone type files
- API routes: kebab-case directories (e.g., `routes/workspace-members/`)
- Database: snake_case for all table and column names

## Component Patterns

- All components use TypeScript interfaces for props (named `ComponentNameProps`)
- Export components as named exports, not default exports
- Co-locate component, styles, and tests in the same directory
- Use `cn()` utility (clsx + tailwind-merge) for conditional class names
- **`components/follow/` is organized into responsibility subfolders** (CLEAN-4, 2026-06-02): `chat/`, `comments/`, `modals/`, `notifications/`, `memory/`, `shell/`, `common/`, plus `items/`, `provenance/`, `sharing/`, `scope/`, `query/`, `discover/`, `live-context/`, `procedural/`, `editor-panels/`, `canvas-panels/`, `dashboard/`. No loose files at the top level — put new follow components in the matching subfolder and import them with `@/components/follow/<subfolder>/<name>`.

## API Patterns

- All routes validate input with Zod schemas
- All routes pass through the timeline middleware (event logging)
- Return consistent response shape: `{ data, error, meta }`
- Use proper HTTP status codes

## Web → API wiring (CLEAN-2, 2026-06-02)

- **All web data calls go through `apps/web/src/lib/api-client.ts`.** Never `fetch` the API with a raw `${process.env.NEXT_PUBLIC_API_URL}` URL — `NEXT_PUBLIC_API_URL` is read in exactly one place (`api-client.ts`).
- Use **`authFetch(path, opts)`** for fetches (raw `Response`; injects `x-user-id`/`x-workspace-id` + `credentials:'include'` + base URL) or the typed **`api.get/post/patch/delete/upload`**.
- For non-fetch consumers that need the origin string (EventTracker, `window.open` exports, bookmarklets, `navigator.sendBeacon`), import **`API_BASE`** from `api-client`.
- Exceptions (NOT the API): the **launcher** (`:4000` / `NEXT_PUBLIC_LAUNCHER_URL`) and `lib/auth.ts`.

## State Management

- Server state: React Query (TanStack Query)
- Client state: Zustand stores in `stores/` directories
- Real-time state: Yjs documents synced via WebSocket

## Testing

- Unit tests with Vitest
- Component tests with React Testing Library
- API tests with supertest
- Test files live next to the code they test: `Component.test.tsx`

## Git

- Conventional commits: feat:, fix:, chore:, docs:, refactor:
- One logical change per commit
- Branch naming: feature/description, fix/description

## Feature Vault

- Gate any component behind the vault by checking `isFeatureActive('feature-id')`
- Import from `@/config/feature-vault`
- Check before render; if the feature is inactive, show a placeholder instead
- Example:

  ```tsx
  import { isFeatureActive } from '@/config/feature-vault'

  if (!isFeatureActive('canvas-editor')) {
    return <FeatureInactivePlaceholder />
  }
  ```

## MCP Tool Authoring

- Each tool module exports `{ name, description, inputSchema, handler }` matching the `MCPToolDefinition` interface from `mcp/types.ts`
- Tools live in `packages/api/src/mcp/tools/` as individual files (one tool per file)
- `inputSchema` is a Zod schema; the MCP transport serializes it to JSON Schema for the protocol handshake

## MCP Test Patterns

- Unit tests mock the tool registry via `vi.mock('../tools/index')` and assert handler input/output
- Transport tests mock the auth middleware to inject a synthetic user/session
- Session expiry tests use `vi.useFakeTimers()` to advance past the 30-min window

## MCP Session State

- Sessions are per-user `Map` entries with a 30-minute inactivity expiry
- Tool handlers receive a mutable `MCPSession` object to read/update scope (active workspace, file focus, etc.)
- Expired sessions are lazily reaped on the next heartbeat or tool invocation

## Raw File Storage

- Content-addressed: files identified by SHA-256 hash of content
- Hash-chained: each record stores `previousHash` linking to the prior version
- S3-backed: file content stored via `storageKey` in S3-compatible storage
- Text extraction: plain text extracted on upload and stored alongside metadata
- Schema: `raw_files` table in `db/schema/raw-files.ts`

## MCP Sharing Tool Patterns

- All sharing tools (contribute, send_message, send_conversation, get_activity, detect_contradictions) require project scope to be set before invocation
- Recipient resolution: resolve recipients by display name via `workspaceMembers` + `users` join (not by user ID)
- Sharing tools reuse existing services (sharing/privacy-filter, sharing/slice-builder, sharing/context-request) rather than introducing new sharing logic

## Chat Source Type

- When creating new chat integrations, pass `chatSourceType` in the POST body to `/api/chat/conversations`
- Valid values: `'follow-web'`, `'follow-notebook'`, `'claude'`, `'chatgpt'`, `'cursor'`, `'custom'`
- Default is `'follow-web'` if omitted

## Startup (LAUNCH-1 → DC-2)

### Standard Launch Command

Start the entire stack with a single command:

```bash
npx tsx scripts/launch.ts
```

Or double-click the **"Workspace App (Open)"** desktop shortcut, which calls `start-and-open.cmd` → `npx tsx scripts/launch.ts`.

Do **not** start services in individual terminals. The launcher handles dependency ordering, health checks, and error reporting.

### What the launcher starts (in order)

1. **Docker** — Postgres, Redis, ClickHouse, MinIO containers via `docker compose up -d`
2. **Postgres/Redis** — waits for healthy (connection probe loop)
3. **API Server** — Hono on `:3001` (health poll until `/health` returns 200)
4. **Next.js Web App** — on `:3009` (health poll up to 60s for first compile)
5. **ngrok** — tunnel to expose API externally (skipped if ngrok not installed)
6. **Desktop Agent** — file watcher (skipped if config not found)
7. **Dashboard** — 7-tab dev console on `:4000` with WebSocket live streaming
8. **Browser** — auto-opens both `:4000` (dashboard) and `:3009` (web app)

### Desktop Shortcut Target

The shortcut "Workspace App (Open).lnk" on the desktop points to:

```
C:\Dev\Workspace App\start-and-open.cmd
```

Which delegates to `npx tsx scripts/launch.ts`. Alternative batch file: `scripts/follow-launch.bat`.

### Service Registration

All new services must register with the health endpoint (`/api/health`). The health response is consumed by the monitoring dashboard on `:4000`. If a service does not appear in the health response, the dashboard cannot track it.

### Traffic Logging

All API requests (except `/health` and `/api/status`) are logged by the `traffic-logger` middleware and streamed to the dashboard via WebSocket at `ws://localhost:4000/ws`.

## Deployment (DEPLOY-1)

### Tunnel Startup Sequence

Start services in this order — each depends on the previous:

1. **Docker** — database and S3 containers must be running
2. **API** — `npm run dev` (or production build) — must be healthy before tunnel
3. **ngrok** — `ngrok http <API_PORT>` — exposes API to public internet
4. **Agent connections** — Claude Desktop (SSE) and ChatGPT (REST) connect via the ngrok URL

### `MCP_PUBLIC_URL` Environment Variable

- Must match the current ngrok tunnel URL (e.g., `https://abc123.ngrok-free.app`)
- Used by the REST wrapper and OpenAPI spec to generate correct endpoint URLs
- Must be updated every time the ngrok URL changes (free tier rotates on restart)
- Set in `.env` or export before starting the API if the tunnel is already running

## Desktop Agent

### Config File

- Config file: `follow-agent.config.json` in the watched directory root (or user home)
- Fields: `watchPaths` (string[]), `preset` (string), `apiUrl` (string), `apiKey` (string), `excludes` (string[])

### Preset Behavior

| Preset     | Behavior                                                                              |
| ---------- | ------------------------------------------------------------------------------------- |
| `open`     | Auto-sync all detected files immediately (no user approval required)                  |
| `balanced` | Log detected files, require manual approval before upload (not yet wired — logs only) |
| `private`  | Log only — never upload, local audit trail (no interactive approval UI yet)           |

### DEFAULT_EXCLUDES List

The agent skips these patterns by default (in addition to user-configured excludes):

- `node_modules/**`, `.git/**`, `dist/**`, `build/**`, `.next/**`
- `*.lock`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- `.env*`, `*.pem`, `*.key`, `*.cert`
- `__pycache__/**`, `.venv/**`, `venv/**`
- `.DS_Store`, `Thumbs.db`, `desktop.ini`

### Hash Dedup Pattern

- Always call `GET /api/raw-files/check-hash` with the SHA-256 of the file content before uploading
- If the API returns a match, skip the upload (file already exists server-side)
- Uses the same SHA-256 algorithm as `packages/api/src/lib/content-hash.ts`

## FollowAPI (ADAPTER-1, 2026-06-02)

Backend operations that mirror the MCP tools have a single typed contract: **`FollowAPI`** + per-op Zod schemas + `QuerySpec` in `@workspace/shared/schemas`. The web adapter is `apps/web/src/lib/follow-api.ts` (`followApi: FollowAPI`). When changing an MCP tool's required params, update the matching shared schema — the contract test (`follow-api-contract.test.ts`) fails on drift.
