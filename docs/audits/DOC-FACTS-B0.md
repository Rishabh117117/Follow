# DOC-FACTS-B0 — Native documents produce facts (versioned, salience-gated)

**Type:** EXECUTION sprint. Branch `claude/doc-facts-b0` off `origin/main` (`c86f794`). **Branch + PR only — NOT merged, NOT deployed.**
**Date:** 2026-06-24. Builds on the read-only recon [DOC-RECON-1](DOC-RECON-1.md).

**Goal (delivered):** native uploaded files (`raw_files.source_type` ∈ `{upload, local}`) now produce `index_records` facts —
one per _salient, de-duplicated_ enriched chunk — stamped with a real `source_version`, entering the knowledge graph exactly
like chat facts. Re-indexing identical content produces **zero** new facts (closing the blind-append behavior for documents).
`source_version` is populated for the first time in this codebase, setting up B-1 (version supersession + point-in-time).

**Out of scope (untouched):** Drive ingestion; version supersession on _changed_ re-sync (B-1); section-level distillation; auth.

---

## What changed (file:line)

| #     | File                                                                                                                                                         | Change                                                                                                                                                                                                                                                                                                                                           |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | **NEW** `services/semantic-index/doc-fact-extractor.ts`                                                                                                      | `extractAndIndexDocFacts({fileId, workspaceId, userId, chunks})`: creates/reuses a `type:'doc'` thread (`metadata.fileId = raw_files.id`), builds one `DistilledEvent` per salient chunk (`type:'edit'`, `distilledFrom:['document']`), routes through the **unchanged** `indexDistilledEvents`. Pure `buildDocFactEvents` exported for testing. |
| 2     | **NEW** `services/semantic-index/doc-salience.ts`                                                                                                            | Pure `selectSalientChunks(chunks, alreadyIndexed)`: importance threshold (0.5) → content-hash dedup (per `source_file_id` + intra-batch) → per-doc cap (50). Constants exported. `docChunkContentHash = sha256(trim(text))`.                                                                                                                     |
| 3     | **NEW** `services/indexing/fact-routing.ts`                                                                                                                  | Pure `routeFactExtraction(sourceType)`: `chat_artifact→'chat'`, `upload\|local→'doc'`, else `null`.                                                                                                                                                                                                                                              |
| 4     | `services/indexing/indexing-agent.ts` (post-index guard, ~382)                                                                                               | Widened: `route==='chat'` → chat extractor (**unchanged**); `route==='doc'` → `extractAndIndexDocFacts` (with the file's enriched chunks incl. `entities`).                                                                                                                                                                                      |
| 5     | `services/semantic-index/indexer.ts` `resolveSourceVersion` (`'file'` branch)                                                                                | **raw_files fallback**: when no `file_versions` row exists for the id, read `raw_files.version` + `raw_files.contentHash` (file-manager files still win). This is what stamps a real `source_version` for uploads. `indexDistilledEvents` orchestration itself unchanged.                                                                        |
| 6     | `services/semantic-index/compose-embedding-text.ts` `buildDocTemplate`                                                                                       | Adds a `Content: ${chunkContent}` line (parity with `buildAITemplate`) so doc-fact embeddings carry the actual document text. Existing doc-edit signals don't set `chunkContent` → unaffected.                                                                                                                                                   |
| Tests | `__tests__/doc-salience.test.ts` (8), `doc-fact-extractor.test.ts` (7), `indexing/__tests__/fact-routing.test.ts` (4), `compose-embedding-text.test.ts` (+4) | Pure (DB-free), mirroring the repo convention.                                                                                                                                                                                                                                                                                                   |

**Design note — additive helper edits (5, 6).** The sprint's "route through the unchanged `indexDistilledEvents`" is honored:
its orchestration (dedup/embed/episode/links/state-capture) is untouched. Two _helper functions it calls_ were extended
additively and backward-compatibly — `resolveSourceVersion` (a new fallback, file-manager path unchanged, chat path untouched)
and `buildDocTemplate` (a conditional line that only fires when `chunkContent` is present). Both were necessary: without (5)
real uploads stamp `source_version=null`; without (6) doc-fact embeddings carry only the summary.

---

## Phase 0 — confirm-before-build (key findings)

- **Guard-widen target:** `raw_files.source_type` ∈ `{upload, local}` (native); `gws`=Drive (out of scope), `chat_artifact`=chat (untouched). The sole fact guard is `indexing-agent.ts:382`.
- **Version-source clarification (vs the sprint's `files`/`file_versions` framing).** The native-upload pipeline writes **only `raw_files`** (no `files`/`file_versions` row), and `queueFileIndex` sets `job.sourceId = raw_files.id` (`file-indexer.ts:52`). An uploaded doc's version lives in **`raw_files.version`** (+ content-addressed `raw_files.contentHash`), which `resolveSourceVersion`'s original `'file'` branch did not read. Hence change #5 (the raw*files fallback) — the honest path to a real `source_version` for the \_actual* pipeline. (A file-manager file with a `file_versions` row still uses that, unchanged.)
- **GATING CHECK — the graph is type-agnostic; `:382` is the only fact-blocking guard.** Re-confirmed DOC-RECON-1's adversarial guard-sweep: `detectAndInsertLinks` candidate query filters `workspaceId`+`eventTime`+`deletedAt` only (no `threadType` — `indexer.ts:772-784`); the reference-agent retriever filters `workspaceId`(+optional `documentId`) only (`retriever.ts:297-373`); `query-executor` applies `threadTypes` only if the caller supplies it (`query-executor.ts:136`), which the planner never does; `permission-filter` privileges `doc`→`'full'` over `ai`→`'fact_only'` (`permission-filter.ts:46-48`); SCOPE-A-1 contested keys on record-id membership only. **No downstream guard needed widening** — confirmed behaviorally in Phase 4 (the doc facts entered `index_records` + got embeddings + episodes + states with no extra change).

---

## Before / after behavior

| Aspect                                                | Before (`c86f794`)                     | After                                                                 |
| ----------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| Native upload (`upload`/`local`)                      | → `document_chunks` only; **no facts** | → `document_chunks` **+ `index_records` facts** (`thread_type='doc'`) |
| `source_version` on doc facts                         | n/a (no doc facts)                     | **stamped from `raw_files.version`** (e.g. `1`)                       |
| Fact volume                                           | n/a                                    | salience-gated: importance≥0.5, deduped, capped at 50/doc             |
| Identical re-index                                    | n/a                                    | **0 new facts** (content-hash dedup)                                  |
| Chat path (`chat_artifact`)                           | chat facts                             | **unchanged** (byte-for-byte same branch)                             |
| Graph (ANALYST edges, retriever, SCOPE-A-1 contested) | chat facts only                        | doc facts flow through automatically (type-agnostic)                  |

---

## Phase 4 — gated end-to-end prod verification (CONFIRMED; torn down to baseline)

Owner-approved sentinel probe against the live prod DB (public proxy), isolated to a sentinel workspace, OpenRouter embeddings
live, full teardown in a `finally`. Raw evidence:

```
BASELINE counts: {"index_records":57,"semantic_links":42,"index_record_states":180,"episodes":54,"threads":54,
                  "thread_sessions":57,"thread_events":57,"raw_files":45,"workspaces":2,"users":2}
seeded sentinel user/workspace/raw_file (version=1, contentHash=__DOCB0__-rawfile-content-hash)

PASS1 result: {"factsIndexed":2,"droppedLowSalience":1,"droppedDuplicate":0,"droppedOverCap":0}
VERIFY index_records (2):
  thread_type=doc | source_version=1 | source_file_id=<rawFileId> | source_content_hash=__DOCB0__-rawfile-content-hash | embedding=true | isAIInvolved=false | section=Decision  | chunkIndex=0
  thread_type=doc | source_version=1 | source_file_id=<rawFileId> | source_content_hash=__DOCB0__-rawfile-content-hash | embedding=true | isAIInvolved=false | section=Rationale | chunkIndex=2
VERIFY semantic_links (0): []          # 2 short distinct sentences below the 0.55 same-type similarity threshold — edge formation is similarity-gated, not doc-blocked
VERIFY index_record_states for sentinel records: 4   # 2 records × (live+static), captured_by='indexer'

PASS2 result (identical re-index): {"factsIndexed":0,"droppedLowSalience":1,"droppedDuplicate":2,"droppedOverCap":0}
VERIFY sentinel index_records after pass2 (expect unchanged): 2

ASSERT count==2: true | all thread_type=doc: true | all source_version=1: true |
       all source_content_hash=raw_files.contentHash: true | all have embedding: true |
       salience dropped 1 low-importance: true | identical re-index → 0 new (dedup): true

TEARDOWN complete.
AFTER counts: {"index_records":57,"semantic_links":42,"index_record_states":180,"episodes":54,"threads":54,
               "thread_sessions":57,"thread_events":57,"raw_files":45,"workspaces":2,"users":2}
BASELINE RESTORED (before==after): true | COUNTS IDENTICAL | === PROBE PASS ===
```

**What this proves behaviorally (against real Postgres, not just unit tests):**

1. A native upload produces **2** `index_records` (the importance-0.1 boilerplate chunk dropped) — version-stamped `source_version=1` from `raw_files.version`, with embeddings (graph-retrievable), `thread_type='doc'`, not AI-involved.
2. The facts **reached the graph**: real embeddings, episode assignment, and live/static state capture (`captured_by='indexer'`) all ran via the unchanged `indexDistilledEvents`; `detectAndInsertLinks` ran (candidate path is type-agnostic) — no edge formed only because the two sentinel sentences fell below the similarity threshold.
3. **Identical re-index produced 0 new facts** (`droppedDuplicate=2`) — the content-hash dedup / append-bug fix works live.
4. The probe **left the prod DB at exact baseline** (all 10 table counts identical; zero `__DOCB0__` residue).

---

## Tests & parity

- **api tsc = 164 (= baseline), web tsc = 0 (= baseline).** No regression.
- New pure unit tests: salience gate (8), doc event builder (7), routing (4), doc-content embedding (+4) — all pass.
- Edit-area regression: `semantic-index/__tests__` + `indexing/__tests__` = **14 files / 124 tests pass**, including the existing `chat-fact-extractor`, `compose-embedding-text`, `analyst-link`, `evidence-capture` suites → the chat path and the modified helpers are unaffected.
- Full api suite: failures are the pre-existing PGlite/WASM DB-integration flake family (unchanged failing-_file_ set); none in this sprint's new/edited files (all pass in isolation). [See RUN-STATUS for the run summary.]

---

## Deferred to B-1 (explicitly NOT in this sprint)

- **Version supersession on _changed_ re-sync.** B-0 only de-dupes _identical_ content. When a document changes and `raw_files.version` increments, this sprint **appends a new generation of facts** (the old version's facts are not marked `superseded`). Closing that — supersede-by-`(source_file_id, source_version)`, keep prior facts as `superseded` for point-in-time — is B-1. The substrate is now ready: `source_version` is populated.
- **Drive (`gws`) → facts** (a separate sprint; its enqueue path is dead code).
- **Section-level distillation** (B-0 is chunk-1:1 by the settled product definition).

---

## Status

Branch `claude/doc-facts-b0`, PR opened. **NOT merged, NOT deployed** (the whole arc merges at the end). No env/Railway
changes. The only prod interaction was the owner-approved Phase 4 probe, fully torn down to baseline.
