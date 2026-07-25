> **⚠ Predates CLEANUP-1 (2026-07-24).** The parked-surface strip removed every vault-gated feature (capture, canvas, rich-text/spreadsheet/presentation editors, notebooks, threads, timeline, comments, doc-intelligence, browser-nav, the off schedulers) and the dev-mode workspace chrome. Sections referencing those no longer apply — the code wins. A fresh architecture doc is planned.

# AI System

How the AI layer works end-to-end: indexing pipeline, reference agent, chat completion, MCP, sharing, and the model tier strategy. State as of **2026-05-13**.

For surrounding architecture see `docs/ARCHITECTURE.md`. For the UI side of these features see `docs/UI_INVENTORY.md`.

---

## 1. Mental model

There are two cognitive loops:

1. **The indexing pipeline** — passive. Watches user activity (extension signals, GWS snapshots, file changes, chat messages) and distills it into facts (`index_records`) and memory layers (`aiState`).
2. **The chat / agent loop** — active. When the user (or an external agent over MCP) asks something, the reference agent classifies the question, picks data sources, retrieves from the pipeline's outputs, and assembles a context block the chat completion reads.

The pipeline is the writer; the reference agent is the reader; the chat agent is the consumer.

---

## 2. The 5-role indexing pipeline (`services/pipeline/`)

**Source of truth:** v5.2 product doc §06 ("life of a fact"). Verified against code 2026-04-29.

Files: `reporter.ts`, `analyst.ts`, `editor.ts`, `archivist.ts`, `profiler.ts`, `runner.ts`, `prompts.ts`, `gc.ts`, `tombstone.ts`, `llm-call.ts`.

| Role      | When it runs                           | What it does                                                                                           | Model handle (default)       |
| --------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------- |
| REPORTER  | Every event                            | Logs the raw event into the pipeline. High-volume, low-thought; free-tier model.                       | `google/gemma-4-31b-it:free` |
| ANALYST   | The wedge — edge classification        | Strongest reasoner. Decides whether an event opens a new edge in the graph or extends an existing one. | `deepseek/deepseek-v4-pro`   |
| EDITOR    | Per scoring decision                   | Calibrated 0-1 scoring with low temp. Cheap fast model for confidence numbers.                         | `qwen/qwen3.5-flash-02-23`   |
| ARCHIVIST | Every 5 min + session start/end        | Compresses recent episodes into the long-term store. Cheap reasoning.                                  | `deepseek/deepseek-v4-flash` |
| PROFILER  | Session start/end + daily 14-day slice | Builds user-pattern profiles. Larger context window.                                                   | `qwen/qwen3.5-122b-a10b`     |

The five roles share a single LLM-call helper (`llm-call.ts`) that consults the runtime override map (`data/model-overrides.json`) before falling back to defaults — so the dev dashboard can swap any role's model without code changes.

Companion services (also under `services/semantic-index/`):

- **`indexer.ts`** — writes new `index_records`; fires post-hooks (`batchCaptureInitialStates`, `triggerSyncForNewRecords`).
- **`chat-fact-extractor.ts`** (CHAT-INDEX-1) — when a `raw_files` row is `source_type='chat_artifact'`, this hook fires at the end of `handleFullIndex`, creates an `ai` thread keyed on `metadata.conversationId`, adds one `thread_event` per enriched chunk, then calls `indexDistilledEvents()`. Chat artifacts produce facts without going through the realtime capture pipeline.
- **`hash-chain.ts`** — content-addressed evidence; each record stores `previousHash` for version history.
- **`compose-embedding-text.ts`** — builds the text we actually embed. Fixed in CHAT-INDEX-1 to include `event.label` + `meta.chunkContent` (previously dropped substantive text).
- **`engagement-updater.ts`**, **`weighted-referencing.ts`** — recency / engagement weights for retrieval.
- **`evidence-capture.ts`**, **`sealed-snapshot.ts`** — point-in-time evidence capture.
- **`permission-filter.ts`** — visibility filter at query time.

---

## 3. Reference agent (`services/reference-agent/`)

Sits between user query and chat completion. 4 stages, fail-open. Files: `classifier.ts`, `planner.ts`, `retriever.ts`, `assembler.ts`, `boundary-hook.ts`, `index.ts`.

