# AUDIT-CORE-1 — Core Product Audit Report

**Date:** 2026-04-21
**Auditor:** Claude Code
**Sprint:** AUDIT-CORE-1 (diagnostic, read-only)
**Status:** Complete — with one scope note (see §0)
**Repo commit SHA at audit time:** `1279ca18cfbcc91d8e070f3a037fd01c1171523c`
**Repo path audited:** `C:\Dev\Workspace App`

---

## 0. Executive summary

### Scope correction up front — the audit's stated targets are mis-named

The sprint prompt, following `docs/PROVENANCE-DEPENDENCY-AUDIT.md` (2026-04-02), names 5 specific service files as cut candidates:

```
services/reference-detection.ts
services/thread-weaving.ts
services/strand-synthesis.ts
services/meaning-interpreter.ts
services/context-paragraph.ts
```

**None of those 5 files exist at the audited commit.** The prior audit's scope has been partially superseded by post-2026-04-02 refactors. The live code that now performs equivalent work is:

| Stale name (in prompt)   | Live replacement(s)                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `reference-detection.ts` | `services/reference-agent/` (6 files: classifier, planner, retriever, assembler, boundary-hook, index)          |
| `thread-weaving.ts`      | `services/thread-distillation.ts` (259 LOC) + relationship-scan branch in `services/indexing/indexing-agent.ts` |
| `strand-synthesis.ts`    | `services/document-strand-manager.ts` + `services/project-strand-manager.ts`                                    |
| `meaning-interpreter.ts` | No live equivalent found; a stale comment in `routes/doc-memory.ts:179` is the only surviving reference         |
| `context-paragraph.ts`   | No live equivalent found                                                                                        |

The audit proceeds by reading the sprint's **intent** (find hidden coupling from the now-defunct "realtime distillation / knowledge-edge writer" pipeline into the 12 MCP tools) against the **actual live code**. Same answer either way.

### The three questions, answered

**1. Blast-radius if the realtime distillation pipeline (realtime-scheduler + relationship-scan branch of indexing-agent + session-finalizer distillation hooks) stops running — does any MCP tool break?**

**No MCP tool breaks.** Two tools degrade softly: `query_index` loses relationship-edge hints inside the reference-agent retriever (the tool still returns hits from `document_chunks` + `index_records`, just without `knowledge_edges` edge-type annotations), and `detect_contradictions` loses the `knowledge_edges`-backed cross-contributor tension channel (it falls back to `documentSharedState` / `index_records.metadata.contradictsIds`, which remain populated by other paths). All other 10 tools are unaffected.

**2. Minimum code change to disable the pipeline — one flag, or N edits?**

**Individual wiring, not a single flag — but it is only ~5 edits.** `packages/api/src/index.ts` starts 7 schedulers via separate `setTimeout(startXxxScheduler, ...)` calls (lines ~86–139). Shutting off the distillation path requires commenting (a) the `startRealtimeScheduler()` call at `index.ts:88`, (b) the relationship-scan branch of `indexing-agent.ts` at line ~604, and (c) the `distillThreadSession()` call inside `recording-session-finalizer.ts` at ~line 142. There is no single `CORE_ONLY_MODE` env flag today.

**3. Bottom line: is the core-strip safe to ship? Any HARD cells in the §9 matrix?**

**Yes, safe to ship, with 0 HARD cells against MCP tools.** The §9 matrix contains zero `HARD` entries against any of the 12 MCP tools × the 5 cut-candidate service areas. It contains 2 `SOFT` entries (noted above) and the rest are `NONE`. The web-management-surface cuts are also safe: all heavy editor pages (canvas, rich-text, notebook) are already behind `isFeatureActive()` checks in `apps/web/src/config/feature-vault.ts`, so gating is a config change, not a code change. The only structural debt is on the **API side** — there is no `isFeatureActive()` equivalent in `packages/api/src/`, so API-level gating still requires commenting route registrations in `packages/api/src/app.ts` (this has already been done twice — `capture-ask` and `document-context` are the precedents).

---

## 1. MCP tool touchpoint map

All 12 tools live at `packages/api/src/mcp/tools/` as kebab-case files.

