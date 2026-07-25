/**
 * VERSION-B1 — the lifecycle filter every CURRENT-fact retrieval path applies, so
 * answers never surface superseded (older document versions retired on re-sync),
 * tombstoned, or user-hidden facts. Single source of truth shared by the
 * reference-agent retriever and the structured query runner (both previously
 * unfiltered); query-executor applies the same superseded predicate alongside its
 * own conditional-hidden logic.
 *
 * CRITICAL SAFETY INVARIANT: filter on `superseded_at` ONLY — NEVER on
 * `source_version`. Chat facts have a null version and current documents have it
 * set, so excluding by version would silently drop live facts (in a chat-only
 * workspace, the entire index). The unit test asserts this invariant by rendering
 * these conditions to SQL.
 */
import { eq, isNull, type SQL } from 'drizzle-orm'
import { indexRecords } from '../../db/schema/semantic-index'

export function currentFactConditions(): SQL[] {
  return [
    isNull(indexRecords.supersededAt),
    isNull(indexRecords.deletedAt),
    eq(indexRecords.hidden, false),
  ]
}