```
Stage 0 — preClassify (0 LLM calls, <1ms)
  Regex pre-filter. Bypasses the agent entirely for trivial edits / greetings.

Stage 1 — classifyQuery (~300-500ms)
  Free-tier classifier model. Picks one of 7 intents:
  simple · temporal · cross_version · provenance · cross_doc · memory · synthesis

Stage 2 — planRetrieval (pure function, <1ms)
  Hand-coded per-intent plans. Output: a list of data-source lanes to query.
  Vocabulary of 11 sources (index_records, threads, raw_files, memory_layers,
  recent_messages, sharing_slices, …).

Stage 3 — executeRetrievalPlan (parallel)
  Promise.allSettled across lanes. Each lane try/catches independently —
  one failed lane never blocks the rest.

Stage 4 — assembleContext (pure function)
  Dedupe, group by source, emit one [REFERENCE AGENT CONTEXT] block.
```

The agent is **fail-open**: if classification or retrieval errors out, the chat completion still runs without an injected context block. The downside is silent quality loss; logs in `logs/api.log` flag every miss.

---

## 4. MCP server (`packages/api/src/mcp/`)

Two transports:

- **WebSocket** at `/mcp` — JSON-RPC 2.0. Used by Claude Desktop (SSE wrapper) and live agents.
- **REST bridge** at `/api/mcp-rest` — wraps each tool as a POST endpoint. OpenAPI spec exposed at `/api/mcp-rest/openapi.json`. Used by ChatGPT custom-actions.

`MCP_PUBLIC_URL` must match the current ngrok tunnel — the OpenAPI spec embeds it for endpoint URLs. The launcher rewrites this automatically; if you start the API standalone, set it manually before agents connect.

### Tools (12)

```
query_index            Search the workspace index. Vector + fuzzy.
read_file              Read a file. Routes by ID prefix:
                       rawFiles → gws_snapshots → workspace files → chat_conversations.
                       For chat: surfaces full reasoning trail (Thinking / Plan /
                       Tool calls / Sources / Model · tokens · latency) per
                       assistant message.
save_conversation      Persist a chat conversation. Accepts optional
                       conversation_id to force update-in-place; syncs the
                       chat_artifact wrapper raw_file on every save; accepts
                       alias field names (chain_of_thought, tool_invocations,
                       citations, model_id, input_tokens, …); normalizes source
                       shapes (string | {title,url} | {name,kind}) to
                       canonical {label,type,id?}.
contribute             Add evidence to the semantic index.
send_message           Send a message into a workspace chat.
send_conversation      Pin a conversation to a thread.
get_activity           Recent timeline events for the active scope.
detect_contradictions  Surface inconsistencies in indexed documents.
directory_query        Resolve users / workspace members by display name.
discover_similar       Find documents similar to a query.
set_scope              Set the active project for this MCP session.
scope_configure        Configure advanced scope rules.
```

### Session lifecycle

Each user gets one `MCPSession` (per-user `Map` entry) with **30-minute inactivity expiry**. Tool handlers receive a mutable session object holding active scope (workspace, project, file focus). Expired sessions are lazy-reaped on the next heartbeat or tool call.

API keys for agents are managed via `/api/mcp/keys`. Keys are HMAC-signed; the middleware verifies on every tool call.

### Sharing-tool contract

`contribute`, `send_message`, `send_conversation`, `get_activity`, `detect_contradictions` all **require project scope** to be set before invocation. Recipients are resolved by display name via `workspaceMembers` + `users` join, not by user ID. The tools reuse `sharing/privacy-filter`, `sharing/slice-builder`, `sharing/context-request` rather than introducing new sharing logic.

---

## 5. Chat completion (`services/chat/`)

`completion.ts` is the main entry. `system-prompt.ts` builds the system prompt by concatenating context blocks from many sources; `tools.ts` registers the in-chat tool schemas; `mention-parser.ts` resolves `@mentions`; `directory-routing.ts` routes by display name.

Streamed via Server-Sent Events. Wraps Claude (`@anthropic-ai/sdk`) plus OpenRouter as the multi-provider fallback. Prompt caching is on for the system block.

System prompt assembly (rough order):

1. Base persona + role prompts (per `model-tier-prompts.ts`).
2. Active scope summary (workspace / project / file).
3. Strand context block (if a strand is active) — from `services/thread-speaker.ts`.
4. Reference-agent context block (see §3).
5. Recent edit history — word-level diffs from `local-provenance-store.ts` on the web side, sent via `buildRecentEditsSection()`.
6. The user message and tool definitions.

The chat agent reads `chatSourceType` on creates (`POST /api/chat/conversations`) — one of `follow-web` (default), `follow-notebook`, `claude`, `chatgpt`, `cursor`, `custom`. This tags the conversation for analytics and changes the system prompt tail.

---

## 6. AI State — the memory layers (`services/ai-state/`)

