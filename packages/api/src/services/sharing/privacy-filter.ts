/**
 * Privacy Filter Service (Sprint SH-1)
 *
 * Filter pipeline that every piece of content must pass through before
 * leaving the user's index (via shared slices or context requests).
 *
 * Three presets (`private`, `balanced`, `open`) with built-in rules,
 * plus custom per-user rules layered on top. The pipeline:
 *
 *   active preset rules → custom rules (by priority) → final output
 *
 * Rule types:
 *   - redact_pattern   — regex/keyword redaction (emails, SSN, API keys, …)
 *   - exclude_topic    — drop the whole item if topic matches
 *   - exclude_source   — drop the whole item if sourceType matches
 *   - exclude_time_range — (schema-defined, not yet implemented in SH-1)
 *   - allow_only       — (schema-defined, not yet implemented in SH-1)
 *
 * Exclude rules return `text: ''` with `excludedByRule` set, so callers
 * can skip or log fully-dropped items without losing the reason.
 */

import { and, asc, eq } from 'drizzle-orm'
import { db } from '../../db/index'
import { indexAccess, privacyFilterRules } from '../../db/schema/sharing'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FilterableContent {
  text: string
  sourceType?: string // 'document' | 'chat' | 'notebook' | 'extension' | …
  topic?: string
  timestamp?: Date
  metadata?: Record<string, unknown>
}

export interface FilteredContent {
  text: string
  wasModified: boolean
  redactionCount: number
  excludedByRule?: string
}

type BuiltInRuleType =
  | 'redact_pattern'
  | 'exclude_topic'
  | 'exclude_source'
  | 'exclude_time_range'
  | 'allow_only'

interface BuiltInRule {
  type: BuiltInRuleType
  config: Record<string, unknown>
}

interface PresetDefinition {
  name: string
  description: string
  builtInRules: BuiltInRule[]
}

// ─── Preset Definitions ──────────────────────────────────────────────────────

const PRESETS: Record<string, PresetDefinition> = {
  private: {
    name: 'Private',
    description:
      'Maximum protection. Redacts personal info, credentials, financial data. Excludes chat history and opinion-tagged topics. Only factual non-sensitive content passes through.',
    builtInRules: [
      {
        type: 'redact_pattern',
        config: {
          patterns: [
            '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b', // emails
            '\\b\\d{3}[-.]?\\d{3}[-.]?\\d{4}\\b', // phone numbers
            '\\b\\d{3}-\\d{2}-\\d{4}\\b', // SSN
            '\\b(?:sk-|pk_|api[_-]?key)[a-zA-Z0-9_-]{20,}\\b', // API keys
            '\\$[\\d,]+(?:\\.\\d{2})?(?:\\s*(?:million|billion|M|B|K))?', // dollar amounts
          ],
          replacement: '[REDACTED]',
        },
      },
      {
        type: 'exclude_topic',
        config: {
          topics: [
            'salary',
            'compensation',
            'personal',
            'private',
            'confidential',
            'password',
            'credential',
            'opinion about',
            'i think',
            'i feel',
          ],
          matchMode: 'contains',
        },
      },
      {
        type: 'exclude_source',
        config: { sourceTypes: ['chat'] },
      },
    ],
  },

  balanced: {
    name: 'Balanced',
    description:
      'Moderate protection. Redacts credentials and personal identifiers. Topic-level content passes through with secrets scrubbed.',
    builtInRules: [
      {
        type: 'redact_pattern',
        config: {
          patterns: [
            '\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Z|a-z]{2,}\\b', // emails
            '\\b\\d{3}-\\d{2}-\\d{4}\\b', // SSN
            '\\b(?:sk-|pk_|api[_-]?key)[a-zA-Z0-9_-]{20,}\\b', // API keys
          ],
          replacement: '[REDACTED]',
        },
      },
      {
        type: 'exclude_topic',
        config: {
          topics: ['password', 'credential', 'secret', 'confidential'],
          matchMode: 'contains',
        },
      },
    ],
  },

  open: {
    name: 'Open',
    description:
      'Minimal protection. Only redacts credentials and SSNs. All other content passes through for maximum shared intelligence.',
    builtInRules: [
      {
        type: 'redact_pattern',
        config: {
          patterns: [
            '\\b(?:sk-|pk_|api[_-]?key)[a-zA-Z0-9_-]{20,}\\b', // API keys
            '\\b\\d{3}-\\d{2}-\\d{4}\\b', // SSN
          ],
          replacement: '[REDACTED]',
        },
      },
    ],
  },
}

// ─── Preset Metadata API ─────────────────────────────────────────────────────

/**
 * Get the preset definitions (for UI display).
 */
export function getPresetDefinitions(): Record<
  string,
  { name: string; description: string; ruleCount: number }
> {
  const result: Record<string, { name: string; description: string; ruleCount: number }> = {}
  for (const [key, preset] of Object.entries(PRESETS)) {
    result[key] = {
      name: preset.name,
      description: preset.description,
      ruleCount: preset.builtInRules.length,
    }
  }
  return result
}

// ─── Main Filter Pipeline ────────────────────────────────────────────────────

/**
 * Apply privacy filters to content before it leaves the user's index.
 *
 * Pipeline: preset rules → custom rules (ascending priority) → output.
 * Exclude rules short-circuit with `text: ''` + `excludedByRule`.
 * Unknown presets fall back to `balanced`.
 */
