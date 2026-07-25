/**
 * Memory API (Sprint MEM-1: versioned, profile-driven memory)
 *
 * Profiles are user-selectable "ways to look at" the index. Each profile
 * owns a chain of versions; each version owns a snapshot of sections.
 * The book metaphor: each version is a page the user can flip to.
 *
 *   GET    /api/memory/profiles?indexId=...          — list profiles (seeds built-ins)
 *   POST   /api/memory/profiles                      — create a user-authored profile
 *   DELETE /api/memory/profiles/:id                  — delete a user-authored profile
 *   POST   /api/memory/profiles/:id/generate         — regenerate → new version
 *
 *   GET    /api/memory/versions?profileId=...        — list versions (newest first)
 *   GET    /api/memory/versions/:id                  — fetch one version + sections
 *
 *   GET    /api/memory/sections?indexId=...          — latest version of the default profile
 *   POST   /api/memory/sections                      — ad-hoc create (legacy)
 *   PATCH  /api/memory/sections/:id                  — edit → forks a new version
 *   DELETE /api/memory/sections/:id                  — legacy delete
 */

import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { db } from '../db/index'
import { memorySections } from '../db/schema/memory-sections'
import { spaces } from '../db/schema/spaces'
import { authMiddleware } from '../middleware/auth'
import { assertWorkspaceAccess } from '../services/workspace-access'
import { buildIndexDigest, type IndexDigest } from '../services/memory/index-digest'

/**
 * Digest building queries index tables by UUID; a non-UUID indexId (or any
 * digest failure) must degrade to an empty digest — the caller seeds
 * placeholder sections either way — instead of 500ing the memory page.
 */
async function buildIndexDigestSafe(userId: string, indexId: string): Promise<IndexDigest> {
  try {
    return await buildIndexDigest(userId, indexId)
  } catch {
    return {
      indexId,
      indexKind: 'personal',
      counts: { facts: 0, threads: 0, files: 0 },
      recentFacts: [],
      recentThreads: [],
      recentFiles: [],
      generatedAt: new Date().toISOString(),
    }
  }
}

/**
 * security-gate-1: buildIndexDigest's project branch (buildProjectDigest) reads
 * a space/workspace by indexId with NO user/membership scoping, so a caller
 * could digest another tenant's index by naming its id. Resolve the indexId to
 * the workspace that owns it so the caller can be membership-checked before the
 * digest runs.
 *   - 'personal' → null: buildPersonalDigest is strictly userId-scoped, so no
 *     workspace guard applies (and 'personal' is not a workspace).
 *   - a project index === a `spaces` row → guard the space's owning workspace.
 *   - an unknown/non-space id → itself, so assertWorkspaceAccess rejects it.
 */
async function workspaceIdForIndex(indexId: string): Promise<string | null> {
  if (indexId === 'personal') return null
  // A non-UUID key is a personal-style index label: it can name neither a
  // space nor a workspace, and the project digest's uuid-column queries all
  // fail closed (buildIndexDigestSafe degrades to an empty digest) — nothing
  // to guard.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(indexId)) {
    return null
  }
  const [space] = await db
    .select({ workspaceId: spaces.workspaceId })
    .from(spaces)
    .where(eq(spaces.id, indexId))
    .limit(1)
  if (space) return space.workspaceId
  // A UUID that isn't a space can still reach data: buildProjectDigest matches
  // `workspaceId = indexId` columns directly. Guard it AS a workspace id
  // (assertWorkspaceAccess 404s when no such workspace exists).
  return indexId
}
import {
  ensureBuiltInProfiles,
  getProfile,
  createUserProfile,
  deleteUserProfile,
  slugify,
} from '../services/memory/profile-store'
import {
  generateVersion,
  getLatestVersion,
  loadVersionWithSections,
  listVersions,
  forkVersionWithEdit,
} from '../services/memory/section-generator'

const memorySectionsRouter = new Hono()
memorySectionsRouter.use('*', authMiddleware)

// ─── Schemas ────────────────────────────────────────────────────────────────

const IndexQuerySchema = z.object({ indexId: z.string().min(1) })

const CreateProfileSchema = z.object({
  indexId: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  promptTemplate: z.string().min(10).max(8000),
  sectionKeys: z
    .array(
      z.object({
        key: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-z0-9-]+$/),
        title: z.string().min(1).max(120),
      })
    )
    .min(1)
    .max(12),
})

const GenerateSchema = z.object({
  indexId: z.string().min(1),
})

const PatchSectionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.string().max(16000).optional(),
})

const CreateSectionSchema = z.object({
  indexId: z.string().min(1),
  key: z.string().min(1).max(64),
  title: z.string().min(1).max(200),
  content: z.string().default(''),
  sortOrder: z.number().int().min(0).optional(),
})

// ─── Profile endpoints ─────────────────────────────────────────────────────