`aiState` is per-user, per-workspace and lives across four time horizons. Each layer feeds the reference agent as a retrieval lane.

| Layer      | Storage              | TTL            | Written by                    | Used for                                                |
| ---------- | -------------------- | -------------- | ----------------------------- | ------------------------------------------------------- |
| Immediate  | Redis                | 10 min         | Every heartbeat               | What the user is doing right now                        |
| Event      | Postgres ring buffer | last 20 events | Reporter / Analyst            | Active tensions, recent knowledge                       |
| Session    | Postgres             | per session    | Archivist (session start/end) | Section visits, AI interaction counts                   |
| Persistent | Postgres             | indefinite     | Profiler (daily)              | Work style, collaboration patterns, long-term knowledge |

Pattern detection, condensation, and knowledge-extraction schedulers all write into these layers. **All four schedulers are currently flag-gated off** in `server-vault.ts` — only `scheduler-sync` runs in the stripped state. When the schedulers are off, the reference agent loses retrieval lanes but `query_index` still works (each lane is SOFT — see AUDIT-CORE-1 §9a).

---

## 7. Sharing layer (`services/sharing/`)

Lets users selectively expose facts to other users / agents. Three pieces:

1. **Privacy preset** — `Private`, `Balanced`, `Open`. Each is a starting rule-set; custom rules layer on top.
2. **Slice builder** — filters the user's facts through the active preset + rules, produces a "slice" snapshot.
3. **Passcode lock** — slice optionally locked with `sha256(passcode + salt)`; salt is 16 random bytes hex; TTL 30 min.

Sync events fan out to subscribers when a new fact lands inside an active slice. UI surfaces: lock indicator, REQUEST INBOX, preset selector, passcode dialog (FE-4 / FE-5).

---

## 8. Model tier strategy

There is a single registry at `packages/api/src/config/models.ts`:

- **`DEFAULT_MODEL_TIERS`** — 27 named tiers mapped to OpenRouter model handles. Auxiliary tiers default to the free Gemma model; the 5 pipeline roles use heterogeneous models tuned to their job (see §2 table).
- **`ACTIVE_TIERS`** — array of 15 tiers actually called by live code. The dashboard "Models" tab uses this to split active vs. unused.
- **`MODEL_TIERS`** — a Proxy view that resolves `data/model-overrides.json` first, then falls back to `DEFAULT_MODEL_TIERS`. Lets the dev dashboard swap any tier at runtime without restart.

`GET /api/models` returns the merged set with `active: boolean` flags.

The free-Gemma default came from MODEL-1 (2026-04-21). The 5-role specialization came later (2026-04-29) when the v5.2 product doc landed. Memory notes claiming "all 24 tier defaults → Gemma" reflect the MODEL-1 snapshot, not the current state.

---

## 9. Threads, strands, and provenance

This vocabulary is consistent across the system; if you're touching anything provenance-adjacent, internalize this first.

- **Thread** — a set of user-AI interactions tied to one context object (a file, conversation, or session). Captures the back-and-forth.
- **Strand** — a named line of work that spans threads. The "story" — e.g. "Q2 planning" might pull from 4 docs and 12 chats.
- **Event** — a unit inside a thread: a user action, an AI reply, a tool call, a knowledge extraction.
- **Evidence** — source attribution attached to events. AI reasoning, document edits, web context.

Schema: `db/schema/threads.ts` defines `threads`, `strands`, `thread_events` with enums `thread_type`, `thread_status`, `strand_status`. Wrapper rows for chat artifacts live in `raw_files` with `source_type='chat_artifact'`.

Read order for new contributors: `threads.ts` → `chat.ts` (conversations) → `semantic-index.ts` (episodes / index_records) → `services/thread-speaker.ts` (how strands surface in chat).

---

## 10. Capture pipelines

Three input paths land in the same indexer:

1. **Extension signals** — 5 s client batches → `/api/capture/realtime` (gated `route-capture-realtime`) → ClickHouse `thread_signals` → realtime-scheduler (15 s tick) → distillation via the indexing pipeline → `thread_events`.
2. **GWS snapshots** — periodic snapshots of Google Docs / Sheets / Slides → `/api/gws` → `gws_snapshots` table → indexer.
3. **Desktop agent / web upload** — file content → `/api/raw-files` → `raw_files` (content-addressed by SHA-256) → indexer with `source_type`.

`raw_files.space_id` (STABILIZE-3) ties uploads to a workspace space; `file_path` (MCP-FIX-4) preserves folder structure from `filePaths[]` parallel arrays. Conversation versioning (MCP-3) lives across `chat_conversations.{content_hash, version}`, `chat_messages.superseded_by_message_id`, and `chat_conversation_snapshots`.