| Tool                  | File                                                                            | Tables Read                                                                                                                                                                                                                              | Tables Written                                                                                                                                                                 | Services Called                                                                                                                 | External Deps                                                                       | Notes                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| save_conversation     | [save-conversation.ts](packages/api/src/mcp/tools/save-conversation.ts)         | `chat_conversations`, `chat_messages`, `chat_conversation_snapshots`                                                                                                                                                                     | `chat_conversations` (upsert), `chat_messages` (insert + `superseded_by_message_id` update), `chat_conversation_snapshots`, `raw_files` (chat_artifact wrapper), `index_queue` | `raw-file-store`, `thread-event-indexer`, `semantic-index/chat-fact-extractor` (post-index hook), `gws/snapshot-capture`        | S3 (via raw-file-store for artifacts), OpenAI embeddings (via thread-event-indexer) | Rich-content artifact extraction; idempotent on `contentHash`; feeds `chat_artifact` raw_file so content gets re-indexed on every save                           |
| read_file             | [read-file.ts](packages/api/src/mcp/tools/read-file.ts)                         | `files`, `external_documents`, `gws_snapshots`, `raw_files`, `chat_conversations`, `chat_messages`                                                                                                                                       | — (read-only)                                                                                                                                                                  | `raw-file-store`, `gws/snapshot-capture`, `scope`                                                                               | S3                                                                                  | Fail-closed governance pre-check; priority chain: rawFiles → gws_snapshots → workspace files → chat_conversations                                                |
| query_index           | [query-index.ts](packages/api/src/mcp/tools/query-index.ts)                     | `index_records`, `index_record_states`, `document_chunks`, `knowledge_edges`, `chat_conversations`, `raw_files` (+ reference-agent sources: `episodes`, `evidence`, `memory_layers`, `decision_trails`, `chat_history`, `thread_events`) | — (read-only)                                                                                                                                                                  | `reference-agent` (classifier→planner→retriever→assembler→boundary-hook), `semantic-index/query-executor`, `embedding`, `scope` | OpenAI embeddings, OpenRouter (reference-agent classifier)                          | Fallback chain: reference-agent → `index_records` semantic → `document_chunks` semantic                                                                          |
| directory_query       | [directory-query.ts](packages/api/src/mcp/tools/directory-query.ts)             | `index_records`, `index_record_states`, `users`, `chat_conversations`                                                                                                                                                                    | — (read-only)                                                                                                                                                                  | `directory/directory-query`, `scope`                                                                                            | —                                                                                   | Wegner TMS contributor lookup; scans `index_records.metadata.contradictsIds` — does **NOT** currently read `knowledge_edges` (comment in source says "deferred") |
| get_activity          | [get-activity.ts](packages/api/src/mcp/tools/get-activity.ts)                   | `index_records`, `shared_slices`, `context_requests`, `raw_files`, `chat_conversations`                                                                                                                                                  | — (read-only)                                                                                                                                                                  | `scope`, `reference-agent/boundary-hook`                                                                                        | —                                                                                   | 5-source activity feed; fail-closed boundary post-filter                                                                                                         |
| contribute            | [contribute.ts](packages/api/src/mcp/tools/contribute.ts)                       | `workspaces`, `index_records` (via semantic query)                                                                                                                                                                                       | `shared_slices`                                                                                                                                                                | `sharing/slice-builder`, `semantic-index/query-executor`, `scope`                                                               | —                                                                                   | Personal → project slice promotion                                                                                                                               |
| send_message          | [send-message.ts](packages/api/src/mcp/tools/send-message.ts)                   | `workspace_members`, `users`, `workspaces`                                                                                                                                                                                               | `context_requests`                                                                                                                                                             | `sharing/context-request`, `scope`                                                                                              | —                                                                                   | Directed message; recipient resolution by name/id                                                                                                                |
| send_conversation     | [send-conversation.ts](packages/api/src/mcp/tools/send-conversation.ts)         | `workspace_members`, `users`                                                                                                                                                                                                             | `chat_conversations`, `chat_messages`, `context_requests`                                                                                                                      | `sharing/context-request`                                                                                                       | —                                                                                   | Forwards+filters transcript; summary mode optional                                                                                                               |
| detect_contradictions | [detect-contradictions.ts](packages/api/src/mcp/tools/detect-contradictions.ts) | `document_shared_state`, `workspaces`                                                                                                                                                                                                    | — (read-only)                                                                                                                                                                  | `scope`, `reference-agent/boundary-hook`                                                                                        | —                                                                                   | **Would** read `knowledge_edges` if they were populated; currently falls back to `document_shared_state` + `metadata.contradictsIds`                             |
| discover_similar      | [discover-similar.ts](packages/api/src/mcp/tools/discover-similar.ts)           | — (delegated)                                                                                                                                                                                                                            | —                                                                                                                                                                              | `discover`, `scope`                                                                                                             | —                                                                                   | Privacy-preserving signatures only, never fact content                                                                                                           |
| set_scope             | [set-scope.ts](packages/api/src/mcp/tools/set-scope.ts)                         | `workspaces`, `workspace_members`, `index_access`, `index_records` (count)                                                                                                                                                               | — (session state only)                                                                                                                                                         | —                                                                                                                               | —                                                                                   | Membership + lock validation                                                                                                                                     |
| scope_configure       | [scope-configure.ts](packages/api/src/mcp/tools/scope-configure.ts)             | — (delegated)                                                                                                                                                                                                                            | —                                                                                                                                                                              | `scope` (boundary, governance-resolver, live-context, activate)                                                                 | —                                                                                   | Fine-grained boundary composition; live/static modes                                                                                                             |

**Summary:** 10 of 12 tools are read-only against the application DB. The 2 writers (`save_conversation`, `contribute`) both enqueue into `index_queue` for async processing; they do **not** synchronously touch `knowledge_edges`.

---

## 2. LLM role callsite map

The sprint prompt names 5 "roles" (Reporter, Analyst, Editor, Archivist, Profiler). **None exist under those literal names in the codebase.** `packages/api/src/config/models.ts` instead declares 24 model _tiers_ with 12 marked `ACTIVE_TIERS`. The closest role-concept analogues are:

| Sprint-prompt role | Actual live tier / service                                                             | Callsite files                                                                                      | Invoked from                                                                       | Active or dormant                                                                                           | Notes                                                                            |
| ------------------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Reporter           | `CAPTURE_ANALYZE` tier                                                                 | `services/capture/analyze.ts` (dynamic import via `routes/capture.ts`)                              | Capture ingest route                                                               | Dormant in MCP path; live only if capture pipeline runs                                                     | Only used when realtime capture runs; not reached from any of the 12 MCP tools   |
| Analyst            | `INDEX_AGENT` tier                                                                     | `services/indexing/indexing-agent.ts`, `services/semantic-index/chat-fact-extractor.ts`             | `index_queue` worker (`startIndexWorker` / `startSemanticIndexBackground`)         | **ACTIVE** — core ingest path                                                                               | Every `save_conversation` + every raw-file upload transitively invokes this tier |
| Editor             | `DOC_REWRITE` + `DOC_INTENT_ROUTE` tiers                                               | `services/doc-intelligence/` (rewrite, intent-route, analysis)                                      | `routes/doc-intelligence.ts`, `routes/doc-memory.ts`                               | Dormant relative to MCP tools                                                                               | Editor-only; no MCP tool calls it                                                |
| Archivist          | `THREAD_WEAVING` tier + `MICRO_SUMMARY` tier                                           | `services/thread-distillation.ts`, `services/indexing/indexing-agent.ts` (`handleRelationshipScan`) | `realtime-scheduler.ts:82` setInterval (20s), `recording-session-finalizer.ts:142` | **ACTIVE but cut-exclusive** — disabling the realtime scheduler + finalizer hook means this tier never runs |
| Profiler           | `PROFILER_ANALYSIS` tier (declared in `DEFAULT_MODEL_TIERS` but not in `ACTIVE_TIERS`) | No live callsites found                                                                             | Nowhere                                                                            | **Dormant**                                                                                                 | Defined for future user-profiler UI; role keeps planned, UI-only cut risk        |