memorySectionsRouter.get('/profiles', async (c) => {
  const userId = c.get('userId') as string
  const indexId = c.req.query('indexId')
  const parsed = IndexQuerySchema.safeParse({ indexId })
  if (!parsed.success) {
    return c.json({ data: null, error: { message: 'indexId is required' } }, 400)
  }

  try {
    const profiles = await ensureBuiltInProfiles(userId, parsed.data.indexId)

    // Attach the latest version summary for each profile so the UI can
    // render the book card without a second round trip.
    const profilesWithLatest = await Promise.all(
      profiles.map(async (p) => {
        const latest = await getLatestVersion(p.id)
        return {
          ...p,
          latestVersion: latest
            ? {
                id: latest.id,
                versionNumber: latest.versionNumber,
                createdBy: latest.createdBy,
                generatedAt: latest.generatedAt,
                modelId: latest.modelId,
              }
            : null,
        }
      })
    )

    return c.json({ data: profilesWithLatest, error: null })
  } catch (err) {
    return c.json(
      {
        data: null,
        error: {
          message: err instanceof Error ? err.message : 'Failed to load profiles',
        },
      },
      500
    )
  }
})

memorySectionsRouter.post('/profiles', zValidator('json', CreateProfileSchema), async (c) => {
  const userId = c.get('userId') as string
  const body = c.req.valid('json')

  try {
    const slug = slugify(body.name) || `profile-${Date.now()}`
    const row = await createUserProfile({
      userId,
      indexId: body.indexId,
      slug,
      name: body.name,
      description: body.description,
      promptTemplate: body.promptTemplate,
      sectionKeys: body.sectionKeys,
    })
    return c.json({ data: row, error: null }, 201)
  } catch (err) {
    return c.json(
      {
        data: null,
        error: { message: err instanceof Error ? err.message : 'Failed to create profile' },
      },
      500
    )
  }
})

memorySectionsRouter.delete('/profiles/:id', async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  try {
    const row = await deleteUserProfile(id, userId)
    if (!row) {
      return c.json({ data: null, error: { message: 'Profile not found or is built-in' } }, 404)
    }
    return c.json({ data: { deleted: true }, error: null })
  } catch (err) {
    return c.json(
      {
        data: null,
        error: { message: err instanceof Error ? err.message : 'Failed to delete profile' },
      },
      500
    )
  }
})

memorySectionsRouter.post(
  '/profiles/:id/generate',
  zValidator('json', GenerateSchema),
  async (c) => {
    const userId = c.get('userId') as string
    const id = c.req.param('id')
    const body = c.req.valid('json')

    try {
      const profile = await getProfile(id, userId)
      if (!profile) {
        return c.json({ data: null, error: { message: 'Profile not found' } }, 404)
      }
      if (profile.indexId !== body.indexId) {
        return c.json(
          { data: null, error: { message: 'Profile does not belong to this index' } },
          400
        )
      }

      // Guard the workspace behind a project index before the digest reads it.
      const wsId = await workspaceIdForIndex(profile.indexId)
      if (wsId) {
        const denied = await assertWorkspaceAccess(c, wsId)
        if (denied) return denied
      }

      const digest = await buildIndexDigestSafe(userId, profile.indexId)
      const result = await generateVersion(profile.id, digest)

      return c.json({ data: result, error: null })
    } catch (err) {
      return c.json(
        {
          data: null,
          error: {
            message: err instanceof Error ? err.message : 'Failed to generate version',
          },
        },
        500
      )
    }
  }
)

// ─── Version endpoints ─────────────────────────────────────────────────────

memorySectionsRouter.get('/versions', async (c) => {
  const userId = c.get('userId') as string
  const profileId = c.req.query('profileId')
  if (!profileId) {
    return c.json({ data: null, error: { message: 'profileId is required' } }, 400)
  }
  try {
    const profile = await getProfile(profileId, userId)
    if (!profile) {
      return c.json({ data: null, error: { message: 'Profile not found' } }, 404)
    }
    const versions = await listVersions(profileId)
    return c.json({ data: versions, error: null })
  } catch (err) {
    return c.json(
      {
        data: null,
        error: { message: err instanceof Error ? err.message : 'Failed to list versions' },
      },
      500
    )
  }
})

memorySectionsRouter.get('/versions/:id', async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  try {
    const result = await loadVersionWithSections(id)
    if (!result || result.version.userId !== userId) {
      return c.json({ data: null, error: { message: 'Version not found' } }, 404)
    }
    return c.json({
      data: {
        version: result.version,
        sections: result.sections,
      },
      error: null,
    })
  } catch (err) {
    return c.json(
      {
        data: null,
        error: { message: err instanceof Error ? err.message : 'Failed to load version' },
      },
      500
    )
  }
})

// ─── Sections (book-page content) ──────────────────────────────────────────

/**
 * GET /sections — legacy-compatible. Returns the latest version of the
 * first profile (sort order) for this (user, index). Seeds built-in
 * profiles and generates an initial version if none exists yet.
 */
