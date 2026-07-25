/**
 * Sharing Infrastructure Schema (Sprint SH-1)
 *
 * Gates outbound sharing behind a passcode and a privacy-filter pipeline.
 *
 * - `index_access`: per-user passcode hash, session token, lock state,
 *   and active privacy preset. Every outbound share or context request
 *   must check that `is_locked = false` and the session token matches.
 *
 * - `privacy_filter_rules`: custom privacy rules (redact/exclude)
 *   layered on top of the active preset. Applied in SH-2 when shared
 *   slices are built; defined here so the schema + service interface
 *   exists before any content starts flowing.
 *
 * No schema relation to `index_records` on purpose — access control is
 * gated in the service layer, not via FKs. This keeps the per-record
 * path fast and the access tables independent of index growth.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
} from 'drizzle-orm/pg-core'

// ─── INDEX ACCESS (passcode + session + lock state) ───────────────────────────

export const indexAccess = pgTable(
  'index_access',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().unique(),
    workspaceId: uuid('workspace_id').notNull(),

    // Passcode — stored as sha256(passcode + salt), never plaintext.
    // Can upgrade to bcrypt/argon2 in production hardening.
    passcodeHash: varchar('passcode_hash', { length: 255 }),
    passcodeSalt: varchar('passcode_salt', { length: 64 }),

    // Session token issued on unlock. Expires after SESSION_DURATION_MS
    // (30 min). Required for index reads and outbound sharing.
    sessionToken: varchar('session_token', { length: 255 }),
    sessionExpiresAt: timestamp('session_expires_at', { withTimezone: true }),

    // Lock state
    isLocked: boolean('is_locked').notNull().default(true),
    lockPolicy: varchar('lock_policy', { length: 32 }).notNull().default('on_idle'),
    // 'on_idle' — lock after 30min inactivity (default)
    // 'on_close' — lock when browser/tab closes
    // 'manual' — only lock when user explicitly locks

    // Active privacy preset
    activePreset: varchar('active_preset', { length: 32 }).notNull().default('balanced'),
    // 'private' | 'balanced' | 'open' | 'custom'

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('idx_index_access_user').on(table.userId),
    workspaceUserIdx: index('idx_index_access_workspace').on(table.workspaceId, table.userId),
  })
)

// ─── PRIVACY FILTER RULES (custom rules layered over the active preset) ──────

export const privacyFilterRules = pgTable(
  'privacy_filter_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),

    ruleName: varchar('rule_name', { length: 128 }).notNull(),
    ruleType: varchar('rule_type', { length: 32 }).notNull(),
    // 'redact_pattern'   — regex/keyword redaction
    // 'exclude_topic'    — exclude entire topic/episode cluster
    // 'exclude_source'   — exclude content from a source type
    // 'exclude_time_range' — exclude content from a time period
    // 'allow_only'       — whitelist mode

    ruleConfig: jsonb('rule_config').$type<Record<string, unknown>>().notNull(),
    // Shape varies by ruleType — see privacy-filter.ts for details.

    scope: varchar('scope', { length: 32 }).notNull().default('all'),
    // 'all' | 'workspace' | 'document'
    scopeDocumentId: uuid('scope_document_id'),

    isActive: boolean('is_active').notNull().default(true),
    priority: integer('priority').notNull().default(0),
    // Higher priority applied later → overrides earlier rules.

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userWorkspaceIdx: index('idx_privacy_rules_user').on(table.userId, table.workspaceId),
  })
)

// ─── CONTEXT REQUESTS (Sprint SH-2) ──────────────────────────────────────────
//
// A request from one user (requester) to another (responder) for context
// from the responder's index. The responder approves (→ slice built) or
// denies. Pending requests can expire automatically.

export const contextRequests = pgTable(
  'context_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id').notNull(),
    responderId: uuid('responder_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),

    // What's being requested
    scopeType: varchar('scope_type', { length: 32 }).notNull(),
    // 'document' | 'topic' | 'temporal'
    scopeRefId: varchar('scope_ref_id', { length: 255 }),
    // 'document'  → documentId / externalDocId
    // 'topic'     → the topic string
    // 'temporal'  → "start..end" ISO date range
    query: text('query').notNull(),

    // Status lifecycle
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    // 'pending' | 'approved' | 'denied' | 'expired' | 'revoked'
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    urgency: varchar('urgency', { length: 16 }).default('normal'),
    // 'low' | 'normal' | 'high'
    reason: text('reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (table) => ({
    responderIdx: index('idx_ctx_req_responder').on(table.responderId, table.status),
    requesterIdx: index('idx_ctx_req_requester').on(table.requesterId, table.status),
    workspaceIdx: index('idx_ctx_req_workspace').on(table.workspaceId),
  })
)

// ─── SHARED SLICES (Sprint SH-2) ─────────────────────────────────────────────
//
// The filtered, version-cited content package delivered to a requester.
// Immutable once created — revocation is via soft-delete (`revokedAt`).
// `requestId` is a plain uuid (not a foreign key) to keep the table
// independent of the request lifecycle and to avoid cross-table FKs that
// complicate `drizzle-kit push`.

export const sharedSlices = pgTable(
  'shared_slices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id'), // FK-style ref to contextRequests.id; null for proactive shares

    fromUserId: uuid('from_user_id').notNull(),
    toUserId: uuid('to_user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),

    // Content (filtered)
    sliceContent: text('slice_content').notNull(),
    sliceMetadata: jsonb('slice_metadata').$type<Record<string, unknown>>().notNull(),
    // Shape:
    //   { sources: [{sourceFileId, sourceVersion, contentHash, timestamp, label}],
    //     redactionCount, excludedCount, itemCount,
    //     queryScope: {type, refId, query} }

    scopeType: varchar('scope_type', { length: 32 }).notNull(),
    scopeRefId: varchar('scope_ref_id', { length: 255 }),

    // Privacy snapshot at the moment the slice was built (frozen even if
    // the responder later changes their preset).
    presetUsed: varchar('preset_used', { length: 32 }).notNull(),
    rulesApplied: integer('rules_applied').notNull().default(0),
    redactionCount: integer('redaction_count').notNull().default(0),

    // Lifecycle
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),

    // For SH-3 live sync
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
    syncVersion: integer('sync_version').notNull().default(1),
    // Sprint SH-3: sync channel state
    //   'shared' — static snapshot, no auto-sync (default, matches SH-2 behaviour)
    //   'live'   — active sync channel, updates push automatically
    //   'paused' — temporarily suspended (either party can pause)
    syncStatus: varchar('sync_status', { length: 16 }).notNull().default('shared'),
  },
  (table) => ({
    fromUserIdx: index('idx_slices_from_user').on(table.fromUserId),
    toUserIdx: index('idx_slices_to_user').on(table.toUserId),
    requestIdx: index('idx_slices_request').on(table.requestId),
    workspaceIdx: index('idx_slices_workspace').on(table.workspaceId),
  })
)

// ─── SLICE SYNC EVENTS (Sprint SH-3 — live sync audit trail) ─────────────────
//
// One row per sync event on a shared_slice. Captures the full lifecycle:
// upgrades/downgrades, content pushes, scheduler no-ops, and failures.
// `sliceId` is a plain uuid (not a FK) to keep tables independent — the
// sync event log outlives even a hard-deleted slice for audit purposes.

export const sliceSyncEvents = pgTable(
  'slice_sync_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sliceId: uuid('slice_id').notNull(),

    // What happened
    eventType: varchar('event_type', { length: 32 }).notNull(),
    // 'upgrade_to_live' | 'downgrade_to_shared' | 'pause' | 'resume'
    // 'content_sync'    | 'sync_failed'         | 'scope_unchanged'

    // Who triggered it
    triggeredBy: varchar('triggered_by', { length: 32 }).notNull(),
    // 'indexer' | 'user_from' | 'user_to' | 'scheduler'

    // Sync details (populated for content_sync events; null otherwise)
    previousVersion: integer('previous_version'),
    newVersion: integer('new_version'),
    itemsChanged: integer('items_changed'),
    redactionCount: integer('redaction_count'),

    // IX-10 integration — was the sharer's index in a 'live' state at
    // sync time? Recipients can use this to show "synced while source
    // was frozen" if needed.
    indexStateLive: boolean('index_state_live'),

    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sliceIdx: index('idx_sync_events_slice').on(table.sliceId),
    typeIdx: index('idx_sync_events_type').on(table.eventType),
  })
)
