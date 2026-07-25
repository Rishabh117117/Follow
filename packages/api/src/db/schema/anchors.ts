/**
 * Anchor substrate schema (ANCHOR-1 · 2026-06-02)
 *
 * Additive tables that carry hooks into source artifacts with a *versioned
 * meaning* description. Legacy `index_records` is untouched — anchors are
 * written only when the `node-anchors` vault flag is on, and legacy records
 * remain readable as low-weight retro-anchors.
 *
 * The Zod contract lives in `@workspace/shared/schemas` (anchor.schema.ts);
 * these tables persist it. Facet vectors are `REAL[]` to match the existing
 * `index_records` facet columns (cosine is computed in JS, not SQL).
 */

import { pgTable, uuid, text, timestamp, real, jsonb, integer, index } from 'drizzle-orm/pg-core'
import type { AnchorSpan, AnchorMeaning, AnchorFlavor } from '@workspace/shared/schemas'

export const anchors = pgTable(
  'anchors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    // ── artifact the anchor hooks into ──
    artifactId: text('artifact_id'),
    artifactType: text('artifact_type').notNull(), // chat | doc | pdf | image | note
    artifactVersion: integer('artifact_version'),
    // ── span (typed by artifact_type) ──
    span: jsonb('span').$type<AnchorSpan>().notNull(),
    // ── versioned meaning (the embeddable handle) + audit history ──
    meaningText: text('meaning_text').notNull(),
    meaningVersion: integer('meaning_version').notNull().default(1),
    meaningAddedBy: text('meaning_added_by'),
    meaningAddedAt: timestamp('meaning_added_at', { withTimezone: true }).notNull().defaultNow(),
    meaningHistory: jsonb('meaning_history').$type<AnchorMeaning[]>().notNull().default([]),
    // ── weight + flavors ──
    weight: real('weight').notNull().default(0.5),
    flavors: jsonb('flavors').$type<AnchorFlavor[]>().notNull().default([]),
    // ── facet embeddings (the meaning, across the three facets) ──
    embeddingContent: real('embedding_content').array(),
    embeddingCausal: real('embedding_causal').array(),
    embeddingContext: real('embedding_context').array(),
    // ── back-ref to the legacy index_records row this anchor shadows ──
    indexRecordId: uuid('index_record_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index('anchors_workspace_idx').on(table.workspaceId),
    artifactIdx: index('anchors_artifact_idx').on(table.artifactId),
    indexRecordIdx: index('anchors_index_record_idx').on(table.indexRecordId),
  })
)

export const anchorEdges = pgTable(
  'anchor_edges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id').notNull(),
    fromAnchorId: uuid('from_anchor_id').notNull(),
    toAnchorId: uuid('to_anchor_id').notNull(),
    kind: text('kind').notNull(),
    weight: real('weight').notNull().default(0.5),
    contributor: text('contributor'),
    rationale: text('rationale'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workspaceIdx: index('anchor_edges_workspace_idx').on(table.workspaceId),
    fromIdx: index('anchor_edges_from_idx').on(table.fromAnchorId),
    toIdx: index('anchor_edges_to_idx').on(table.toAnchorId),
  })
)
