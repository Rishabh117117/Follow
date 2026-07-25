import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  pgEnum,
  real,
  integer,
  index,
} from 'drizzle-orm/pg-core'
import { workspaces } from './workspaces'
import { files } from './files'
import { strands } from './threads'

// ─── ENUMS ────────────────────────────────────────────────────────────────────

export const narrativePhaseEnum = pgEnum('narrative_phase', [
  'inception',
  'exploration',
  'convergence',
  'stabilization',
  'delivery',
])

export const cognitiveStateEnum = pgEnum('cognitive_state', [
  'exploring',
  'comparing',
  'deciding',
  'synthesizing',
  'refining',
  'stuck',
  'presenting',
])

// ─── DOCUMENT INTERPRETATIONS ─────────────────────────────────────────────────

export const documentInterpretations = pgTable(
  'document_interpretations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    strandId: uuid('strand_id').references(() => strands.id, { onDelete: 'set null' }),
    narrativePhase: narrativePhaseEnum('narrative_phase').notNull(),
    narrativeConfidence: real('narrative_confidence').notNull(),
    narrativeSummary: text('narrative_summary').notNull(),
    workingIntent: text('working_intent').notNull(),
    intentEvidence: text('intent_evidence').notNull(),
    cognitiveState: cognitiveStateEnum('cognitive_state').notNull(),
    activeTensions: jsonb('active_tensions')
      .$type<Array<{ name: string; description: string; evidence: string }>>()
      .default([]),
    sourceInfluence: jsonb('source_influence')
      .$type<Array<{ sourceName: string; weight: number; reason: string }>>()
      .default([]),
    unresolvedQuestions: jsonb('unresolved_questions')
      .$type<Array<{ question: string; evidence: string }>>()
      .default([]),
    modelUsed: text('model_used'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    fileUpdatedIdx: index('doc_interp_file_updated_idx').on(table.fileId, table.updatedAt),
  })
)

// ─── DOCUMENT PATTERNS ────────────────────────────────────────────────────────

export const documentPatterns = pgTable(
  'document_patterns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    pattern: text('pattern').notNull(),
    confidence: real('confidence').notNull(),
    evidence: text('evidence').array().default([]),
    reinforcedCount: integer('reinforced_count').notNull().default(1),
    dismissed: jsonb('dismissed').$type<boolean>().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastReinforcedAt: timestamp('last_reinforced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    fileConfidenceIdx: index('doc_patterns_file_confidence_idx').on(table.fileId, table.confidence),
  })
)

// ─── DOCUMENT DECISION TRAILS ─────────────────────────────────────────────────

export const documentDecisionTrails = pgTable(
  'document_decision_trails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    paragraphRef: text('paragraph_ref').notNull(),
    trailSteps: jsonb('trail_steps')
      .$type<
        Array<{
          step: string
          type: 'human' | 'ai_accepted' | 'ai_rejected' | 'source_added' | 'collaborator'
          timestamp: string
        }>
      >()
      .default([]),
    stabilityScore: real('stability_score').notNull().default(0),
    humanAuthoredPct: real('human_authored_pct').notNull().default(1),
    anchorSource: text('anchor_source'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    fileIdx: index('doc_trails_file_idx').on(table.fileId),
  })
)