---

## 11. Status badges (`BADGE-1`)

The web UI shows per-item indexing state via `IndexStatusBadge`. Statuses come from `GET /api/index/items/status` which resolves both conversation IDs and workspace file IDs:

- Conversation IDs map through the `chat_artifact` wrapper raw_file (joined by `source_type='chat_artifact' AND source_ref=convId`).
- `index_records.sourceFileId` is matched against **both** the wrapper id and the original conversation id (since `resolveSourceVersion` sets `sourceFileId = conversationId` for chat threads — they don't always match).

The Cancel button in the badge popover wires to `POST /api/index-queue/jobs/:jobId/cancel`.

---

## 12. Known wiring & gotchas

- `routes/indexes.ts:320` calls `ensureProjectStrand(space.id, workspaceId, userId)` with 3 args; the signature requires 4 (`workspaceId, ownerId, spaceId, projectName`). TS flags it; runtime is swallowed by the surrounding try/catch so `POST /api/indexes` still succeeds. Fix when you next touch project creation.
- All four "smart" schedulers (realtime, condensation, knowledge-extraction, pattern-detection) ship `active: false` in `server-vault.ts`. Flip and restart the API to enable.
- `chat-fact-extractor` runs **regardless** of the realtime scheduler — it's a synthetic fallback path so chats still produce facts even with the scheduler off.
- The MCP REST OpenAPI spec uses `MCP_PUBLIC_URL` to bake endpoint URLs at startup. Free-tier ngrok rotates URLs; the launcher refreshes this, but a standalone API needs it set manually.
- `read_file` for chat threads now returns the full reasoning trail per assistant message. The `reasoning-panel.tsx` web UI mirrors the same normalization. If you add a new alias field, update both.

For broader live gotchas (type errors, env quirks, dead routes) see `docs/KNOWN_ISSUES.md`.

## EDGE-FACET-1 (2026-06-02) — per-facet edge similarity

ANALYST edge classification no longer relies on a single composite cosine. The candidate generator (`semantic-index/indexer.ts` → `detectAndInsertLinks`) computes a per-facet cosine triple `{content, causal, context}` for each candidate pair and passes it to `classifyEdge` as `facetSimilarity` (scalar `cosineSimilarity` kept for back-compat). The pure module `pipeline/facet-signal.ts` derives the geometric pattern — high-content+low-causal ⇒ contradiction, high-content+high-causal ⇒ elaboration, high-context+low-content ⇒ reference — which the ANALYST prompt reads as a prior. Near-content/far-causal pairs (the contradiction signature) are **surfaced** to ANALYST even when the composite cosine misses the link threshold (gated to the `pipeline-analyst-llm` path; legacy heuristic unchanged). Facets are only computed when both records carry the content facet, so legacy/retro records keep the scalar path. See `docs/audits/EDGE-FACET-1-REPORT.md`.

## SPLIT-1 (2026-06-02) — Archivist/Profiler compute↔commit split

The two persisting pipeline roles are split into a pure read+decide phase and a write phase, so they can run read-only (shadow). `archivist.ts`: `computeArchivist()` (reads + LLM, **no writes**) + `commitArchivist()` (the promote/demote/supersede writes); `runArchivist` = compute→commit. `profiler.ts`: `computeProfiler()` + `commitProfiler()` (pattern/edge-prior writes); `runProfiler` = compute→commit. External behavior unchanged. Tests (`__tests__/split-roles.test.ts`) assert compute writes nothing and commit writes. See `docs/audits/SPLIT-1-REPORT.md`.

## GRAPH-1 (2026-06-02) — LangGraph shadow harness

A router-over-shared-state pipeline harness (LangGraph) lands in shadow alongside the live pipeline. `@workspace/shared/pipeline-state.ts` defines the `PipelineState` contract (facts/edges/scores/episodes/profileDelta/retrievalTrace/contributors/nodeLog/meta) + `computeShadowVerdict`. `services/pipeline/graph/` holds the state annotation, nodes, router `StateGraph` (reporter→archivist→profiler), and `runPipelineGraph`. Archivist/Profiler nodes call SPLIT-1's `compute*` always and `commit*` only when `meta.persist` — so shadow runs perform no writes. Gated by the `pipeline-graph` flag (default off); `GET /api/dev-graph/shadow` renders the nodeLog + verdict when on. The shared state accumulates facts across nodes, so the historical `totalFacts:0 / topicsCovered:[]` bug is structurally gone. See `docs/audits/GRAPH-1-REPORT.md`.
