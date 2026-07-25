# SCOPE-A-1 — Cross-author contradiction, end to end

**Type:** EXECUTION sprint (real code changes). Worktree `wt-scope-a-1` @ branch `claude/scope-a-1` off `origin/main` `e770a56`.
**Outcome:** A query against a shared project containing two authors' conflicting facts now returns, in the context an LLM reads, **both facts each attributed to its author, with the pair marked contested and the disagreement reason shown** — and nothing is silently overwritten. Doc-versioning (Pillar A) cleanly deferred, per scope.
**Phase 4 (live prod write-probe): RAN & PASSED (2026-06-23)** — after the branch was merged to `main` and deployed, a sentinel two-author probe behaviorally confirmed all five verify items against production; teardown returned every table to its exact baseline (see Phase 4 below).
**Status: merged to `main` (PR #18, `61b068f`) and deployed to production** (deploy verified healthy; postgres/redis/s3 ok).

## Parity gates (held at every phase)

- **tsc (api): 164 → 164** (deterministic). No new errors in the edit area at any phase.
- **tests (api): baseline 36 failed / 939 passed (14 files) → 16 failed / 942 passed (14 files)** — _fewer_ failures (the rest is the documented PGlite-vector/WASM flake), **+7** new passing tests, all pre-existing failures unchanged and outside the edit area. Edit-area suites: 48/48 green (41 existing + 7 new).

## Definition of done — met

The reference-agent context block (which `query_index` semantic mode returns verbatim — `mcp/tools/query-index.ts:138-184`) now carries author attribution per fact and a contested block for cross-author contradictions. Verified by 7 unit tests + a live-rendered sample (below).

---

## What changed (file:line)

All changes are in `packages/api/src/services/reference-agent/`. Pre-edit snapshots: `_archive/2026-06-22-scope-a-1/{retriever,assembler,index}.ts.orig`.

### Phase 1 — co-residence (verify only, NO code change)

Confirmed the project `workspaceId` flows end-to-end with no drop, so two authors on the same `activeProjectId` co-reside under one `workspaceId` and ANALYST compares across both:

- `save-conversation.ts:462-465` — `workspaceId = saveTo==='project' && activeProjectId ? activeProjectId : session.workspaceId`.
- `createConversation`/`updateConversationInPlace` pass the resolved id to `triggerIndexing(...)` (`:664`, `:772`).
- `triggerIndexing:822` → `indexThreadEvents(workspaceId)` (`:836`) + `syncConversationWrapper({workspaceId})` (`:858`) → `storeRawFile({workspaceId})` (`:883`) → `queueFileIndex({workspaceId})` (`:892`).
- `indexer.ts` `detectAndInsertLinks` candidate query is `workspaceId`-scoped with **no `userId` filter** (`indexer.ts:771-784`).
  **Acceptance met without an edit.**

### Phase 2 — author attribution in retrieval

- `retriever.ts:47` — `RetrievedItem.recordId?: string | null` (carries `index_records.id` for the Phase 3 join).
- `retriever.ts:55` — `RetrievedItem.citation.author?: string | null`.
- `retriever.ts:342,363` — index_records mapping sets `recordId: r.id` and `metadata.contributorName: r.userName ?? null` (cached fallback).
- `retriever.ts:158` — `attachAuthorNames(items)`: one **batched** `users` lookup (no N+1) resolving `users.name → cached contributorName → users.email → short id`; called once at the end of `executeRetrievalPlan`; best-effort (never throws — falls back to cached name on DB error).
- `assembler.ts:26` — `VersionCitation.author?: string | null`.
- `assembler.ts:205` — each fact rendered ` — by <author>` **inline** (not in the section header, since one section holds multiple authors); `assembler.ts` versionCitations carry `author`.

### Phase 3 — contested surfacing (the `semantic_links → assembler` join)

- `retriever.ts:206` — `findContradictsEdgesAmong(recordIds)`: bounded two-sided `IN` lookup of `link_type='contradicts'` / `deleted_at IS NULL` edges whose **both** endpoints are in the retrieved set; reads `reason`/`confidence` from `metadata.analyst` (top-level `reason` is null for ANALYST edges); returns `[]` on failure.
- `index.ts:22,108,115` — orchestrator collects `recordId`s, calls `findContradictsEdgesAmong`, passes `contradictsEdges` into `assembleContext`.
- `assembler.ts:34,47` — `ContestedEdge` (input) + `ContestedPair` (output) types; `assembler.ts:100` `AssembleOptions.contradictsEdges`; `assembler.ts:66` `AssembledContext.contested: ContestedPair[]` (structured output for a UI; `crossUser` passed through).
- `assembler.ts:158` — resolves edges (both endpoints present) into `ContestedPair[]`; `assembler.ts:207` marks contested facts inline `⚠ CONTESTED`; `assembler.ts:217-227` emits the `[CONTESTED — teammates disagree]` block (both summaries, both authors, confidence, reason, cross/same-author scope). **No auto-resolution** — both sides surfaced.
- **Contradictions read-side already complete** — `services/contradictions/edges.ts` already resolves both authors (`contributor: src.userName`/`tgt.userName`, `:102`/`:108`) and `crossUser` (`:95`, "cross-contributor" at `:123`). **No edit needed.**

### Tests

`reference-agent/__tests__/scope-a-1-author-contested.test.ts` (7 tests, pure assembler — no DB, immune to the pgvector test-env flake): author inline + in versionCitations + no-author fallback; cross-author contested block with both authors/reason; same-author regression; endpoint-not-retrieved → not surfaced; no-edges → no block.

---

## Before / after (live-rendered from the worktree assembler)

**BEFORE (`e770a56`)** — source-type grouping only, no author, no contested:

```
--- Semantic Index ---
[Index record (Jun 22)]
The launch date is March 15.

[Index record (Jun 22)]
The launch date is April 20.
```

**AFTER (this sprint)** — author inline, contested markers, contested block:

```
--- Semantic Index ---
[Index record (Jun 22) — by Alice ⚠ CONTESTED]
The launch date is March 15.

[Index record (Jun 22) — by Bob ⚠ CONTESTED]
The launch date is April 20.

[CONTESTED — teammates disagree]
The following facts directly contradict each other. Present BOTH sides, attribute each to its author, and do NOT silently pick one.
- CONTESTED (cross-author, 80% confidence):
    • Alice: "The launch date is March 15."
    • Bob: "The launch date is April 20."
    Reason: A says March 15, B says April 20 — direct conflict on the launch date.
```

Structured output also carries `contested: [{ crossUser: true, a:{author:'Alice',…}, b:{author:'Bob',…}, reason, confidence }]` and `versionCitations[].author`.

---

## Phase 4 — live prod probe (RAN & PASSED, 2026-06-23)

After merging to `main` and deploying (so the live code = these changes), a sentinel two-author probe ran against **production**. Seeding used the real exported `detectAndInsertLinks` (the actual ANALYST classifier) — two distinct `user_id`s ("Alice"/"Bob") co-residing in one sentinel workspace `__SCOPEA_PROBE__`, every row sentinel-marked. All five verify items passed; teardown ran in a `finally` (keyed on fixed sentinel UUIDs) and an **independent** SQL pass confirmed exact baseline + zero lingering sentinel rows + zero orphan edges.

| #   | Verify                                                                            | Result                                                                                                                                                                                 |
| --- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | both records, one workspace, distinct `user_id`                                   | ✅ Alice + Bob under one `workspace_id`                                                                                                                                                |
| 2   | ANALYST `contradicts` edge, `cross_user=true`, reason in `metadata.analyst`       | ✅ deepseek-v4-pro, cosine 0.717, conf 0.8, `cross_user=true`, reason _"Both claim a specific launch date but give different dates (March 15 vs April 20)."_ (top-level `reason` null) |
| 3   | deployed reference-agent output (the `query_index` path) shows author + contested | ✅ `[… — by Alice (SCOPEA probe) ⚠ CONTESTED]` / `… by Bob …` + the `[CONTESTED — teammates disagree]` block + structured `contested` (`crossUser:true`)                               |
| 4   | `getContradictionEdges` read-side shows both authors                              | ✅ contributor Alice + Bob, `crossUser=true`, confidence 0.8                                                                                                                           |
| 5   | no `superseded_by` set (no silent overwrite)                                      | ✅ both live states `superseded_by=null`                                                                                                                                               |

**Teardown parity (before == after):** `index_records=57, semantic_links=42, index_record_states=180, users=2, workspaces=2, threads=54, thread_events=57, llm_usage=76` — identical pre/post; the probe's ANALYST `llm_usage` row was also removed. Note: the seed wrote its own `'live'` states (mimicking the indexer) so the live 5-min Archivist cron treated the records as already-promoted and did not touch them mid-probe.

⇒ The cross-author differentiator is now **behaviorally confirmed in production**, not merely code-inferred.

---

## Open / needs decision

1. **Project-membership model.** `activeProjectId` is a bare id persisted per-user in `mcp_active_project` (`services/mcp/active-project.ts`); nothing enforces that two real users may legitimately target the same project. Fine for a fixed-id demo; the build needs a projects/membership table for real multi-tenant co-residence.
2. **Author source: live join vs cached name.** Phase 2 prefers a live `users.name` join (handles renames), falling back to the cached `index_records.user_name`. `contradictions/edges.ts` uses the cached `user_name` directly. Decide whether to unify on the live resolver for the contradictions view too (left untouched here per minimal-change).
3. **Name vs email.** Resolver order is name → cached name → email → short id. If a user has no `name` (schema requires it `NOT NULL`, so unlikely), it falls to email then id.
4. **Deployed.** Live in prod via PR #18 (`61b068f`); deploy verified healthy.
5. ~~Phase 4 behavioral confirmation outstanding~~ — **done** (probe passed 2026-06-23; see Phase 4).

---

## Evidence appendix

- Commits (branch `claude/scope-a-1`, off `e770a56`): snapshot `b7ac143`; Phase 2 `bebe7dd` (retriever), `15e7d3b` (assembler), `27cf34b` (test); Phase 3 `e551360` (retriever), `c70b405` (assembler), `ed7531e` (index), `8d951b0` (test).
- tsc parity: 164 at baseline, Phase 2, Phase 3.
- Test parity: baseline 36 failed/939 passed (14 files) → final 16 failed/942 passed (14 files); the 3 deterministic non-edit-area failures (llm-logger 2, nav-intent-classifier 3, memory-sections 4) were failing identically at baseline (pre-existing PGlite-env/mock issues).
- Edit-area suites green: scope-a-1-author-contested (7), boundary-hook (16), contradictions/edges (6), detect-contradictions (5), analyst-link (3), memory-layers (4).
- Ship: pushed `claude/scope-a-1` → PR [#18](https://github.com/Rishabh117117/workspace-platform/pull/18) → merged to `main` (`61b068f`) → Railway auto-deploy verified live (uptime reset, postgres/redis/s3 ok).
- Phase 4 prod probe (2026-06-23): sentinel two-author seed via real `detectAndInsertLinks`; all 5 verify items passed; teardown returned all 8 tracked tables to exact baseline; independent SQL re-check found 0 lingering sentinel rows / 0 orphan edges. Probe script was a throwaway (not committed).
