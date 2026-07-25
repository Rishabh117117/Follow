import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
} from 'drizzle-orm/pg-core'

// Per-user per-workspace AI state — the AI's persistent memory
export const aiState = pgTable(
  'ai_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),

    // The state document — split into 3 columns to reduce optimistic concurrency collisions
    stateEvent: jsonb('state_event').notNull().default('{}'), // Layer 2: event layer
    stateSession: jsonb('state_session').notNull().default('{}'), // Layer 3: session layer
    statePersistent: jsonb('state_persistent').notNull().default('{}'), // Layer 4: persistent layer

    // Versioning for optimistic concurrency
    version: integer('version').notNull().default(1),

    // Timestamps for scheduling
    lastEventUpdate: timestamp('last_event_update', { withTimezone: true }),
    lastCondensation: timestamp('last_condensation', { withTimezone: true }),
    lastPatternDetection: timestamp('last_pattern_detection', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userWorkspaceIdx: uniqueIndex('idx_ai_state_user_workspace').on(
      table.userId,
      table.workspaceId
    ),
  })
)

// Per-document shared state — what all collaborators' AIs share
export const documentSharedState = pgTable(
  'document_shared_state',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id').notNull(),
    workspaceId: uuid('workspace_id').notNull(),

    // The shared state document
    state: jsonb('state').notNull().default('{}'),

    version: integer('version').notNull().default(1),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    documentIdx: uniqueIndex('idx_document_shared_state_doc').on(table.documentId),
  })
)
