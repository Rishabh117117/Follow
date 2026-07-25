/**
 * Anchor writer (ANCHOR-1 · 2026-06-02)
 *
 * Builds + persists Anchors alongside the legacy index_records write. Gated by
 * the `node-anchors` vault flag — off ⇒ no-op ⇒ the pipeline is byte-identical.
 *
 * `buildAnchor` and the span/type mappers are pure and deterministic (no db, no
 * clock) so they unit-test without a database. `writeAnchorsForRecords` takes
 * the db as a parameter (dependency injection) so the gated write path is
 * testable with a stub.
 */

import { type db } from '../../db/index'
import { anchors } from '../../db/schema/anchors'
import { isServerFeatureActive } from '../../config/server-vault'
import {
  AnchorSchema,
  type Anchor,
  type AnchorSpan,
  type ArtifactType,
} from '@workspace/shared/schemas'

/** The drizzle db handle — injected into the writer so it stays testable. */
type Db = typeof db

const MEANING_MAX = 280
const DEFAULT_WEIGHT = 0.5

export interface BuildAnchorInput {
  id: string
  workspaceId: string
  indexRecordId: string
  artifact: { id: string; type: ArtifactType; version?: number | null }
  span: AnchorSpan
  /** the v1 meaning gloss — the embeddable semantic handle */
  meaningText: string
  addedBy?: string
  addedAt: string // ISO
  weight?: number
  facets?: {
    content?: number[] | null
    causal?: number[] | null
    context?: number[] | null
  }
}

/** Map a thread/source type to the anchor artifact type. */
export function mapArtifactType(threadOrSourceType: string | null | undefined): ArtifactType {
  switch (threadOrSourceType) {
    case 'doc':
    case 'file':
      return 'doc'
    case 'ai':
    case 'chat':
      return 'chat'
    case 'pdf':
      return 'pdf'
    case 'image':
      return 'image'
    default:
      return 'note'
  }
}

/** Build a v1 span appropriate to the artifact type. */
export function spanForArtifact(
  type: ArtifactType,
  opts: { messageId: string; threadId?: string; textLength?: number; sectionAlias?: string }
): AnchorSpan {
  if (type === 'doc' || type === 'note') {
    return {
      kind: 'text_range',
      start: 0,
      end: Math.max(0, opts.textLength ?? 0),
      ...(opts.sectionAlias ? { sectionAlias: opts.sectionAlias } : {}),
    }
  }
  // chat / pdf / image fall back to a message reference (the event id) for v1 —
  // pixel/page spans are populated by the artifact-specific ingest paths later.
  return {
    kind: 'message_ref',
    messageId: opts.messageId,
    ...(opts.threadId ? { threadId: opts.threadId } : {}),
  }
}

/**
 * Pure: construct + validate a v1 Anchor. The meaning gloss is the embeddable
 * handle; v1 reuses the node's facet embeddings (the gloss derives from the
 * same node text). Throws if the result fails the shared Anchor schema.
 */
export function buildAnchor(input: BuildAnchorInput): Anchor {
  const meaning = {
    text: input.meaningText.trim().slice(0, MEANING_MAX),
    version: 1,
    addedBy: input.addedBy ?? 'reporter',
    addedAt: input.addedAt,
  }
  return AnchorSchema.parse({
    id: input.id,
    artifact: {
      id: input.artifact.id,
      type: input.artifact.type,
      version: input.artifact.version ?? undefined,
    },
    span: input.span,
    meaning,
    meaningHistory: [meaning],
    weight: input.weight ?? DEFAULT_WEIGHT,
    flavors: [],
    embeddingRef: {
      recordId: input.indexRecordId,
      content: input.facets?.content ?? undefined,
      causal: input.facets?.causal ?? undefined,
      context: input.facets?.context ?? undefined,
    },
  })
}

function toRow(a: Anchor, workspaceId: string, indexRecordId: string) {
  return {
    id: a.id,
    workspaceId,
    artifactId: a.artifact.id,
    artifactType: a.artifact.type,
    artifactVersion: a.artifact.version ?? null,
    span: a.span,
    meaningText: a.meaning.text,
    meaningVersion: a.meaning.version,
    meaningAddedBy: a.meaning.addedBy,
    meaningHistory: a.meaningHistory,
    weight: a.weight,
    flavors: a.flavors,
    embeddingContent: a.embeddingRef?.content ?? null,
    embeddingCausal: a.embeddingRef?.causal ?? null,
    embeddingContext: a.embeddingRef?.context ?? null,
    indexRecordId,
  }
}

/**
 * Gated DB write. Returns 0 (no-op) when `node-anchors` is off — flag-off keeps
 * the pipeline byte-identical. `database` is injected so this is testable.
 */
export async function writeAnchorsForRecords(
  database: Db,
  inputs: BuildAnchorInput[]
): Promise<number> {
  if (!isServerFeatureActive('node-anchors')) return 0
  if (inputs.length === 0) return 0
  const rows = inputs.map((i) => toRow(buildAnchor(i), i.workspaceId, i.indexRecordId))
  await database.insert(anchors).values(rows)
  return rows.length
}
