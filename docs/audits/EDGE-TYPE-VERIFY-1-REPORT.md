# EDGE-TYPE-VERIFY-1 — Knowledge-Graph Edge-Type Audit

**Date:** 2026-04-22
**Auditor:** Claude Code
**Sprint:** EDGE-TYPE-VERIFY-1 (diagnostic, read-only)
**Status:** Complete — Phase 4 rows `PARTIAL` because the live `knowledge_edges` table is empty (0 rows); verdict rests on code + schema + prompt evidence, which is conclusive.
**Repo commit SHA:** `1279ca18cfbcc91d8e070f3a037fd01c1171523c`
**DB container used:** `workspace_postgres` (pgvector/pgvector:pg16)
**DB name queried:** `workspace_platform`

---

## 0. Executive summary

- **Verdict:** **BROKEN.**
- **Evidence in one line:** The one live writer hardcodes `relationship: 'references'` at [indexing-agent.ts:604](packages/api/src/services/indexing/indexing-agent.ts), discarding the LLM's classified type into a JSONB metadata field that no reader queries. The live DB is empty (0 rows), consistent with "no scans have run yet" or "scans ran but only produced `references`" — either way, no downstream reader has ever received a non-`references` edge from the production path.
- **Pipeline cut calculus:** **Safe to cut outright — no signal is being produced.** The relationship-scan subsystem is a latent bug, not a value stream. Do not preserve it behind a flag in its current state. Either delete in `CORE-STRIP-2`, or fix the writer first if the feature is still wanted.
- **v5.0 PDF accuracy:** **Mismatch — 3 of 5 edge types in the PDF do not exist in the enum.** The PDF claims `supports, contradicts, elaborates, supersedes, references`. The actual DB enum is a different 9-value set (`created, edited, reviewed, decided, collaborates_with, belongs_to, references, depends_on, supersedes`). Only `references` and `supersedes` overlap.

---

## 1. Writers of knowledge_edges

Two insert sites exist; only one is reachable in production.

| #   | File:line                                                                                         | edge_type written                                                                            | Trigger                                                                                                                      | Production?                              |
| --- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| 1   | [`services/indexing/indexing-agent.ts:604`](packages/api/src/services/indexing/indexing-agent.ts) | **Literal `'references'`** (variable `rel.type` is diverted to `metadata.crossRefType` only) | `index_queue` job of type `relationship_scan`, debounced 10 min per project, invoked indirectly after a full index completes | **YES — the single live writer**         |
| 2   | [`scripts/seed-procedural.ts:148`](packages/api/src/scripts/seed-procedural.ts)                   | Mixed: `references`, `supersedes`, `decided`, `reviewed`, `depends_on` (5 literals)          | Manual `npm run seed:procedural`                                                                                             | No — seed-only, never invoked at runtime |

The two inserts found by `rg '\.insert\(knowledgeEdges\)'` cover all writers. No other code path inserts into this table (confirmed by file-level grep across `packages/api/src/**/*.ts`).

---

## 2. Suspected hardcode site — verified

**Confirmed: hardcode, not a variable.** Exact lines, reproduced verbatim from [`indexing-agent.ts:598–620`](packages/api/src/services/indexing/indexing-agent.ts):

```typescript
const relationships = JSON.parse(jsonMatch[0]) as Array<{
  sourceDocId: string
  targetDocId: string
  type: string
  description: string
}>

for (const rel of relationships) {
  await db.insert(knowledgeEdges).values({
    workspaceId: job.workspaceId,
    sourceType: 'file',
    sourceId: rel.sourceDocId,
    relationship: 'references', // ← hardcoded literal string
    targetType: 'file',
    targetId: rel.targetDocId,
    weight: 0.8,
    metadata: {
      crossRefType: rel.type, // ← LLM's actual classification lives here
      description: rel.description,
      autoDetected: true,
      indexingAgent: true,
    },
  })
}
```

Classification: **hardcode** on the schema-level `relationship` column. The LLM's `rel.type` (values per the prompt: `references | contradicts | depends_on | shared_concept`) is shunted into `metadata.crossRefType` (JSONB).

**A second, related bug is visible here too**: the schema has a dedicated `cross_ref_type` column (see §3) — a proper text column with a comment listing intended values — but the writer puts its value into a JSONB `metadata.crossRefType` key instead. `cross_ref_type` is always NULL. Any reader that reasonably queries `cross_ref_type` to get the LLM's classification will get nothing.

---

## 3. Schema & allowed values

From [`db/schema/collaboration.ts:15–43`](packages/api/src/db/schema/collaboration.ts):