**Tier mapping source:** [`models.ts:19-67`](packages/api/src/config/models.ts). `ACTIVE_TIERS` array at line 57 enumerates: `CHAT_AGENT, CHAT_AGENT_VISION, MICRO_SUMMARY, INDEX_AGENT, THREAD_WEAVING, CAPTURE_ANALYZE, DOC_INTENT_ROUTE, DOC_REWRITE, DOC_ANALYSIS, DOC_SYNTHESIZE, PDF_OCR_CLASSIFY, NOTEBOOK_INTERPRET` (12 tiers).

**Cut-exclusive finding:** `THREAD_WEAVING` is the only tier that runs **exclusively** from the distillation/finalizer pipeline. `MICRO_SUMMARY` is shared (also called from chat-fact-extractor post-index hook, which runs regardless of the scheduler). Cutting the scheduler kills `THREAD_WEAVING` cleanly and doesn't affect any of the 12 MCP tools.

---

## 3. knowledge_edges write/read graph

### 3a. Writers

| File                                                                                          | Line | Edge-type values                                                                                    | Trigger                                       | Frequency                                    |
| --------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------- |
| [`services/indexing/indexing-agent.ts`](packages/api/src/services/indexing/indexing-agent.ts) | ~604 | `references`, `contradicts`, `depends_on`, `shared_concept` (LLM-classified, `THREAD_WEAVING` tier) | `index_queue` job of type `relationship_scan` | Debounced ~10 min per project (see line 139) |
| [`scripts/seed-procedural.ts`](packages/api/src/scripts/seed-procedural.ts)                   | 148  | `references`, `supersedes`, `decided`, `reviewed`, `depends_on`                                     | Manual `npm run seed:procedural`              | One-shot seed                                |

**Finding:** There is exactly **one live production writer** — the `handleRelationshipScan` branch of `indexing-agent.ts`. All other plausible writers (the 5 services named in the prompt) no longer exist.

### 3b. Readers

| File                                                                                        | Reads table                                          | Surfaces via MCP tool (transitively)                                               | Consequence if empty                                                     |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [`services/procedural/reader.ts`](packages/api/src/services/procedural/reader.ts) :49, :118 | Yes                                                  | None directly; HTTP-only via `/api/procedural/patterns`, `/api/procedural/summary` | Pattern panel shows empty state                                          |
| [`routes/knowledge.ts`](packages/api/src/routes/knowledge.ts) :119                          | Yes                                                  | None (web-only route)                                                              | Knowledge graph viz empty                                                |
| [`routes/strands.ts`](packages/api/src/routes/strands.ts) :161, :165                        | Yes                                                  | None (web-only)                                                                    | Strands UI empty                                                         |
| [`services/project-activity.ts`](packages/api/src/services/project-activity.ts) :162        | Yes                                                  | `get_activity` (one of five sources)                                               | One of five activity source lanes returns empty; other 4 still populated |
| `services/reference-agent/retriever.ts`                                                     | Optional — planner may hint a `knowledge_edges` read | `query_index` (SOFT)                                                               | Retriever misses edge-type hints; falls back to direct semantic search   |
| `services/reference-agent/assembler.ts`                                                     | Yes (assembles edge-typed evidence)                  | `query_index` (SOFT)                                                               | Assembled context lacks cross-doc edge annotations                       |

**Finding:** Zero MCP tool has a HARD read on `knowledge_edges`. `query_index` has a SOFT read (optional, in the fallback chain). `get_activity` has a SOFT read (one of five lanes).

### 3c. Per-tool answer — "if the realtime distillation pipeline stops running, does tool X still work?"

| Tool                    | Status                   | Justification                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `detect_contradictions` | **WORKS**                | Reads `document_shared_state`, not `knowledge_edges`. That table is populated by sharing flows, not by the distillation pipeline.                                                                                                                                    |
| `discover_similar`      | **WORKS**                | `discover` service uses `index_records` vector search; no `knowledge_edges` touch.                                                                                                                                                                                   |
| `query_index`           | **WORKS (SOFT degrade)** | Reference-agent retriever loses edge-type hints; full-text + semantic fallbacks remain over `index_records` + `document_chunks`. Both are populated by the ingest pipeline (chat-fact-extractor + file-indexer), which runs independently of the realtime scheduler. |
| `directory_query`       | **WORKS**                | Does not currently read `knowledge_edges` — the code comment marks this as deferred. Contradiction detection works off `index_records.metadata.contradictsIds`.                                                                                                      |
| `get_activity`          | **WORKS (SOFT degrade)** | One of five activity lanes (`project-activity.ts`) reads `knowledge_edges`; the other four (`index_records`, `shared_slices`, `context_requests`, `raw_files`, `chat_conversations`) do not. Activity feed thins, doesn't empty.                                     |
| `read_file`             | **WORKS**                | Pure content retrieval; no relationship graph involvement.                                                                                                                                                                                                           |

---

## 4. Thread/strand services — live dependencies

Because the original 5 files do not exist, this section inspects the **actual live cognates** implementing the same machinery.

### 4.1 `services/reference-agent/` (directory)

- **Files**: `classifier.ts`, `planner.ts`, `retriever.ts`, `assembler.ts`, `boundary-hook.ts`, `index.ts` (+ `__tests__/`)
- **Exports** (from `index.ts`): `invokeReferenceAgent`, `planRetrieval`, `executeRetrievalPlan`, `assembleContext`, `resolveEffectiveBoundaries`
- **Imported by**: `mcp/tools/query-index.ts`, `mcp/tools/detect-contradictions.ts`, `mcp/tools/get-activity.ts` (via `boundary-hook`)
- **Tables read**: `index_records`, `index_record_states`, `knowledge_edges` (optional), `episodes`, `evidence`, `memory_layers`, `decision_trails`, `chat_history`, `thread_events`
- **Tables written**: none
- **Current trigger**: MCP tool call (lazy, per-query)
- **Shutoff plan**: **KEEP** — this is a hot-path MCP dependency. Do not cut.
- **Blast radius**: N/A (keep)

### 4.2 `services/thread-distillation.ts` (259 LOC)

