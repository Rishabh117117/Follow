/**
 * Memory Profiles + Versions (Sprint MEM-1)
 *
 * Profiles are user-editable templates that describe HOW the user's index
 * should be summarized into memory sections. Each profile produces versioned
 * snapshots (memory_versions), and each snapshot owns a set of
 * memory_sections rows. Older versions are read-only — editing a section
 * forks a new version so the book-metaphor history stays intact.
 */

import { pgTable, uuid, text, integer, timestamp, boolean, jsonb, index } from 'drizzle-orm/pg-core'
import { users } from './users'

export const memoryProfiles = pgTable(
  'memory_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'personal' for personal index, otherwise a space UUID
    indexId: text('index_id').notNull(),
    // Stable slug — e.g. 'activity', 'general-summary', 'topics'.
    // Built-in profiles use well-known slugs; user-created profiles use
    // sanitized slugs derived from their name.
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    // Prompt template passed to the generator. Built-ins ship with a canned
    // template; user-authored profiles carry their own.
    promptTemplate: text('prompt_template').notNull().default(''),
    // Ordered list of section keys the generator is expected to emit, so the
    // UI can render a stable skeleton even before generation completes.
    sectionKeys: jsonb('section_keys').notNull().default([]),
    isBuiltIn: boolean('is_built_in').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIndexIdx: index('memory_profiles_user_index_idx').on(table.userId, table.indexId),
    slugIdx: index('memory_profiles_slug_idx').on(table.userId, table.indexId, table.slug),
  })
)

export const memoryVersions = pgTable(
  'memory_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => memoryProfiles.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    indexId: text('index_id').notNull(),
    // Monotonic within (profileId). v1 is the first generation.
    versionNumber: integer('version_number').notNull(),
    // 'generate' when produced by the LLM, 'edit' when forked from a user
    // section edit, 'seed' for the zero-state placeholder version.
    createdBy: text('created_by').notNull().default('generate'),
    // Model tier that generated this version (null for edit/seed).
    modelId: text('model_id'),
    // Hash of the index digest used as generator input — lets us skip
    // regeneration if nothing has changed.
    sourceDigestHash: text('source_digest_hash'),
    // Freeform metadata: counts, timings, token usage, etc.
    metadata: jsonb('metadata').notNull().default({}),
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    profileIdx: index('memory_versions_profile_idx').on(table.profileId, table.versionNumber),
    userIndexIdx: index('memory_versions_user_index_idx').on(table.userId, table.indexId),
  })
)

export type MemoryProfile = typeof memoryProfiles.$inferSelect
export type NewMemoryProfile = typeof memoryProfiles.$inferInsert
export type MemoryVersion = typeof memoryVersions.$inferSelect
export type NewMemoryVersion = typeof memoryVersions.$inferInsert