export async function applyPrivacyFilters(params: {
  userId: string
  workspaceId: string
  content: FilterableContent
  documentId?: string
}): Promise<FilteredContent> {
  // 1. Load active preset
  const [access] = await db
    .select()
    .from(indexAccess)
    .where(eq(indexAccess.userId, params.userId))
    .limit(1)

  const presetName = access?.activePreset ?? 'balanced'
  const preset = PRESETS[presetName] ?? PRESETS.balanced!

  // 2. Load custom rules (scoped to the same workspace, active only)
  let customRules: Array<typeof privacyFilterRules.$inferSelect> = []
  try {
    customRules = await db
      .select()
      .from(privacyFilterRules)
      .where(
        and(
          eq(privacyFilterRules.userId, params.userId),
          eq(privacyFilterRules.workspaceId, params.workspaceId),
          eq(privacyFilterRules.isActive, true)
        )
      )
      .orderBy(asc(privacyFilterRules.priority))
  } catch {
    // Table may not exist yet in some environments — fall back to preset-only
  }

  // 3. Apply scope filter
  const applicableCustomRules = customRules.filter((rule) => {
    if (rule.scope === 'all') return true
    if (rule.scope === 'workspace') return true // already workspace-filtered
    if (rule.scope === 'document' && rule.scopeDocumentId === params.documentId) return true
    return false
  })

  // 4. Run the pipeline
  return applyRules(
    params.content,
    preset.builtInRules,
    applicableCustomRules.map((r) => ({
      type: r.ruleType as BuiltInRuleType,
      config: (r.ruleConfig ?? {}) as Record<string, unknown>,
    }))
  )
}

// ─── Rule Evaluator ──────────────────────────────────────────────────────────

function applyRules(
  content: FilterableContent,
  presetRules: BuiltInRule[],
  customRules: BuiltInRule[]
): FilteredContent {
  let text = content.text
  let redactionCount = 0
  let wasModified = false

  const allRules = [...presetRules, ...customRules]

  for (const rule of allRules) {
    switch (rule.type) {
      case 'redact_pattern': {
        const patterns = (rule.config.patterns as string[] | undefined) ?? []
        const replacement = (rule.config.replacement as string | undefined) ?? '[REDACTED]'

        for (const pattern of patterns) {
          try {
            const regex = new RegExp(pattern, 'gi')
            const before = text
            text = text.replace(regex, replacement)
            if (text !== before) {
              redactionCount++
              wasModified = true
            }
          } catch {
            // Invalid regex — skip this pattern
          }
        }
        break
      }

      case 'exclude_topic': {
        const topics = (rule.config.topics as string[] | undefined) ?? []
        const matchMode = (rule.config.matchMode as string | undefined) ?? 'contains'
        const haystack = (content.topic ?? text).toLowerCase()

        for (const topic of topics) {
          const needle = topic.toLowerCase()
          const matches = matchMode === 'exact' ? haystack === needle : haystack.includes(needle)
          if (matches) {
            return {
              text: '',
              wasModified: true,
              redactionCount: 0,
              excludedByRule: `exclude_topic: "${topic}"`,
            }
          }
        }
        break
      }

      case 'exclude_source': {
        const sourceTypes = (rule.config.sourceTypes as string[] | undefined) ?? []
        if (content.sourceType && sourceTypes.includes(content.sourceType)) {
          return {
            text: '',
            wasModified: true,
            redactionCount: 0,
            excludedByRule: `exclude_source: "${content.sourceType}"`,
          }
        }
        break
      }

      case 'exclude_time_range':
      case 'allow_only':
        // SH-1 defines the rule shapes; SH-2 wires behaviour.
        break
    }
  }

  return { text, wasModified, redactionCount }
}

// ─── Preset + Custom Rule CRUD ───────────────────────────────────────────────

/**
 * Set the active privacy preset for a user.
 */
export async function setActivePreset(params: {
  userId: string
  preset: 'private' | 'balanced' | 'open' | 'custom'
}): Promise<void> {
  await db
    .update(indexAccess)
    .set({
      activePreset: params.preset,
      updatedAt: new Date(),
    })
    .where(eq(indexAccess.userId, params.userId))
}

/**
 * Add a custom privacy filter rule.
 */
export async function addCustomRule(params: {
  userId: string
  workspaceId: string
  ruleName: string
  ruleType: string
  ruleConfig: Record<string, unknown>
  scope?: string
  scopeDocumentId?: string
  priority?: number
}): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(privacyFilterRules)
    .values({
      userId: params.userId,
      workspaceId: params.workspaceId,
      ruleName: params.ruleName,
      ruleType: params.ruleType,
      ruleConfig: params.ruleConfig,
      scope: params.scope ?? 'all',
      scopeDocumentId: params.scopeDocumentId ?? null,
      priority: params.priority ?? 0,
    })
    .returning({ id: privacyFilterRules.id })

  return { id: inserted!.id }
}

/**
 * Get all custom rules for a user in a workspace (for settings UI).
 */
export async function getCustomRules(params: {
  userId: string
  workspaceId: string
}): Promise<Array<typeof privacyFilterRules.$inferSelect>> {
  return db
    .select()
    .from(privacyFilterRules)
    .where(
      and(
        eq(privacyFilterRules.userId, params.userId),
        eq(privacyFilterRules.workspaceId, params.workspaceId)
      )
    )
    .orderBy(asc(privacyFilterRules.priority))
}

/**
 * Remove a custom rule by id.
 */
export async function removeCustomRule(ruleId: string): Promise<void> {
  await db.delete(privacyFilterRules).where(eq(privacyFilterRules.id, ruleId))
}
