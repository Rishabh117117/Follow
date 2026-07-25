# ANCHOR-1 — anchor substrate + versioned meaning (2026-06-02)

Part of `master-run/2026-06-02`. Additive, gated, **non-destructive** — legacy `index_records` is untouched; nothing writes anchors unless the `node-anchors` flag is on.

## Phase 1 — contract (`packages/shared`)

`schemas/anchor.schema.ts` (Zod, exported from `@workspace/shared/schemas`):

- **`Anchor`**: `id`, `artifact {id, type: chat|doc|pdf|image|note, version?}`, `span` (discriminated union: `text_range | pdf_box | image_region | message_ref`), **`meaning {text, version, addedBy, addedAt}`** (the versioned embeddable handle) + `meaningHistory[]` (auditable revisions), `weight`, `flavors[] {contributor, type, properties, confidence, addedBy, addedAt}`, `embeddingRef {recordId?, content?, causal?, context?}`.
- **`AnchorEdge`**: `from`, `to`, `kind`, `weight`, `contributor`, `rationale?`.

## Phase 2 — migration (`packages/api`)

- `db/schema/anchors.ts`: Drizzle `anchors` + `anchor_edges` tables. `meaning_text` + `meaning_version` + `meaning_history` (jsonb audit array), `span` jsonb (typed by `artifact_type`), `flavors` jsonb, `weight` real, facet vectors as `REAL[]` (matching `index_records`), `index_record_id` back-ref.
- `db/index.ts`: idempotent `CREATE TABLE IF NOT EXISTS anchors / anchor_edges` (+ indexes). **No `ALTER TABLE index_records`.**

## Phase 3 — write path

- `node-anchors` vault flag registered (default **off**).
- `services/pipeline/anchor-writer.ts`: pure `buildAnchor()` (constructs + Zod-validates a v1 anchor: meaning gloss v1, span, weight, facet refs), pure `mapArtifactType()` / `spanForArtifact()`, and gated `writeAnchorsForRecords(db, inputs)` (db injected for testability).
- `indexer.ts`: after the `index_records` insert, when `node-anchors` is on, builds one anchor per inserted record (meaning gloss = embedding text, span from artifact type, facet embeddings from the node's content/causal/context) and writes them. **Flag off ⇒ the whole block is skipped ⇒ pipeline byte-identical.** Legacy records remain readable as low-weight retro-anchors (weight default 0.5).

## Tests / gates

- `anchor-writer.test.ts` (6, no DB): `buildAnchor` yields a valid anchor with non-empty `meaning.text` (v1) + a valid span; flag **off** ⇒ writer is a no-op (db untouched); flag **on** ⇒ inserts a row with non-empty meaning + valid span. Mocks the vault flag + stubs the db.
- shared TS **0**; api TS **164 → 164** (no new errors); web TS 0.
- api tests: **869 → 875 passing** (+6), 16 failing unchanged (env), 125 skipped. No regression.

Per-file commits prefixed `ANCHOR-1:`.