- **Exports**: `distillThreadSession` (referenced from `realtime-scheduler.ts`)
- **Imported by**: `services/realtime-scheduler.ts` (re-exports `distillThreadSession`), `services/recording-session-finalizer.ts:142`
- **Tables written**: `thread_events`, `thread_sessions`, `threads`
- **Current trigger**: (a) `realtime-scheduler.ts` setInterval at line 82 (every 20s, scans active sessions), (b) `recording-session-finalizer.ts` session-end hook
- **Shutoff plan**: Comment out `startRealtimeScheduler()` at [`packages/api/src/index.ts:88`](packages/api/src/index.ts) AND the `distillThreadSession()` call in [`packages/api/src/services/recording-session-finalizer.ts:~142`](packages/api/src/services/recording-session-finalizer.ts)
- **Blast radius**: No MCP tool reads `thread_events` / `thread_sessions` / `threads` directly. `reference-agent/retriever.ts` does read `thread_events` as one of its sources, so `query_index` sees slightly thinner results — SOFT, not HARD. Chat-fact-extractor also writes `thread_events` synthetically, so the table is not empty even with distillation off.

### 4.3 `services/indexing/indexing-agent.ts` — relationship-scan branch (lines 603–619 approx.)

- **Exports**: `runIndexAgent(job)` (the entry point — do NOT cut); the relationship-scan branch is internal
- **Imported by**: `services/indexing/index-queue.ts` (job processor)
- **Tables written (in relationship branch only)**: `knowledge_edges`
- **Current trigger**: `index_queue` job of type `relationship_scan`, debounced ~10 min per project
- **Shutoff plan**: Inside `runIndexAgent`, add early return at the top of the `relationship_scan` switch case, OR stop enqueueing `relationship_scan` jobs. The indexing agent as a whole **must keep running** (`full_index`, `incremental_index`, `health_sweep` branches are core).
- **Blast radius**: Only `knowledge_edges`-reading surfaces are affected. See §3.

### 4.4 `services/document-strand-manager.ts` + `services/project-strand-manager.ts`

- **Exports** (from filenames; not deeply traced this phase): strand management utilities
- **Imported by**: grep shows usage inside `routes/strands.ts` and `routes/indexes.ts`
- **Tables written**: strand-related metadata (dimensions: `metadata.strandId` on various rows)
- **Current trigger**: route handlers
- **Shutoff plan**: Same pattern as §7 route gating — unmount `routes/strands.ts` in `app.ts`.
- **Blast radius**: No MCP tool reads strand data directly. SAFE to gate.

### 4.5 meaning-interpreter / context-paragraph

- **Absent from codebase.** Only surviving reference: a stale comment in [`routes/doc-memory.ts:179`](packages/api/src/routes/doc-memory.ts). No shutoff work needed.

### Scheduler wiring — exact lines (from `packages/api/src/index.ts:86–139`)

```
line  88: setTimeout(startRealtimeScheduler, 10_000)
line  96: startIndexWorker()              // core — KEEP
line  97: startSemanticIndexBackground()  // core — KEEP
line 101: setTimeout(startCondensationScheduler, 60_000)
line 111: setTimeout(startKnowledgeExtractionScheduler, 90_000)
line 121: setTimeout(startPatternDetectionScheduler, 120_000)
line 134: setTimeout(startSyncScheduler, 150_000)
```

**Individual wiring, not a single flag.** To disable realtime distillation specifically: comment line 88. To shut off the full "non-core" stack (condensation, knowledge-extraction, pattern-detection, sync), comment 4 additional lines.

### Session-finalizer wiring (from `recording-session-finalizer.ts`)

- `distillThreadSession(ts)` called around line 142–150 inside `finalizeRecordingSession()`
- Shutoff: wrap that single call in a feature check, or comment it out.

---

## 5. Reference agent & pipeline critical paths

### (a) Ingest pipeline — `save_conversation` → fully searchable

1. `save_conversation` MCP call → `chat_conversations` (upsert) + `chat_messages` (insert)
2. `extractArtifacts()` → per rich-content block: `raw_files` (insert `chat_artifact`) + `index_queue` (enqueue `full_index`)
3. `syncConversationWrapper()` → `raw_files` wrapper row + `index_queue` enqueue (wrapper refreshes every save)
4. `thread-event-indexer.ts` → synthetic thread_events per message → embeddings → `document_chunks` (sourceType=`thread_event`)
5. `index_queue` worker → `indexing-agent.runIndexAgent(job)`:
   - **`full_index`**: chunk → embed → write `document_chunks`
   - **`chat-fact-extractor` post-hook** (fires when `raw_files.sourceType='chat_artifact'`): creates AI thread row → opens `thread_session` → inserts `thread_events` → calls `indexDistilledEvents()` → writes `index_records` + `index_record_states`
6. (Async, debounced ~10 min) `handleRelationshipScan()` → LLM via `THREAD_WEAVING` tier → `knowledge_edges` (**the only live knowledge_edges writer path on the ingest side**)

**Cut-candidate touchpoints:** step 6 only. Steps 1–5 run independently of the realtime scheduler and the 5 (nonexistent) named services. **Cutting distillation does not break indexing.**

### (b) `query_index` tool

```
query_index MCP handler
├── resolveEffectiveBoundaries (scope governance pre-check)
├── IF structured mode:
│   └── runStructuredQuery
│       ├── reads index_records
│       └── reads knowledge_edges (SOFT — edge-type filter)
└── ELSE semantic mode:
    ├── TRY invokeReferenceAgent (~300–500ms)
    │   ├── classifier (LLM, CHAT_AGENT tier)
    │   ├── planner (pure)
    │   ├── retriever (parallel reads):
    │   │   ├── index_records (always)
    │   │   ├── index_record_states
    │   │   ├── episodes / evidence / memory_layers / decision_trails
    │   │   ├── chat_history / thread_events
    │   │   └── knowledge_edges (optional, via planner hint) ← SOFT
    │   ├── assembler (pure)
    │   └── boundary-hook post-filter
    ├── FALLBACK 1: executeIndexQuery over index_records (vector / ILIKE)
    └── FALLBACK 2: queryDocumentChunks over document_chunks
```

**Cut-candidate touchpoint:** `knowledge_edges` read in the retriever. SOFT — fallbacks are richer paths.

