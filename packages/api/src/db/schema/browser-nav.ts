import { pgTable, uuid, text, timestamp, pgEnum, jsonb, real, integer } from 'drizzle-orm/pg-core'
import { users } from './users'

// ─── Browser Navigation Sessions ─────────────────────────────────────

export const navSessionStatusEnum = pgEnum('nav_session_status', [
  'pending',
  'navigating',
  'spotlighting',
  'completed',
  'failed',
  'cancelled',
])

export const browserNavSessions = pgTable('browser_nav_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  query: text('query').notNull(),
  targetDescription: text('target_description'),
  finalUrl: text('final_url'),
  status: navSessionStatusEnum('status').notNull().default('pending'),
  confidence: real('confidence'),
  screenshotDataUrl: text('screenshot_data_url'),
  spotlightFired: integer('spotlight_fired').notNull().default(0),
  fallbackUsed: text('fallback_used'),
  errorReason: text('error_reason'),
  navIntent: jsonb('nav_intent').$type<Record<string, unknown>>().default({}),
  rankedResults: jsonb('ranked_results').$type<Record<string, unknown>[]>().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})
