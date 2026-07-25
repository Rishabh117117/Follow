/**
 * Anchor substrate contract (ANCHOR-1 · 2026-06-02)
 *
 * An Anchor is a hook into a source artifact carrying a *versioned meaning*
 * description — the embeddable semantic handle. It is the additive successor
 * to a bare `index_records` row: same provenance, but with an explicit span,
 * a revisable meaning gloss, contributor flavors, and facet-embedding refs.
 *
 * This is contract-only (Zod). Legacy `index_records` are untouched; when the
 * `node-anchors` flag is off nothing writes anchors.
 */

import { z } from 'zod'

// ─── Artifact ────────────────────────────────────────────────────────────────

export const ArtifactTypeSchema = z.enum(['chat', 'doc', 'pdf', 'image', 'note'])
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>

export const AnchorArtifactSchema = z.object({
  id: z.string(),
  type: ArtifactTypeSchema,
  /** monotonic source version (file version, snapshot version, …) */
  version: z.number().int().nonnegative().optional(),
})
export type AnchorArtifact = z.infer<typeof AnchorArtifactSchema>

// ─── Span (typed by artifact.type) ───────────────────────────────────────────

export const TextRangeSchema = z.object({
  kind: z.literal('text_range'),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  sectionAlias: z.string().optional(),
})
export const PdfBoxSchema = z.object({
  kind: z.literal('pdf_box'),
  page: z.number().int().nonnegative(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})
export const ImageRegionSchema = z.object({
  kind: z.literal('image_region'),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
})
export const MessageRefSchema = z.object({
  kind: z.literal('message_ref'),
  messageId: z.string(),
  threadId: z.string().optional(),
})

export const AnchorSpanSchema = z.discriminatedUnion('kind', [
  TextRangeSchema,
  PdfBoxSchema,
  ImageRegionSchema,
  MessageRefSchema,
])
export type AnchorSpan = z.infer<typeof AnchorSpanSchema>

// ─── Meaning (the versioned, embeddable semantic handle) ─────────────────────

export const AnchorMeaningSchema = z.object({
  text: z.string().min(1),
  version: z.number().int().positive(),
  addedBy: z.string(),
  addedAt: z.string(), // ISO timestamp
})
export type AnchorMeaning = z.infer<typeof AnchorMeaningSchema>

// ─── Flavors (per-contributor typed annotations) ─────────────────────────────

export const AnchorFlavorSchema = z.object({
  contributor: z.string(),
  type: z.string(),
  properties: z.record(z.string(), z.unknown()).default({}),
  confidence: z.number().min(0).max(1),
  addedBy: z.string(),
  addedAt: z.string(),
})
export type AnchorFlavor = z.infer<typeof AnchorFlavorSchema>

// ─── Facet embedding ref ─────────────────────────────────────────────────────

export const FacetEmbeddingRefSchema = z.object({
  /** the legacy index_records row whose facet vectors back this anchor (v1) */
  recordId: z.string().optional(),
  content: z.array(z.number()).optional(),
  causal: z.array(z.number()).optional(),
  context: z.array(z.number()).optional(),
})
export type FacetEmbeddingRef = z.infer<typeof FacetEmbeddingRefSchema>

// ─── Anchor ──────────────────────────────────────────────────────────────────

export const AnchorSchema = z.object({
  id: z.string(),
  artifact: AnchorArtifactSchema,
  span: AnchorSpanSchema,
  /** the embeddable semantic handle */
  meaning: AnchorMeaningSchema,
  /** auditable revision history of the meaning gloss (newest last) */
  meaningHistory: z.array(AnchorMeaningSchema).default([]),
  weight: z.number(),
  flavors: z.array(AnchorFlavorSchema).default([]),
  embeddingRef: FacetEmbeddingRefSchema.optional(),
})
export type Anchor = z.infer<typeof AnchorSchema>

// ─── Edge (anchor → anchor) ──────────────────────────────────────────────────

export const AnchorEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.string(),
  weight: z.number(),
  contributor: z.string(),
  rationale: z.string().optional(),
})
export type AnchorEdge = z.infer<typeof AnchorEdgeSchema>