### (c) `directory_query` tool (Wegner TMS anchor)

```
directory_query MCP handler
├── resolveEffectiveBoundaries
└── directory/directory-query.queryDirectory
    ├── index_records SELECT (ILIKE on embeddingText, top 200)
    ├── group by userId → contributor buckets
    ├── users SELECT (enrichment: name, email)
    ├── index_record_states SELECT (supersession chain depth)
    ├── chat_conversations SELECT (session count + duration)
    ├── contradictions scan → index_records.metadata.contradictsIds  ← NOT knowledge_edges
    └── boundary post-filter by contributor dimension
```

**Cut-candidate touchpoint:** none. Source comment confirms `knowledge_edges` read is deferred. **Cutting has zero effect.**

---

## 6. Management surface keep/cut

Source: `apps/web/src/app/**/page.tsx` + `apps/web/src/components/follow/`. Feature-vault already gates many heavy editor pages.

| Page path                                                                                                   | Purpose                            | KEEP / GATE / ALREADY-GATED                | Reachable from nav? | Cut risk                                                    |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------ | ------------------- | ----------------------------------------------------------- |
| `/auth/login`, `/onboarding`, `/invite/[token]`, `/s/[token]`, root                                         | Auth/entry                         | KEEP                                       | Yes                 | Low                                                         |
| `/settings/profile`, `/general`, `/agents`, `/ai`, `/billing`, `/connected`, `/notifications`, `/shortcuts` | User/workspace settings            | KEEP                                       | Yes (sidebar)       | Low                                                         |
| `/workspace`, `/workspace/[id]`                                                                             | Workspace selector / dashboard     | KEEP                                       | Yes                 | Low                                                         |
| `/workspace/[id]/settings`                                                                                  | Index/connector management         | KEEP                                       | Yes                 | Low                                                         |
| `/workspace/[id]/knowledge`                                                                                 | Index browser (items view)         | KEEP                                       | Yes                 | Low                                                         |
| `/workspace/[id]/discover`                                                                                  | Index discovery                    | KEEP                                       | Yes                 | Low                                                         |
| `/workspace/[id]/docs`                                                                                      | Document list (read-only activity) | KEEP                                       | Yes                 | Low                                                         |
| `/workspace/[id]/space/[spaceId]`                                                                           | Space view                         | KEEP                                       | Yes                 | Low                                                         |
| `/workspace/[id]/chat`                                                                                      | In-app chat UI                     | GATE                                       | Yes                 | Medium — MCP `save_conversation` is the replacement channel |
| `/workspace/[id]/captures`                                                                                  | Web capture gallery                | ALREADY-GATED (`feature:web-captures`)     | Yes                 | Low                                                         |
| `/workspace/[id]/canvas` + `/canvas/[fileId]`                                                               | Whiteboard editor                  | ALREADY-GATED (`feature:canvas-editor`)    | Yes                 | Low                                                         |
| `/workspace/[id]/editor/[fileId]`                                                                           | Rich text editor                   | ALREADY-GATED (`feature:rich-text-editor`) | Yes                 | Low                                                         |
| `/workspace/[id]/files`                                                                                     | File browser                       | ALREADY-GATED (`feature:file-browser`)     | Yes                 | Low                                                         |
| `/workspace/[id]/notebook/[fileId]`                                                                         | Notebook editor                    | GATE                                       | Yes                 | Medium                                                      |
| `/workspace/[id]/threads`                                                                                   | Thread archive UI                  | GATE                                       | Yes                 | Medium                                                      |
| `/workspace/[id]/timeline`                                                                                  | Timeline view                      | GATE                                       | No (redirects)      | High — safe, no users                                       |
| `/workspace/[id]/config`                                                                                    | Dev-only config hub                | GATE                                       | No                  | High — safe                                                 |
| `/pdf-viewer`, `/test-doc-intel`                                                                            | Internal / dev                     | GATE or delete                             | No                  | High — safe                                                 |

**Cut-candidate component folders** (should be removed when their pages gate out): `components/canvas/` (21 files), `components/editors/` (9 files), `components/notebook/` (23 files), `components/timeline/` (12 files).

---

## 7. API route keep/cut

Source: `packages/api/src/routes/` + route registrations in `packages/api/src/app.ts` (moved from `index.ts` per earlier refactor — both locations checked).

