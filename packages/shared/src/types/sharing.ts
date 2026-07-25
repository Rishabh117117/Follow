// ─── Sharing Infrastructure Types (Sprint SH-1) ──────────────────────────────

/**
 * Privacy preset levels. `custom` means "use the user's custom rules only".
 */
export type PrivacyPreset = 'private' | 'balanced' | 'open' | 'custom'

/**
 * Lock policy — when the index automatically locks.
 */
export type LockPolicy = 'on_idle' | 'on_close' | 'manual'

/**
 * Snapshot of a user's index access state. Returned by GET /api/sharing/status.
 */
export interface IndexLockState {
  hasPasscode: boolean
  isLocked: boolean
  lockPolicy: LockPolicy
  activePreset: PrivacyPreset
  sessionExpiresAt: string | null // ISO
}

/**
 * Preset metadata for settings UI.
 */
export interface PrivacyPresetDefinition {
  name: string
  description: string
  ruleCount: number
}

/**
 * Supported custom-rule types. `exclude_time_range` and `allow_only`
 * are reserved — schema-defined in SH-1, behaviour wired in SH-2.
 */
export type PrivacyRuleType =
  | 'redact_pattern'
  | 'exclude_topic'
  | 'exclude_source'
  | 'exclude_time_range'
  | 'allow_only'

/**
 * A single custom privacy rule as returned by the API.
 */
export interface CustomPrivacyRule {
  id: string
  ruleName: string
  ruleType: PrivacyRuleType
  ruleConfig: Record<string, unknown>
  scope: 'all' | 'workspace' | 'document'
  scopeDocumentId?: string | null
  isActive: boolean
  priority: number
}

// ─── Sprint SH-2: Context Requests + Shared Slices ───────────────────────────

/**
 * Lifecycle of a context request.
 */
export type ContextRequestStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'revoked'

/**
 * Scope of a context request / shared slice.
 *   - 'document' → a specific file or external doc (`scopeRefId` = doc id)
 *   - 'topic'    → a topic / keyword (`scopeRefId` optional)
 *   - 'temporal' → a time window (`scopeRefId` = "ISO_start..ISO_end")
 */
export type ScopeType = 'document' | 'topic' | 'temporal'

/**
 * Urgency of a context request — used for sorting / notification weight.
 */
export type Urgency = 'low' | 'normal' | 'high'

/**
 * A request from one user (requester) to another (responder) for context
 * from the responder's index.
 */
export interface ContextRequest {
  id: string
  requesterId: string
  responderId: string
  workspaceId: string
  scopeType: ScopeType
  scopeRefId?: string | null
  query: string
  status: ContextRequestStatus
  urgency: Urgency
  reason?: string | null
  expiresAt?: string | null // ISO
  createdAt: string // ISO
  respondedAt?: string | null // ISO
}

/**
 * A version-cited content package shared from one user to another.
 * Immutable once created — revocation is via `revokedAt`.
 */
export interface SharedSlice {
  id: string
  requestId?: string | null
  fromUserId: string
  toUserId: string
  workspaceId: string
  sliceContent: string
  sliceMetadata: {
    sources: Array<{
      sourceFileId?: string | null
      sourceVersion?: number | null
      sourceContentHash?: string | null
      timestamp?: string
      label: string
    }>
    redactionCount: number
    excludedCount: number
    itemCount: number
    queryScope: {
      type: ScopeType
      refId?: string
      query: string
    }
  }
  scopeType: ScopeType
  scopeRefId?: string | null
  presetUsed: string
  rulesApplied: number
  redactionCount: number
  createdAt: string // ISO
  expiresAt?: string | null // ISO
  revokedAt?: string | null // ISO
  revokedReason?: string | null
  lastSyncedAt: string // ISO
  syncVersion: number
  /** Sprint SH-3: sync channel state (default 'shared' on creation) */
  syncStatus: SliceSyncStatus
}

// ─── Sprint SH-3: Live Sync Protocol ─────────────────────────────────────────

/**
 * Sync channel state of a shared slice.
 *   'shared' — static snapshot (default, matches SH-2 behaviour)
 *   'live'   — auto-sync active; updates push through privacy filters
 *   'paused' — temporarily suspended (schema-defined, behaviour TBD)
 */
export type SliceSyncStatus = 'shared' | 'live' | 'paused'

/**
 * Event type in the slice sync audit trail.
 */
export type SliceSyncEventType =
  | 'upgrade_to_live'
  | 'downgrade_to_shared'
  | 'pause'
  | 'resume'
  | 'content_sync'
  | 'sync_failed'
  | 'scope_unchanged'

/**
 * Who triggered a sync event.
 */
export type SliceSyncTriggeredBy = 'indexer' | 'user_from' | 'user_to' | 'scheduler'

/**
 * One row from the `slice_sync_events` audit table.
 */
export interface SliceSyncEvent {
  id: string
  sliceId: string
  eventType: SliceSyncEventType
  triggeredBy: SliceSyncTriggeredBy
  previousVersion?: number | null
  newVersion?: number | null
  itemsChanged?: number | null
  redactionCount?: number | null
  indexStateLive?: boolean | null
  createdAt: string // ISO
}