```typescript
export const knowledgeRelationshipEnum = pgEnum('knowledge_relationship', [
  'created',
  'edited',
  'reviewed',
  'decided',
  'collaborates_with',
  'belongs_to',
  'references',
  'depends_on',
  'supersedes',
])

export const knowledgeEdges = pgTable('knowledge_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  sourceType: knowledgeEntityTypeEnum('source_type').notNull(),
  sourceId: uuid('source_id').notNull(),
  relationship: knowledgeRelationshipEnum('relationship').notNull(),
  targetType: knowledgeEntityTypeEnum('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  weight: real('weight').notNull().default(0.5),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  // Cross-thread reference columns (Sprint T1)
  sourceThreadEventId: uuid('source_thread_event_id'),
  targetThreadEventId: uuid('target_thread_event_id'),
  crossRefType: text('cross_ref_type'), // led_to | influenced_by | applied_to | related_to | triggered_by
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
```

**Constraints enforcing which values are allowed:**

- `relationship` is a Postgres enum (`knowledge_relationship`). Anything outside the 9 values listed will be rejected by the DB.
- No additional CHECK constraints (confirmed via `pg_constraint` query in §4).
- `cross_ref_type` is free-text (`text` column), intended — per the inline code comment — to hold one of `led_to | influenced_by | applied_to | related_to | triggered_by`. This is **a different vocabulary** than the LLM prompt asks for (see §5).

**Comparison against v5.0 PDF's 5 claimed types:**

| v5.0 PDF type | In enum?      |
| ------------- | ------------- |
| `supports`    | ✗ NOT in enum |
| `contradicts` | ✗ NOT in enum |
| `elaborates`  | ✗ NOT in enum |
| `supersedes`  | ✓ in enum     |
| `references`  | ✓ in enum     |

The schema allows 7 types the PDF does not mention (`created, edited, reviewed, decided, collaborates_with, belongs_to, depends_on`) and is missing 3 that the PDF claims (`supports, contradicts, elaborates`). If a migration ever tries to insert `'contradicts'` into `relationship` to match the PDF, it will fail.

---

## 4. Live DB state

**Status: PARTIAL — 0 rows in the table.** The live writer has never produced data in this environment. Consistent with either (a) the relationship-scan job has never been enqueued, or (b) it runs but fails silently (the writer catches all errors, see [indexing-agent.ts:642](packages/api/src/services/indexing/indexing-agent.ts): `} catch (error) { if (error instanceof CancelledError) throw error; console.warn(...) }`).

### 4.1 Total + counts-by-type

```
total_edges: 0
(no rows to aggregate)
```

### 4.2 Distinct values ever seen

```
(0 rows)
```

### 4.3 Postgres enum values (from `pg_enum`)

```
created
edited
reviewed
decided
collaborates_with
belongs_to
references
depends_on
supersedes
```

Matches the Drizzle definition exactly. Migration `0000_smooth_black_bolt.sql` is the source of truth; no later migration alters the enum.

### 4.4 CHECK constraints on `knowledge_edges`

```
conname              | pg_get_constraintdef
knowledge_edges_pkey | PRIMARY KEY (id)
```

Only the primary key. No `CHECK` constraint.

### 4.5 Column metadata

```
column_name            | data_type                | udt_name
id                     | uuid                     | uuid
workspace_id           | uuid                     | uuid
source_type            | USER-DEFINED             | knowledge_entity_type
source_id              | uuid                     | uuid
relationship           | USER-DEFINED             | knowledge_relationship
target_type            | USER-DEFINED             | knowledge_entity_type
target_id              | uuid                     | uuid
weight                 | real                     | float4
metadata               | jsonb                    | jsonb
source_thread_event_id | uuid                     | uuid
target_thread_event_id | uuid                     | uuid
cross_ref_type         | text                     | text
created_at             | timestamp with time zone | timestamptz
updated_at             | timestamp with time zone | timestamptz
```

The dedicated `cross_ref_type` text column exists but is always unpopulated (because the writer stores its LLM classification in `metadata.crossRefType` JSONB instead).

---

## 5. Classifier prompt

From [`indexing-agent.ts:573–587`](packages/api/src/services/indexing/indexing-agent.ts), LLM call uses `THREAD_WEAVING` tier:

```typescript
const response = await loggedChat(
  client,
  job,
  'THREAD_WEAVING',
  {
    model: MODEL_TIERS.THREAD_WEAVING,
    messages: [
      {
        role: 'system',
        content: `You detect relationships between documents in a project. Return JSON array of relationships.
Each relationship: { "sourceDocId": "...", "targetDocId": "...", "type": "references|contradicts|depends_on|shared_concept", "description": "..." }
Only include relationships with confidence >= 0.7. Return [] if none found.`,
      },
      {
        role: 'user',
        content: `Find cross-document relationships:\n\n${docSections}`,
      },
    ],
    temperature: 0.2,
    max_tokens: 2000,
  },
  ...
)
```

**Vocabulary the prompt asks the LLM to emit:** `references | contradicts | depends_on | shared_concept` — 4 values.

