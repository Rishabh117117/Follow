/**
 * Memory Section Generator (Sprint MEM-1)
 *
 * Turns an index digest + a profile prompt template into a set of section
 * rows. Writes a new memory_versions row plus its memory_sections and
 * returns the version id.
 */

import { and, desc, eq, max } from 'drizzle-orm'
import { db } from '../../db/index'
import { memoryProfiles, memoryVersions } from '../../db/schema/memory-profiles'
import { memorySections } from '../../db/schema/memory-sections'
import { MODEL_TIERS, OPENROUTER_BASE } from '../../config/models'
import type { IndexDigest } from './index-digest'
import { hashDigest, isDigestEmpty } from './index-digest'

interface GeneratedSection {
  key: string
  title: string
  content: string
}

interface GenerateResult {
  versionId: string
  versionNumber: number
  sections: Array<{ id: string; key: string; title: string; content: string; sortOrder: number }>
  createdBy: 'generate' | 'seed'
  modelId: string | null
  sourceDigestHash: string | null
}

function getOpenRouterKey(): string {
  return process.env['OPENROUTER_API_KEY'] ?? ''
}

/**
 * Call the generator model with a profile's prompt template and the digest.
 * Returns parsed sections or throws.
 */
async function callGeneratorModel(
  promptTemplate: string,
  digest: IndexDigest,
  expectedKeys: string[]
): Promise<GeneratedSection[]> {
  const key = getOpenRouterKey()
  if (!key) throw new Error('OPENROUTER_API_KEY not set')

  const model = process.env['MEMORY_GENERATOR_MODEL'] || MODEL_TIERS.MICRO_SUMMARY

  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://follow.app',
      'X-Title': 'Follow Workspace',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: promptTemplate },
        { role: 'user', content: JSON.stringify(digest) },
      ],
      max_tokens: 2500,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  })

  if (!response.ok) {
    throw new Error(`Memory generator model error: ${response.status}`)
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>
  }
  const raw = data.choices[0]?.message?.content ?? ''

  let parsed: { sections?: Array<Partial<GeneratedSection>> }
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Memory generator returned non-JSON: ${raw.slice(0, 200)}`)
  }

  const sections = Array.isArray(parsed.sections) ? parsed.sections : []
  const byKey = new Map<string, GeneratedSection>()
  for (const s of sections) {
    if (!s || typeof s !== 'object') continue
    const k = String(s.key ?? '').trim()
    if (!k) continue
    byKey.set(k, {
      key: k,
      title: String(s.title ?? k).slice(0, 200),
      content: String(s.content ?? '').slice(0, 8000),
    })
  }

  // Return in the profile's declared order. Missing keys get a placeholder
  // so the UI always renders the full skeleton.
  return expectedKeys.map(
    (k) =>
      byKey.get(k) ?? {
        key: k,
        title: k,
        content: 'Not enough data yet — index more content to populate this section.',
      }
  )
}

/**
 * Build a seed version when the index is empty or the model is unavailable.
 * Produces placeholder rows so the UI has something to show on first load.
 */
function buildSeedSections(profileSectionKeys: Array<{ key: string; title: string }>): GeneratedSection[] {
  return profileSectionKeys.map((k) => ({
    key: k.key,
    title: k.title,
    content: 'Not enough data yet — index more content to populate this section.',
  }))
}

async function nextVersionNumber(profileId: string): Promise<number> {
  const [row] = await db
    .select({ v: max(memoryVersions.versionNumber) })
    .from(memoryVersions)
    .where(eq(memoryVersions.profileId, profileId))
  return Number(row?.v ?? 0) + 1
}

/**
 * Generate a new version for a profile and persist its sections.
 *
 * When `options.forceSeed = true` or the digest is empty or the model call
 * fails, writes a 'seed' version with placeholder content. Otherwise writes
 * a 'generate' version.
 */
export async function generateVersion(
  profileId: string,
  digest: IndexDigest,
  options: { forceSeed?: boolean } = {}
): Promise<GenerateResult> {
  const [profile] = await db
    .select()
    .from(memoryProfiles)
    .where(eq(memoryProfiles.id, profileId))
    .limit(1)
  if (!profile) throw new Error(`Profile ${profileId} not found`)

  const sectionKeys = (profile.sectionKeys as Array<{ key: string; title: string }>) ?? []
  const expectedKeys = sectionKeys.map((k) => k.key)

  const shouldSeed = options.forceSeed || isDigestEmpty(digest)

  let sections: GeneratedSection[]
  let createdBy: 'generate' | 'seed' = 'generate'
  let modelId: string | null = null
  let sourceDigestHash: string | null = null

  if (shouldSeed) {
    sections = buildSeedSections(sectionKeys)
    createdBy = 'seed'
  } else {
    try {
      sections = await callGeneratorModel(profile.promptTemplate, digest, expectedKeys)
      modelId = process.env['MEMORY_GENERATOR_MODEL'] || MODEL_TIERS.MICRO_SUMMARY
      sourceDigestHash = hashDigest(digest)
    } catch (err) {
      console.warn('[memory/generator] Falling back to seed — model error:', err)
      sections = buildSeedSections(sectionKeys)
      createdBy = 'seed'
    }
  }

  const versionNumber = await nextVersionNumber(profileId)

  const [version] = await db
    .insert(memoryVersions)
    .values({
      profileId: profile.id,
      userId: profile.userId,
      indexId: profile.indexId,
      versionNumber,
      createdBy,
      modelId,
      sourceDigestHash,
      metadata: {
        counts: digest.counts,
        digestGeneratedAt: digest.generatedAt,
      },
    })
    .returning()
  if (!version) throw new Error('Failed to create memory_version row')

  const sectionRows = await db
    .insert(memorySections)
    .values(
      sections.map((s, i) => ({
        userId: profile.userId,
        indexId: profile.indexId,
        versionId: version.id,
        key: s.key,
        title: s.title,
        content: s.content,
        sortOrder: i,
      }))
    )
    .returning()

  return {
    versionId: version.id,
    versionNumber: version.versionNumber,
    sections: sectionRows.map((r) => ({
      id: r.id,
      key: r.key,
      title: r.title,
      content: r.content,
      sortOrder: r.sortOrder,
    })),
    createdBy,
    modelId,
    sourceDigestHash,
  }
}

/**
 * Fork a new version from an existing one by copying its sections forward,
 * applying a single section override. Used when the user edits a section —
 * old versions stay read-only, the new version becomes the current page.
 */
export async function forkVersionWithEdit(params: {
  baseVersionId: string
  sectionKey: string
  newContent: string
  newTitle?: string
}): Promise<GenerateResult> {
  const [base] = await db
    .select()
    .from(memoryVersions)
    .where(eq(memoryVersions.id, params.baseVersionId))
    .limit(1)
  if (!base) throw new Error(`Version ${params.baseVersionId} not found`)

  const [profile] = await db
    .select()
    .from(memoryProfiles)
    .where(eq(memoryProfiles.id, base.profileId))
    .limit(1)
  if (!profile) throw new Error(`Profile ${base.profileId} not found`)

  const baseSections = await db
    .select()
    .from(memorySections)
    .where(eq(memorySections.versionId, base.id))
    .orderBy(memorySections.sortOrder)

  const versionNumber = await nextVersionNumber(base.profileId)

  const [version] = await db
    .insert(memoryVersions)
    .values({
      profileId: base.profileId,
      userId: base.userId,
      indexId: base.indexId,
      versionNumber,
      createdBy: 'edit',
      modelId: null,
      sourceDigestHash: base.sourceDigestHash,
      metadata: { forkedFrom: base.id, editedKey: params.sectionKey },
    })
    .returning()
  if (!version) throw new Error('Failed to create forked memory_version')

  const newSections = baseSections.map((s, i) => ({
    userId: s.userId,
    indexId: s.indexId,
    versionId: version.id,
    key: s.key,
    title: s.key === params.sectionKey && params.newTitle ? params.newTitle : s.title,
    content: s.key === params.sectionKey ? params.newContent : s.content,
    sortOrder: i,
  }))

  const inserted = await db.insert(memorySections).values(newSections).returning()

  return {
    versionId: version.id,
    versionNumber: version.versionNumber,
    sections: inserted.map((r) => ({
      id: r.id,
      key: r.key,
      title: r.title,
      content: r.content,
      sortOrder: r.sortOrder,
    })),
    createdBy: 'seed',
    modelId: null,
    sourceDigestHash: base.sourceDigestHash,
  }
}

/**
 * Look up the most recent version for a profile. Returns null if none exist.
 */
export async function getLatestVersion(profileId: string) {
  const [row] = await db
    .select()
    .from(memoryVersions)
    .where(eq(memoryVersions.profileId, profileId))
    .orderBy(desc(memoryVersions.versionNumber))
    .limit(1)
  return row ?? null
}

/**
 * Load a version with its sections ordered by sortOrder.
 */
export async function loadVersionWithSections(versionId: string) {
  const [version] = await db
    .select()
    .from(memoryVersions)
    .where(eq(memoryVersions.id, versionId))
    .limit(1)
  if (!version) return null

  const sections = await db
    .select()
    .from(memorySections)
    .where(eq(memorySections.versionId, versionId))
    .orderBy(memorySections.sortOrder)

  return { version, sections }
}

/**
 * List versions for a profile, newest first.
 */
export async function listVersions(profileId: string) {
  return db
    .select()
    .from(memoryVersions)
    .where(eq(memoryVersions.profileId, profileId))
    .orderBy(desc(memoryVersions.versionNumber))
}

/**
 * Ensure a profile has at least one version. If not, generate a seed version.
 * Used to avoid rendering an empty profile card.
 */
export async function ensureSeedVersion(profileId: string, digest: IndexDigest) {
  const existing = await getLatestVersion(profileId)
  if (existing) return existing
  const result = await generateVersion(profileId, digest, { forceSeed: true })
  return await getLatestVersion(profileId).then((v) => v ?? { id: result.versionId } as never)
}

/**
 * Helper used by the route layer to resolve the profile that owns a version,
 * asserting the caller owns it.
 */
export async function getVersionForUser(versionId: string, userId: string) {
  const [row] = await db
    .select()
    .from(memoryVersions)
    .where(and(eq(memoryVersions.id, versionId), eq(memoryVersions.userId, userId)))
    .limit(1)
  return row ?? null
}