memorySectionsRouter.get('/sections', async (c) => {
  const userId = c.get('userId') as string
  const indexId = c.req.query('indexId')
  const parsed = IndexQuerySchema.safeParse({ indexId })
  if (!parsed.success) {
    return c.json({ data: null, error: { message: 'indexId is required' } }, 400)
  }

  // A project index digests a workspace's data (buildProjectDigest); block a
  // caller who isn't a member. 'personal' is userId-scoped and skips the guard.
  const wsId = await workspaceIdForIndex(parsed.data.indexId)
  if (wsId) {
    const denied = await assertWorkspaceAccess(c, wsId)
    if (denied) return denied
  }

  try {
    const profiles = await ensureBuiltInProfiles(userId, parsed.data.indexId)
    const defaultProfile = profiles[0]
    if (!defaultProfile) {
      return c.json({ data: [], error: null })
    }

    let latest = await getLatestVersion(defaultProfile.id)
    if (!latest) {
      const digest = await buildIndexDigestSafe(userId, parsed.data.indexId)
      await generateVersion(defaultProfile.id, digest, { forceSeed: true })
      latest = await getLatestVersion(defaultProfile.id)
    }
    if (!latest) {
      return c.json({ data: [], error: null })
    }

    const sections = await db
      .select()
      .from(memorySections)
      .where(eq(memorySections.versionId, latest.id))
      .orderBy(asc(memorySections.sortOrder))

    return c.json({ data: sections, error: null })
  } catch (err) {
    return c.json(
      {
        data: null,
        error: {
          message: err instanceof Error ? err.message : 'Failed to load sections',
        },
      },
      500
    )
  }
})

memorySectionsRouter.post('/sections', zValidator('json', CreateSectionSchema), async (c) => {
  const userId = c.get('userId') as string
  const body = c.req.valid('json')

  try {
    const [inserted] = await db
      .insert(memorySections)
      .values({
        userId,
        indexId: body.indexId,
        key: body.key,
        title: body.title,
        content: body.content,
        sortOrder: body.sortOrder ?? 0,
      })
      .returning()

    return c.json({ data: inserted, error: null }, 201)
  } catch (err) {
    return c.json(
      {
        data: null,
        error: { message: err instanceof Error ? err.message : 'Failed to create section' },
      },
      500
    )
  }
})

/**
 * PATCH /sections/:id — forks the owning version with the edited content
 * applied. Old versions stay read-only (book metaphor: flipping back shows
 * the page as it was).
 */
memorySectionsRouter.patch('/sections/:id', zValidator('json', PatchSectionSchema), async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')
  const body = c.req.valid('json')

  if (body.content === undefined && body.title === undefined) {
    return c.json({ data: null, error: { message: 'Nothing to update' } }, 400)
  }

  try {
    const [section] = await db
      .select()
      .from(memorySections)
      .where(and(eq(memorySections.id, id), eq(memorySections.userId, userId)))
      .limit(1)
    if (!section) {
      return c.json({ data: null, error: { message: 'Section not found' } }, 404)
    }

    // Legacy rows without a versionId get updated in place (one-time
    // tolerance during the MEM-1 rollout). New rows always fork.
    if (!section.versionId) {
      const update: Record<string, unknown> = { updatedAt: new Date() }
      if (body.title !== undefined) update['title'] = body.title
      if (body.content !== undefined) update['content'] = body.content
      const [updated] = await db
        .update(memorySections)
        .set(update)
        .where(and(eq(memorySections.id, id), eq(memorySections.userId, userId)))
        .returning()
      return c.json({ data: updated, error: null })
    }

    const forked = await forkVersionWithEdit({
      baseVersionId: section.versionId,
      sectionKey: section.key,
      newContent: body.content ?? section.content,
      newTitle: body.title,
    })
    const edited = forked.sections.find((s) => s.key === section.key) ?? forked.sections[0]
    return c.json({
      data: { section: edited, versionId: forked.versionId, versionNumber: forked.versionNumber },
      error: null,
    })
  } catch (err) {
    return c.json(
      {
        data: null,
        error: { message: err instanceof Error ? err.message : 'Failed to update section' },
      },
      500
    )
  }
})

memorySectionsRouter.delete('/sections/:id', async (c) => {
  const userId = c.get('userId') as string
  const id = c.req.param('id')

  try {
    const [deleted] = await db
      .delete(memorySections)
      .where(and(eq(memorySections.id, id), eq(memorySections.userId, userId)))
      .returning({ id: memorySections.id })

    if (!deleted) {
      return c.json({ data: null, error: { message: 'Section not found' } }, 404)
    }
    return c.json({ data: { deleted: true }, error: null })
  } catch (err) {
    return c.json(
      {
        data: null,
        error: { message: err instanceof Error ? err.message : 'Failed to delete section' },
      },
      500
    )
  }
})

export { memorySectionsRouter }