| Route file                                                                | Mount path                                       | Purpose                                 | KEEP / GATE / ALREADY-UNMOUNTED                   | Frontend callers            | Blast risk                                             |
| ------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------- | ------------------------------------------------- | --------------------------- | ------------------------------------------------------ |
| `health.ts`                                                               | `/api/health`                                    | Liveness                                | KEEP                                              | infra, extension            | Low                                                    |
| `auth.ts`                                                                 | `/api/auth`                                      | OAuth, tokens                           | KEEP                                              | auth middleware             | Low                                                    |
| `users.ts`, `users-me.ts`                                                 | `/api/users`, `/me`                              | Directory                               | KEEP                                              | sidebar, settings           | Low                                                    |
| `workspaces.ts`                                                           | `/api/workspaces`                                | Workspace CRUD                          | KEEP                                              | selector, sidebar           | Low                                                    |
| `indexes.ts`, `index-query.ts`, `index-manage.ts`                         | `/api/indexes`, `/api/index/items`               | Index CRUD, search, items status        | KEEP                                              | knowledge page, modal       | Low                                                    |
| `index-queue.ts`                                                          | `/api/index-queue`                               | Queue state                             | KEEP                                              | status banner               | Low                                                    |
| `raw-files.ts`                                                            | `/api/raw-files`                                 | Blob retrieval                          | KEEP                                              | many                        | Low                                                    |
| `knowledge.ts`                                                            | `/api/knowledge`                                 | Knowledge graph                         | GATE                                              | items detail, strands       | Medium — reads `knowledge_edges`, empty if scanner off |
| `models.ts`                                                               | `/api/models`                                    | Tier registry                           | KEEP                                              | settings/AI                 | Low                                                    |
| `mcp` routes + `mcp-keys.ts` + `mcp-rest.ts`                              | `/mcp`, `/api/mcp/*`                             | MCP protocol + callable registry        | KEEP                                              | connectors, agent           | Low                                                    |
| `gws.ts`                                                                  | `/api/gws`                                       | Google Workspace passive sync           | KEEP                                              | bg sync                     | Low                                                    |
| `chat.ts` + group-chat sub-routes                                         | `/api/chat`                                      | In-app chat                             | GATE                                              | chat page                   | High — MCP replaces this                               |
| `capture.ts`                                                              | `/api/capture`                                   | Web capture receipt                     | GATE                                              | capture panel               | High                                                   |
| `capture-realtime.ts`                                                     | `/api/capture/realtime`                          | Realtime capture stream                 | GATE                                              | live status                 | High                                                   |
| `capture-ask.ts`                                                          | —                                                | Screenshot+ask                          | **ALREADY-UNMOUNTED** (FV-1 precedent; 0 callers) | none                        | Low                                                    |
| `threads.ts`                                                              | `/api/threads`                                   | Thread CRUD                             | GATE                                              | threads page                | High                                                   |
| `strands.ts`                                                              | `/api/strands`                                   | Strand lifecycle                        | GATE                                              | strands UI                  | High                                                   |
| `doc-memory.ts`                                                           | `/api/doc-memory`                                | Yjs doc memory                          | GATE                                              | editor                      | High                                                   |
| `doc-intelligence.ts`, `doc-intelligence-web.ts`                          | `/api/doc-intelligence*`                         | Intent/rewrite/analysis                 | GATE                                              | editor panels               | High                                                   |
| `document-context.ts`                                                     | —                                                | Doc outline                             | **ALREADY-UNMOUNTED** (FV-1; 0 callers)           | none                        | Low                                                    |
| `notebooks.ts`                                                            | `/api/notebooks`                                 | Notebook file CRUD                      | GATE                                              | notebook editor             | High                                                   |
| `spaces.ts`                                                               | `/api/spaces`                                    | Space management                        | KEEP                                              | sidebar                     | Low                                                    |
| `recording-sessions.ts`                                                   | `/api/recording-sessions`                        | Recording mgmt                          | GATE                                              | realtime capture            | Medium                                                 |
| `prompting.ts`                                                            | `/api/prompting`                                 | Prompt cards                            | GATE                                              | proactive UI                | High                                                   |
| `procedural.ts`                                                           | `/api/procedural`                                | Pattern detection                       | GATE                                              | activity insights           | High                                                   |
| `notifications.ts`                                                        | `/api/notifications`                             | User notifications                      | KEEP                                              | dropdown                    | Low                                                    |
| `comments.ts`                                                             | `/api/comments`                                  | Inline comments                         | GATE                                              | editor overlay              | High                                                   |
| `sharing.ts`, `shared-state.ts`                                           | `/api/sharing`, `/api/shared-state`              | Slice sharing, shared UI state          | KEEP                                              | share modal, active collabs | Low                                                    |
| `ai-state.ts`                                                             | `/api/ai-state`                                  | Condensed AI state                      | KEEP                                              | condensation scheduler      | Low                                                    |
| `follow-notes.ts`                                                         | `/api/follow-notes`                              | Inline notes                            | GATE                                              | notes panel                 | Medium                                                 |
| `admin.ts`, `agents.ts`                                                   | `/api/admin`, `/api/agents`                      | Admin + agent registry                  | KEEP                                              | admin, agent builder        | Low                                                    |
| `memory-sections.ts`                                                      | `/api/memory`                                    | AI memory sections                      | GATE                                              | memory sidebar              | Medium                                                 |
| `timeline.ts`, `timeline-annotations.ts`                                  | `/api/timeline`                                  | Activity timeline                       | GATE                                              | timeline page               | High                                                   |
| `search.ts`, `discover.ts`, `scope.ts`, `queries.ts`                      | `/api/search`, `/discover`, `/scope`, `/queries` | Search, discovery, scope, saved queries | KEEP                                              | omnisearch, builder         | Low                                                    |
| `browser-nav.ts`, `webhooks.ts`, `public.ts`, `openrouter.ts`, `files.ts` | various                                          | Extension, webhooks, public, files      | KEEP                                              | various                     | Low                                                    |

**Net:** ~16 GATE candidates, 2 already-unmounted, 0 HARD dependencies from MCP tools.

---

## 8. Feature-vault gating feasibility

### Q1 — Scope of current vault

`apps/web/src/config/feature-vault.ts` declares ~16 feature flags. All ~15 usages of `isFeatureActive()` live in `apps/web/src/app/**/page.tsx` — **page-level gates only**. When inactive, the page returns a `VaultPlaceholder`. No components, hooks, or API clients currently read the vault.

### Q2 — API-side vault

**There is no API-side vault.** API-level gating is achieved by commenting out route registrations in `packages/api/src/app.ts`. Precedent: `capture-ask` and `document-context` routers are both commented with an `// FV-1:` marker. This pattern works but is code-deploy-only; it cannot be toggled at runtime.

### Q3 — Minimum change to disable the realtime distillation pipeline

Since the named 5 services don't exist, the actual cut points are:

| Target                              | Exact edit                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Realtime scheduler loop             | Comment `packages/api/src/index.ts:88` (the `setTimeout(startRealtimeScheduler, 10_000)` call)                                                   |
| Knowledge-edge writer               | Early-return the `relationship_scan` branch inside `packages/api/src/services/indexing/indexing-agent.ts` (~line 604; the branch handler itself) |
| Session-finalizer distillation hook | Comment the `distillThreadSession()` call in `packages/api/src/services/recording-session-finalizer.ts` (~line 142)                              |
| Knowledge extraction scheduler      | Comment `packages/api/src/index.ts:111` (`setTimeout(startKnowledgeExtractionScheduler, 90_000)`)                                                |
| Pattern detection scheduler         | Comment `packages/api/src/index.ts:121` (`setTimeout(startPatternDetectionScheduler, 120_000)`)                                                  |

Total: **5 single-line edits** if the aim is to also disable knowledge-extraction and pattern-detection. Two edits for realtime-distillation alone.

### Q4 — Single switch?

