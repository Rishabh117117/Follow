/**
 * User Patterns + Pattern Edge Priors (2026-04-29)
 *
 * Procedural · Postgres storage for the Profiler stage of the pipeline
 * (v5.2 §06 stage 07). Two tables:
 *
 *   - user_patterns          — patterns Profiler emits per user (per session
 *                              start/end + daily 14-day slice)
 *   - pattern_edge_priors    — Profiler's edge-type hints for Analyst's
 *                              1-hour feedback loop (§06 fig 05)
 *
 * Both are append-only — the Profiler writes a new generation each run with a
 * `runId` so the latest set is queryable as `MAX(generated_at) per userId`.
 * That lets us audit drift over time without overwriting history.
 */

import {
  pgTable,
  uuid,
  text,
  varchar,
  timestamp,
  real,
  index,
} from 'drizzle-orm/pg-core'
import { users } from './users'
import { workspaces } from './workspaces'

export const userPatterns = pgTable(
  'user_patterns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Groups all patterns emitted by one Profiler run together. */
    runId: uuid('run_id').notNull(),

    /** 'session_start' | 'session_end' | 'rolling_14d' */
    mode: varchar('mode', { length: 32 }).notNull(),

    /** 'temporal' | 'topical' | 'collaborative' | 'stuck' | 'ai_acceptance' */
    kind: varchar('kind', { length: 32 }).notNull(),

    description: text('description').notNull(),
    confidence: real('confidence').notNull(),

    /** Record ids the LLM cited as evidence for this pattern. Stored as
     *  text[] (UUIDs as strings) to avoid a hard FK and keep prune-safe. */
    supportingRecordIds: text('supporting_record_ids').array().default([]),

    /** One-sentence work-style narrative emitted alongside the patterns this
     *  run (same value repeated on each row of the run for query simplicity). */
    workStyleNarrative: text('work_style_narrative'),

    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userLatestIdx: index('user_patterns_user_generated_idx').on(t.userId, t.generatedAt),
    runIdx: index('user_patterns_run_idx').on(t.runId),
  })
)

export const patternEdgePriors = pgTable(
  'pattern_edge_priors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),

    /** Same runId as user_patterns — joins back to the run that produced it. */
    runId: uuid('run_id').notNull(),

    topicHint: text('topic_hint').notNull(),
    /** 'references' | 'supports' | 'contradicts' | 'elaborates' | 'supersedes' */
    edgeType: varchar('edge_type', { length: 32 }).notNull(),
    weight: real('weight').notNull(),
    rationale: text('rationale'),

    generatedAt: timestamp('generated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userTopicIdx: index('pattern_edge_priors_user_topic_idx').on(t.userId, t.topicHint),
    runIdx: index('pattern_edge_priors_run_idx').on(t.runId),
  })
)

export type UserPattern = typeof userPatterns.$inferSelect
export type NewUserPattern = typeof userPatterns.$inferInsert
export type PatternEdgePrior = typeof patternEdgePriors.$inferSelect
export type NewPatternEdgePrior = typeof patternEdgePriors.$inferInsert
