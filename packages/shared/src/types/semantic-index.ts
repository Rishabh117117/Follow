// ─── Semantic Index — Version Linking (Sprint IX-8) ──────────────────────────

/**
 * Version-linking metadata attached to every new index_record.
 * Traces an index record back to the specific source content it was built
 * from, so provenance chains can answer "which version of the document did
 * the AI's understanding come from?"
 */
export interface IndexRecordVersionInfo {
  sourceFileId: string
  sourceVersion: number | null
  sourceContentHash: string
  indexedAt: string // ISO timestamp
}

/**
 * A single version reference stamped inside an evidence record, pointing
 * to the specific index record (and therefore source content version)
 * that the evidence was built on top of.
 */
export interface EvidenceVersionRef {
  fileId: string | null
  version: number | null
  contentHash: string | null
}

// ─── GWS Content Snapshots (Sprint IX-9) ────────────────────────────────────

export type GwsDocType = 'document' | 'spreadsheet' | 'presentation'
export type GwsTriggerType = 'periodic' | 'significant_edit' | 'manual' | 'pre_share'

/**
 * A versioned content snapshot of a Google Workspace document, stored in
 * `gws_snapshots`. Follow doesn't own Google documents, so we keep our
 * own point-in-time history with a hash-linked chain for integrity.
 */
export interface GwsSnapshot {
  id: string
  workspaceId: string
  userId: string
  externalDocId: string
  docType: GwsDocType
  version: number
  contentHash: string
  previousHash: string | null
  diffSummary: string | null
  triggerType: GwsTriggerType
  metadata: Record<string, unknown> | null
  createdAt: string
}

/**
 * Result returned from `captureGwsSnapshot`. `isNew: false` means the
 * content hash matched the last snapshot and no new row was inserted.
 */
export interface GwsSnapshotResult {
  id: string
  version: number
  contentHash: string
  isNew: boolean
  diffSummary?: string
}

// ─── Reference Agent (Sprint RA-1) ───────────────────────────────────────────

/**
 * Query intents detected by the reference agent classifier.
 * `simple` means bypass the agent and use the existing fast path.
 */
export type QueryIntent =
  | 'simple'
  | 'temporal'
  | 'cross_version'
  | 'contradiction'
  | 'provenance'
  | 'multi_layer'
  | 'longitudinal'

/**
 * Serializable spec of a single retrieval step (mirrors the backend's
 * `RetrievalStep` type, but `source` is a plain string for shared-type
 * portability — the concrete union lives in the backend planner).
 */
export interface RetrievalStepSpec {
  source: string
  priority: 'required' | 'optional'
  reason: string
}

/**
 * Classification result returned by the reference agent. Consumers
 * (chat UI, provenance viewer) can use this to show why the agent
 * activated and what it hinted at.
 */
export interface AgentClassification {
  intent: QueryIntent
  confidence: number
  reasoning: string
  temporalHint?: string
  versionHint?: number
  topicHint?: string
  entityHint?: string
  bypassed: boolean
}

/**
 * Version citation attached to an assistant message when the reference
 * agent built its context package. Maps each retrieved item back to the
 * specific source file + version + content hash + timestamp it came
 * from, so the provenance viewer (FE-4) can render clickable citations.
 */
export interface VersionCitation {
  sourceFileId?: string | null
  sourceVersion?: number | null
  sourceContentHash?: string | null
  timestamp?: string
  label: string
}

/**
 * Summary of a reference-agent invocation — used by logging and the
 * chat UI's agent-status badge. Mirrors the `summary` field on
 * `AssembledContext`.
 */
export interface AgentContextSummary {
  intent: QueryIntent | string
  sourcesQueried: number
  itemsRetrieved: number
  latencyMs: number
  errors: number
}

// ─── Index Record States (Sprint IX-10) ─────────────────────────────────────

/**
 * Snapshot type — `live` is the current mutable view (newest supersedes
 * older), `static` is a frozen audit snapshot taken when evidence was
 * captured or a slice was shared.
 */
export type IndexRecordStateType = 'live' | 'static'

/**
 * What captured the snapshot. Used in citation labels.
 */
export type StateCapturedBy = 'indexer' | 'reference_agent' | 'manual' | 'share_event'

/**
 * A point-in-time snapshot of an `index_record`. Frozen copies of every
 * field that influences retrieval/citation, plus a sha256 `stateHash` for
 * dedup and a `supersededBy` link forming the live-state chain.
 */
export interface IndexRecordStateSnapshot {
  id: string
  indexRecordId: string
  stateType: IndexRecordStateType
  stateHash: string
  engagementDepth: number | null
  isKeyChange: boolean | null
  hasEvidence: boolean | null
  documentId: string | null
  documentTitle: string | null
  sectionAlias: string | null
  embeddingText: string | null
  sourceFileId: string | null
  sourceVersion: number | null
  sourceContentHash: string | null
  capturedAt: string // ISO
  capturedBy: StateCapturedBy | null
  captureReason: string | null
  supersededBy: string | null
}
