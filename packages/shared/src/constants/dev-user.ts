/**
 * Dev User Constants
 *
 * Single source of truth for all dev-mode identifiers.
 * Used when DEV_BYPASS_AUTH=true to provide a persistent mock user profile.
 *
 * These values are seeded into the database on API server startup
 * (see packages/api/src/db/seed-dev-user.ts) so that FK constraints
 * are satisfied in both PGlite and real PostgreSQL.
 */

export const DEV_USER = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  email: 'dev@follow.app',
  name: 'Rishabh Mishra',
  avatarUrl: null,
} as const

export const DEV_WORKSPACE = {
  id: 'c3d4e5f6-a7b8-9012-cdef-123456789012',
  name: 'Follow Development',
  slug: 'follow-dev',
} as const

export const DEV_USER_PROFILE_ID = 'd4e5f6a7-b8c9-0123-def0-234567890abc'
