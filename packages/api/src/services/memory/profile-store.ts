/**
 * Memory Profile Store (Sprint MEM-1)
 *
 * Read/write helpers for memory_profiles. Seeds the 5 built-in profiles
 * on first access per (user, index).
 */

import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../db/index'
import { memoryProfiles } from '../../db/schema/memory-profiles'
import { BUILT_IN_PROFILES } from './built-in-profiles'

export async function listProfiles(userId: string, indexId: string) {
  return db
    .select()
    .from(memoryProfiles)
    .where(and(eq(memoryProfiles.userId, userId), eq(memoryProfiles.indexId, indexId)))
    .orderBy(asc(memoryProfiles.sortOrder), asc(memoryProfiles.createdAt))
}

/**
 * Ensure the 5 built-in profiles exist for this (user, indexId). Returns
 * the full ordered profile list after seeding.
 */
export async function ensureBuiltInProfiles(userId: string, indexId: string) {
  const existing = await listProfiles(userId, indexId)
  const existingSlugs = new Set(existing.map((p) => p.slug))

  const missing = BUILT_IN_PROFILES.filter((p) => !existingSlugs.has(p.slug))
  if (missing.length === 0) return existing

  await db.insert(memoryProfiles).values(
    missing.map((p) => ({
      userId,
      indexId,
      slug: p.slug,
      name: p.name,
      description: p.description,
      promptTemplate: p.promptTemplate,
      sectionKeys: p.sectionKeys,
      isBuiltIn: true,
      sortOrder: p.sortOrder,
    }))
  )

  return listProfiles(userId, indexId)
}

export async function getProfile(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(memoryProfiles)
    .where(and(eq(memoryProfiles.id, id), eq(memoryProfiles.userId, userId)))
    .limit(1)
  return row ?? null
}

export async function createUserProfile(input: {
  userId: string
  indexId: string
  slug: string
  name: string
  description?: string
  promptTemplate: string
  sectionKeys: Array<{ key: string; title: string }>
  sortOrder?: number
}) {
  const [row] = await db
    .insert(memoryProfiles)
    .values({
      userId: input.userId,
      indexId: input.indexId,
      slug: input.slug,
      name: input.name,
      description: input.description ?? '',
      promptTemplate: input.promptTemplate,
      sectionKeys: input.sectionKeys,
      isBuiltIn: false,
      sortOrder: input.sortOrder ?? 100,
    })
    .returning()
  return row
}

export async function deleteUserProfile(id: string, userId: string) {
  const [row] = await db
    .delete(memoryProfiles)
    .where(
      and(
        eq(memoryProfiles.id, id),
        eq(memoryProfiles.userId, userId),
        eq(memoryProfiles.isBuiltIn, false)
      )
    )
    .returning({ id: memoryProfiles.id })
  return row ?? null
}

export function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}