**Cross-check against the three other vocabularies:**

| Value            | In prompt? | In enum? | In PDF's 5? | In code comment on `cross_ref_type`? |
| ---------------- | :--------: | :------: | :---------: | :----------------------------------: |
| `references`     |     ✓      |    ✓     |      ✓      |                  —                   |
| `contradicts`    |     ✓      |    ✗     |      ✓      |                  —                   |
| `depends_on`     |     ✓      |    ✓     |      —      |                  —                   |
| `shared_concept` |     ✓      |    ✗     |      —      |                  —                   |
| `supports`       |     —      |    ✗     |      ✓      |                  —                   |
| `elaborates`     |     —      |    ✗     |      ✓      |                  —                   |
| `supersedes`     |     —      |    ✓     |      ✓      |                  —                   |
| `led_to`         |     —      |    ✗     |      —      |                  ✓                   |
| `influenced_by`  |     —      |    ✗     |      —      |                  ✓                   |
| `applied_to`     |     —      |    ✗     |      —      |                  ✓                   |
| `related_to`     |     —      |    ✗     |      —      |                  ✓                   |
| `triggered_by`   |     —      |    ✗     |      —      |                  ✓                   |

**Four different vocabularies, each inconsistent with the others.** The prompt asks the LLM for values 2 of which (`contradicts`, `shared_concept`) would fail the enum constraint if they were ever routed to the `relationship` column — which they aren't, because of the hardcode. The `cross_ref_type` column's intended vocabulary (comment on line 40) is a fifth, entirely distinct set that no code ever writes.

---

## 6. Verdict & recommendation

**Verdict: BROKEN.** Per the decision tree: Phase 2 shows a hardcode, Phase 4 is empty (0 rows), so the stricter "hardcode + only-references DB" path collapses to "hardcode + never-populated DB" — which is logically at least as bad. The pipeline as it stands cannot produce a mix of edge types under any circumstances; the LLM's classification is silently dropped into a JSONB key (`metadata.crossRefType`) that, per the AUDIT-CORE-1 reader enumeration, no reader meaningfully queries.

Additional findings that reinforce the verdict:

- The writer and the schema disagree about vocabulary (prompt asks for 4 values, enum allows 9, only 2 overlap).
- The writer does not populate the dedicated `cross_ref_type` column that was added for exactly this purpose (Sprint T1 per code comment).
- The live DB shows 0 rows, meaning no downstream consumer has ever relied on real data from this path.

**Recommendation for next sprint:**

> **Proceed to `CORE-STRIP-2` and cut the relationship-scan branch outright.** Do not preserve it behind a flag. The pipeline produces no usable signal today, and the §9 matrix in AUDIT-CORE-1 already confirmed no MCP tool hard-depends on `knowledge_edges`.

If there is still appetite for cross-document relationship detection in the core product, schedule a separate `RELATIONSHIP-SCAN-REBUILD-1` sprint that:
(a) Aligns the LLM prompt, the enum, and the v5.0 PDF on one vocabulary.
(b) Writes the LLM-classified type into the `relationship` column (not just `metadata`).
(c) Either drops the orphaned `cross_ref_type` column or wires it properly.
(d) Adds at least one reader that actually pivots on `edge_type` to produce value.

Until then, cutting is the correct move.

---

## 7. v5.0 PDF correction list

Deltas between the PDF's claimed 5 edge types (`supports, contradicts, elaborates, supersedes, references`) and the code:

1. **`supports`** — not in the DB enum, not in any prompt, not in any code comment. Pure aspiration. If the product still wants this type, a migration is required to add it.
2. **`contradicts`** — not in the enum; the prompt does ask for it, but the writer never stores it anywhere addressable. The reality is closer to "the LLM may emit `contradicts` inside a JSONB blob that nothing reads."
3. **`elaborates`** — not in the enum, not in any prompt. Pure aspiration.
4. **`supersedes`** — correct: in the enum, written by the seed script. No production writer produces it today though.
5. **`references`** — correct: in the enum, and the only value the production writer ever produces.

Additional PDF omission worth noting: the enum contains 4 types the PDF likely should acknowledge (`depends_on` is the most product-relevant; `created, edited, reviewed, decided, collaborates_with, belongs_to` are collab/audit semantics that probably belong in a different table entirely).

---

## 8. Incidental findings