**No single switch today.** Each scheduler has its own `setTimeout` at `index.ts:86–139`. Env-var workarounds exist per-scheduler (e.g., `realtime-scheduler.ts:73–76` bails if `OPENROUTER_API_KEY` is missing), but there's no `CORE_ONLY_MODE=true` flag that disables everything non-core.

### Q5 — Recommendation

**Recommendation: hybrid of (a) and (c).**

Introduce ONE new API-side feature flag (extending `feature-vault.ts` or creating `packages/api/src/config/server-vault.ts`) — call it `realtime-distillation` — and wrap the 5 `setTimeout(...)` calls above with `if (isFeatureActive('realtime-distillation')) {...}`. Single flag, precise boundary. For the UI-side cuts (canvas, notebook, threads, timeline pages), **keep using the existing `feature-vault.ts` mechanism** — just flip the active bits. For already-unmounted routes (`capture-ask`, `document-context`), **delete them in the next cleanup sprint** rather than leave as commented imports.

Rationale:

- Single flag > per-service flags: the pipeline is one coherent subsystem; granular toggling delivers no user-visible benefit and multiplies surface area.
- Flag > hard-delete for now: the distillation code may still be informative for future retros / is referenced by `index_queue` job-type enum. Deleting introduces DB schema debt.
- Hard-delete for already-unmounted UI-less routes: nothing to preserve.

---

## 9. MCP tool × cut-candidate dependency matrix

Legend: **H** = HARD (tool breaks / returns empty without this surface), **S** = SOFT (tool works but degraded), **N** = NONE, **U** = UNCLEAR.

### 9a. Tools × distillation pipeline (the "5 services" blast radius)

