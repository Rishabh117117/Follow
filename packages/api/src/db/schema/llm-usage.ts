/**
 * LLM Usage Tracking (Sprint WIRE-1)
 *
 * Logs every LLM call with token counts and computed cost in USD.
 * Used by /api/health to expose cost metrics to the dev console.
 */

import { pgTable, uuid, text, integer, real, timestamp, index } from 'drizzle-orm/pg-core'
import { users } from './users'

export const llmUsage = pgTable(
  'llm_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    modelTier: text('model_tier').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd: real('cost_usd').notNull().default(0),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index('llm_usage_user_idx').on(table.userId),
    createdIdx: index('llm_usage_created_idx').on(table.createdAt),
    modelIdx: index('llm_usage_model_idx').on(table.model),
  })
)

export type LlmUsage = typeof llmUsage.$inferSelect
export type NewLlmUsage = typeof llmUsage.$inferInsert