- [indexing-agent.ts:606–616](packages/api/src/services/indexing/indexing-agent.ts) — Writer populates `metadata.crossRefType` (JSONB), not the dedicated `cross_ref_type` column on the same table. Separate bug from the `relationship` hardcode.
- [db/schema/collaboration.ts:40](packages/api/src/db/schema/collaboration.ts) — Comment on `cross_ref_type` lists a vocabulary (`led_to | influenced_by | applied_to | related_to | triggered_by`) that no code uses and no prompt asks for. Dead documentation.
- [`indexing-agent.ts:642`](packages/api/src/services/indexing/indexing-agent.ts) — The catch-block logs at `console.warn` and returns; scan failures are effectively invisible in production monitoring. If the scan has ever run and failed, no one has been alerted.
- `seed-procedural.ts` uses 5 enum values (`references, supersedes, decided, reviewed, depends_on`) that include collaboration-audit semantics (`decided, reviewed`) mixed with content-graph semantics (`references, supersedes, depends_on`). The seed doesn't distinguish — any procedural-reader aggregation treats all 5 as equivalent "patterns." Possible minor bug in procedural-reader cluster labeling; out of scope here.
- `pg_enum.enumsortorder` matches the Drizzle array order, so `CREATE TYPE ... AS ENUM` was generated cleanly by drizzle-kit; no enum-drift risk between code and DB.
- `knowledge_edges.weight` is hardcoded to `0.8` at the writer regardless of the LLM's `confidence` (the prompt asks for "confidence >= 0.7", but confidence is filtered, not stored). Minor — out of scope.

---

## 9. Open questions for human review

1. **Is the relationship scan still wanted in the core product?** If yes, a proper rebuild sprint (as outlined in §6) is needed. If no, `CORE-STRIP-2` can drop the `relationship_scan` job type, the `handleRelationshipScan` function, the LLM call, and ideally the table itself in a subsequent cleanup.
2. **Which vocabulary is canonical?** The v5.0 PDF, the enum, the prompt, and the code comment on `cross_ref_type` disagree. A product call is needed before any fix.
3. **Should `knowledge_edges` stay as a dual-purpose table (collab audit + content graph) or be split?** The enum mixes these concerns (`created, edited, reviewed, decided, collaborates_with, belongs_to` are audit; `references, depends_on, supersedes` are content). The seed script and `procedural/reader.ts` conflate them. Worth resolving before any rebuild.
4. **Has `handleRelationshipScan` ever run in prod?** The dev DB has 0 rows. Worth checking staging / production before trusting the "never produced signal" claim. If production has rows, their `edge_type` will still all be `references` because of the hardcode, but their existence would tell us the job scheduler is reaching the code path.

---

## Appendix — Raw query output

```
$ docker exec -i workspace_postgres psql -U postgres -d workspace_platform -c "SELECT COUNT(*) AS total_edges FROM knowledge_edges;"
 total_edges
-------------
           0
(1 row)

$ docker exec -i workspace_postgres psql -U postgres -d workspace_platform -c \
  "SELECT relationship AS edge_type, COUNT(*) AS n, MIN(created_at) AS earliest, MAX(created_at) AS latest \
   FROM knowledge_edges GROUP BY relationship ORDER BY n DESC;"
 edge_type | n | earliest | latest
-----------+---+----------+--------
(0 rows)

$ docker exec -i workspace_postgres psql -U postgres -d workspace_platform -c \
  "SELECT DISTINCT relationship FROM knowledge_edges ORDER BY relationship;"
 relationship
--------------
(0 rows)

$ docker exec -i workspace_postgres psql -U postgres -d workspace_platform -c \
  "SELECT enumlabel FROM pg_enum WHERE enumtypid = 'knowledge_relationship'::regtype ORDER BY enumsortorder;"
     enumlabel
-------------------
 created
 edited
 reviewed
 decided
 collaborates_with
 belongs_to
 references
 depends_on
 supersedes
(9 rows)

$ docker exec -i workspace_postgres psql -U postgres -d workspace_platform -c \
  "SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON c.conrelid = t.oid WHERE t.relname = 'knowledge_edges';"
       conname        | pg_get_constraintdef
----------------------+----------------------
 knowledge_edges_pkey | PRIMARY KEY (id)
(1 row)

$ docker exec -i workspace_postgres psql -U postgres -d workspace_platform -c \
  "SELECT column_name, data_type, udt_name FROM information_schema.columns WHERE table_name = 'knowledge_edges' ORDER BY ordinal_position;"
      column_name       |        data_type         |        udt_name
------------------------+--------------------------+------------------------
 id                     | uuid                     | uuid
 workspace_id           | uuid                     | uuid
 source_type            | USER-DEFINED             | knowledge_entity_type
 source_id              | uuid                     | uuid
 relationship           | USER-DEFINED             | knowledge_relationship
 target_type            | USER-DEFINED             | knowledge_entity_type
 target_id              | uuid                     | uuid
 weight                 | real                     | float4
 metadata               | jsonb                    | jsonb
 source_thread_event_id | uuid                     | uuid
 target_thread_event_id | uuid                     | uuid
 cross_ref_type         | text                     | text
 created_at             | timestamp with time zone | timestamptz
 updated_at             | timestamp with time zone | timestamptz
(14 rows)
```