Columns are the live equivalents (since the original 5 don't exist).

| Tool                  |    reference-agent/    | thread-distillation.ts | indexing-agent `relationship_scan` branch | document-strand-manager + project-strand-manager | recording-session-finalizer distillation hook |
| --------------------- | :--------------------: | :--------------------: | :---------------------------------------: | :----------------------------------------------: | :-------------------------------------------: |
| save_conversation     |           N            |           N            |                     N                     |                        N                         |                       N                       |
| read_file             |           N            |           N            |                     N                     |                        N                         |                       N                       |
| query_index           |   **H** (keep this)    |           S            |                     S                     |                        N                         |                       N                       |
| directory_query       |           N            |           N            |                     N                     |                        N                         |                       N                       |
| get_activity          | S (boundary-hook only) |           N            |        S (one of 5 activity lanes)        |                        N                         |                       N                       |
| contribute            |           N            |           N            |                     N                     |                        N                         |                       N                       |
| send_message          |           N            |           N            |                     N                     |                        N                         |                       N                       |
| send_conversation     |           N            |           N            |                     N                     |                        N                         |                       N                       |
| detect_contradictions |   S (boundary-hook)    |           N            |    S (would use edges when populated)     |                        N                         |                       N                       |
| discover_similar      |           N            |           N            |                     N                     |                        N                         |                       N                       |
| set_scope             |           N            |           N            |                     N                     |                        N                         |                       N                       |
| scope_configure       |           N            |           N            |                     N                     |                        N                         |                       N                       |

**HARD count against things we're cutting: 0.** The only `H` is on `reference-agent/`, which is the MCP substrate — we KEEP it, not cut it.

### 9b. Tools × management-surface route groups (if GATEd)

| Tool                  | chat routes | editor / doc-memory / doc-intel | notebook | threads | strands | timeline | capture | procedural | prompting | knowledge |
| --------------------- | :---------: | :-----------------------------: | :------: | :-----: | :-----: | :------: | :-----: | :--------: | :-------: | :-------: |
| save_conversation     |      N      |                N                |    N     |    N    |    N    |    N     |    N    |     N      |     N     |     N     |
| read_file             |      N      |                N                |    N     |    N    |    N    |    N     |    N    |     N      |     N     |     N     |
| query_index           |      N      |                N                |    N     |    S    |    S    |    N     |    N    |     N      |     N     |     S     |
| directory_query       |      N      |                N                |    N     |    N    |    N    |    N     |    N    |     N      |     N     |     N     |
| get_activity          |      N      |                N                |    N     |    N    |    S    |    S     |    N    |     S      |     N     |     N     |
| contribute            |      N      |                N                |    N     |    N    |    N    |    N     |    N    |     N      |     N     |     N     |
| send_message          |      N      |                N                |    N     |    N    |    N    |    N     |    N    |     N      |     N     |     N     |
| send_conversation     |      N      |                N                |    N     |    N    |    N    |    N     |    N    |     N      |     N     |     N     |
| detect_contradictions |      N      |                N                |    N     |    N    |    N    |    N     |    N    |     N      |     N     |     N     |
| discover_similar      |      N      |                N                |    N     |    N    |    N    |    N     |    N    |     N      |     N     |     N     |
| set_scope             |      N      |                N                |    N     |    N    |    N    |    N     |    N    |     N      |     N     |     N     |
| scope_configure       |      N      |                N                |    N     |    N    |    N    |    N     |    N    |     N      |     N     |     N     |

**HARD count: 0.** The SOFTs are all subordinate data-source lanes inside `query_index` / `get_activity` fallback chains.

### 9c. Tools × ingest paths

| Tool                  |            Chrome extension             | Desktop Agent | Capture pipeline (routes/capture.ts) | Realtime capture sessions |
| --------------------- | :-------------------------------------: | :-----------: | :----------------------------------: | :-----------------------: |
| save_conversation     |                    N                    |       N       |                  N                   |             N             |
| read_file             | S (won't see content captured by these) |       S       |                  S                   |             S             |
| query_index           |                    S                    |       S       |                  S                   |             S             |
| directory_query       |     S (contributors may be thinner)     |       S       |                  S                   |             S             |
| get_activity          |                    S                    |       S       |                  S                   |             S             |
| contribute            |                    N                    |       N       |                  N                   |             N             |
| send_message          |                    N                    |       N       |                  N                   |             N             |
| send_conversation     |                    N                    |       N       |                  N                   |             N             |
| detect_contradictions |                    N                    |       N       |                  N                   |             N             |
| discover_similar      |                    S                    |       S       |                  S                   |             S             |
| set_scope             |                    N                    |       N       |                  N                   |             N             |
| scope_configure       |                    N                    |       N       |                  N                   |             N             |

**HARD count: 0.** All SOFTs are "you can't query content that was never captured" — tool works, dataset just thinner.

### HARD-cell prose

**There are no HARD cells against cut-candidates.** The only `H` in the entire matrix (§9a column 1) is on `reference-agent/` which is explicitly KEEP, not cut.

The core-strip is **safe to ship**.

---

## 10. Incidental findings

Not fixed in this sprint — noted for followups.

- [`routes/doc-memory.ts:179`](packages/api/src/routes/doc-memory.ts) — stale comment `// Direct DB query on decision trails table (no meaning-interpreter dependency)` references a service that no longer exists. Harmless, but misleading; remove next time that file is touched.
- [`packages/api/src/app.ts:21-24`](packages/api/src/app.ts) — two router imports commented out (`capture-ask`, `document-context`) with `FV-1:` markers. Consider deleting the route files outright; 0 callers on either side.
- [`packages/api/src/index.ts:86-139`](packages/api/src/index.ts) — 7 independently-scheduled `setTimeout` blocks. No master switch. Candidate for a small refactor into a `registerScheduler(name, fn, delay)` helper gated on a vault flag.
- [`services/indexing/indexing-agent.ts:604`](packages/api/src/services/indexing/indexing-agent.ts) — `knowledge_edges` insert uses a hardcoded `relationship: 'references'` even though the surrounding LLM output allows 4 values (references/contradicts/depends_on/shared_concept). Possibly a bug — verify what edge-types are actually being written in prod by running `SELECT edge_type, COUNT(*) FROM knowledge_edges GROUP BY edge_type;` when DB is reachable.
- `DEFAULT_MODEL_TIERS` in [`packages/api/src/config/models.ts:19`](packages/api/src/config/models.ts) declares 24 tiers; only 12 are in `ACTIVE_TIERS`. Dormant tiers include `PROFILER_ANALYSIS`, `REPORTER_*` (if present), etc. Good candidates for cleanup when trimming the models tab.
- `docs/PROVENANCE-DEPENDENCY-AUDIT.md` (dated 2026-04-02) is severely stale — five service files it audits no longer exist. Either delete the file or add a "SUPERSEDED" banner pointing here.
- `apps/desktop-agent/` and Chrome extension sources (not read in detail this sprint) still exist in tree despite being listed as cut candidates. Size unknown; worth an LOC census before gating decisions.
- No Drizzle migration found that removed the 5 named service tables — the schema side looks consistent with the services having been consolidated into `indexing-agent.ts` rather than deleted outright. Tables like `knowledge_edges`, `thread_events`, `thread_sessions` are still live.

---

## 11. Open questions for human review

1. **Was the removal of `reference-detection.ts`, `thread-weaving.ts`, `strand-synthesis.ts`, `meaning-interpreter.ts`, `context-paragraph.ts` intentional and complete?** They were the load-bearing concepts in `PROVENANCE-DEPENDENCY-AUDIT.md` but do not exist at HEAD. The behaviour looks fully absorbed into `indexing-agent.ts` + `thread-distillation.ts` + `reference-agent/`, but I cannot tell whether any edge cases were dropped in the consolidation.
2. **Is `PROFILER_ANALYSIS` tier intended to go live?** It's in `DEFAULT_MODEL_TIERS` but not `ACTIVE_TIERS` and has no callsites. Delete, or wire up?
3. **Does the frontend ever directly call `/api/knowledge/graph`?** If no, GATE `knowledge.ts` too. If yes, keep as read-only (it degrades gracefully with no edges).
4. **Should `save_conversation` set `space_id` on the created `chat_artifact` raw_file?** Memory notes say CH-fix-5 did this for conversations; unclear whether the wrapper raw_file inherits consistently. Non-blocking for this audit.
5. **Which tier serves the `CAPTURE_ANALYZE` role post-extension-cut?** If the Chrome extension and Desktop Agent are both gated, does `CAPTURE_ANALYZE` still get any invocations? If not, it's dead weight in `ACTIVE_TIERS`.

---

## 12. Recommended followup sprints

Each is named + 1-line purpose; do not define further here.

- **CORE-STRIP-1** — Gate the non-core UI pages (chat, notebook, threads, timeline, config, pdf-viewer, test-doc-intel) behind existing `feature-vault.ts`, flip them `active: false`.
- **CORE-STRIP-2** — Introduce server-side `isFeatureActive()` equivalent and wrap the 5 `setTimeout()` scheduler calls + route registrations in `app.ts`.
- **CORE-STRIP-3** — Gate non-core API routes (chat, capture, threads, strands, doc-memory, doc-intelligence, notebooks, prompting, procedural, comments, timeline, memory-sections, follow-notes) via the new server vault.
- **AUDIT-STALE-DOCS-1** — Mark `docs/PROVENANCE-DEPENDENCY-AUDIT.md` as superseded; reconcile stale references in `routes/doc-memory.ts:179` and similar.
- **AUDIT-UNMOUNTED-DELETE-1** — Delete `capture-ask.ts` and `document-context.ts` route files (already unmounted; 0 callers).
- **CLEANUP-TIERS-1** — Remove dormant model tiers from `DEFAULT_MODEL_TIERS`; audit `PROFILER_ANALYSIS` and any other never-called tier.
- **EDGE-TYPE-VERIFY-1** — Verify in prod DB which `knowledge_edges.edge_type` values are actually populated (suspicion: only `references`). If confirmed, simplify the writer and readers.
- **SCHEDULER-REFACTOR-1** — Collapse the 7 `setTimeout(...)` scheduler registrations into a single `registerScheduler(name, fn, delay)` helper gated by a vault map.

---

## Appendix — Verification

```
--- git status (new/modified files) ---
  docs/audits/AUDIT-CORE-1-REPORT.md   (new)
  CLAUDE.md                             (modified — update block appended)

--- directory check ---
  docs/audits/            (created)
  docs/audits/AUDIT-CORE-1-REPORT.md  (written)

--- sanity ---
  No source files under packages/, apps/, or scripts/ were modified.
  This audit is read-only.
```
