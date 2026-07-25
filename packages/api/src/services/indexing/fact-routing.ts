/**
 * DOC-FACTS-B0: which fact extractor (if any) a fully-indexed raw_file routes to.
 *
 *   - chat_artifact            → chat facts (chat-fact-extractor)
 *   - upload | local (native)  → doc facts  (doc-fact-extractor)
 *   - anything else            → no facts
 *
 * 'gws' (Google Drive) is intentionally NOT routed here — Drive ingestion is a
 * separate, later sprint (its enqueue path is currently dead code).
 */
export type FactRoute = 'chat' | 'doc' | null

export function routeFactExtraction(sourceType: string | null | undefined): FactRoute {
  if (sourceType === 'chat_artifact') return 'chat'
  if (sourceType === 'upload' || sourceType === 'local') return 'doc'
  return null
}
