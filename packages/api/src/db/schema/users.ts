import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgEnum,
  jsonb,
  integer,
  primaryKey,
} from 'drizzle-orm/pg-core'
import type { UserSettings } from '@workspace/shared/types'

export const userRoleEnum = pgEnum('user_role', ['owner', 'admin', 'editor', 'viewer'])

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  avatarUrl: text('avatar_url'),
  image: text('image'),
  emailVerified: timestamp('email_verified', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const accounts = pgTable(
  'accounts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<'email' | 'oidc' | 'oauth' | 'webauthn'>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })]
)

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
)

export const userProfiles = pgTable('user_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expertiseAreas: jsonb('expertise_areas').$type<Record<string, unknown>>().default({}),
  promptPreferences: jsonb('prompt_preferences').$type<Record<string, unknown>>().default({}),
  interactionStyle: jsonb('interaction_style').$type<Record<string, unknown>>().default({}),
  knownFacts: jsonb('known_facts').$type<Record<string, unknown>[]>().default([]),
  totalPromptsShown: integer('total_prompts_shown').notNull().default(0),
  totalPromptsAnswered: integer('total_prompts_answered').notNull().default(0),
  totalPromptsDismissed: integer('total_prompts_dismissed').notNull().default(0),
  automationPreferences: jsonb('automation_preferences')
    .$type<{
      browserNavLevel?: 'recommend' | 'assist' | 'automate'
    }>()
    .default({}),
  settings: jsonb('settings').$type<UserSettings>().default({}),
  lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
})
