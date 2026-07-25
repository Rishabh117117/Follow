/**
 * MCP Tool: scope_configure (Sprint SCOPE-LIVECTX-1)
 *
 * User-decided scope composition for the active MCP session. Not to be
 * confused with `set_scope`, which switches the coarse project/personal
 * index. This tool operates on the fine-grained Boundary[] model.
 *
 * Actions:
 *   set             — replace active scope with provided boundaries
 *   adjust          — merge boundaries into active scope (by dimension)
 *   pause / resume  — toggle scope without discarding boundaries
 *   end             — clear active scope
 *   list_presets    — return user's saved preset scopes
 *   save_preset     — persist current or provided boundaries as preset
 *
 * Wegner invariant: all mutations are user-initiated. The AI may call this
 * tool ONLY when the user has explicitly asked for a scope change.
 */

import type {
  MCPToolDefinition,
  MCPToolResult,
  MCPSession,
  MCPDependencies,
} from '../types'
import {
  buildScopeFromBoundaries,
  validateScopeBoundaries,
  serializeScopeToJson,
  resolveAgainstGovernance,
  loadGovernanceSnapshot,
  getActiveScope,
  setActiveScope,
  pauseActiveScope,
  resumeActiveScope,
  endActiveScope,
  listUserPresets,
  savePreset,
  getPresetById,
  type Boundary,
  type Scope,
  type ScopeConflict,
  type ScopeMode,
} from '../../services/scope'

/** Session token convention for MCP-driven scope. */
export function mcpSessionToken(session: MCPSession): string {
  return `mcp:${session.userId}:${session.workspaceId}`
}

export const scopeConfigureTool: MCPToolDefinition = {
  name: 'scope_configure',
  description:
    "Compose, adjust, pause/resume, or end the session scope using Boundary[]. Also lists and saves preset scopes. User-decided only — do not call unless the user has explicitly asked for a scope change. This is a fine-grained filter; `set_scope` still switches the coarse project/personal index.",
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['set', 'adjust', 'pause', 'resume', 'end', 'list_presets', 'save_preset'],
        description: 'Which scope action to perform.',
      },
      boundaries: {
        type: 'array',
        description:
          'Array of Boundary objects. Required for set/adjust/save_preset (unless save_preset snapshots the active scope).',
        items: { type: 'object' },
      },
      presetId: { type: 'string', description: 'UUID of a saved preset (for action=set from preset).' },
      presetName: { type: 'string', description: 'Name for save_preset.' },
      mode: {
        type: 'string',
        enum: ['live', 'static'],
        description: "Scope mode. Default 'static'. 'live' requires explicit opt-in and wires live context delivery.",
      },
    },
    required: ['action'],
  },
  handler: scopeConfigureHandler,
}

async function scopeConfigureHandler(
  params: Record<string, unknown>,
  session: MCPSession,
  _deps: MCPDependencies
): Promise<MCPToolResult> {
  const action = params.action as string
  const boundaries = (params.boundaries as Boundary[] | undefined) ?? undefined
  const presetId = params.presetId as string | undefined
  const presetName = params.presetName as string | undefined
  const mode = (params.mode as ScopeMode | undefined) ?? 'static'

  const sessionToken = mcpSessionToken(session)

  try {
    switch (action) {
      case 'set':
        return await handleSet(session, sessionToken, { boundaries, presetId, mode })
      case 'adjust':
        return await handleAdjust(session, sessionToken, { boundaries, mode })
      case 'pause':
        await pauseActiveScope(sessionToken)
        return textResult('Scope paused. Queries will run unscoped until you resume.')
      case 'resume':
        await resumeActiveScope(sessionToken)
        return textResult('Scope resumed.')
      case 'end':
        await endActiveScope(sessionToken)
        return textResult('Scope ended. Future queries run without boundary filtering.')
      case 'list_presets':
        return await handleListPresets(session)
      case 'save_preset':
        return await handleSavePreset(session, sessionToken, { boundaries, presetName })
      default:
        return textResult(`Unknown action: ${action}`, { isError: true })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[MCP scope_configure] failed:', err)
    // Non-blocking per sprint constraint #5 — degrade to unscoped with warning.
    return textResult(
      `Scope configuration failed: ${msg}. Continuing in unscoped mode. Retry when ready.`,
      { isError: true }
    )
  }
}

// ─── Action handlers ─────────────────────────────────────────────────────────

async function handleSet(
  session: MCPSession,
  sessionToken: string,
  opts: { boundaries?: Boundary[]; presetId?: string; mode: ScopeMode }
): Promise<MCPToolResult> {
  let effectiveBoundaries = opts.boundaries ?? []
  let scopeDefinitionId: string | undefined
  let presetName: string | undefined

  if (opts.presetId) {
    const preset = await getPresetById(opts.presetId)
    if (!preset) return textResult(`Preset ${opts.presetId} not found.`, { isError: true })
    effectiveBoundaries = preset.boundaries
    scopeDefinitionId = opts.presetId
    presetName = preset.name
  }

  const validation = validateScopeBoundaries(effectiveBoundaries)
  if (!validation.valid) {
    return conflictResult(validation.conflicts, 'Scope rejected due to internal contradictions.')
  }

  const scope = buildScopeFromBoundaries({
    userId: session.userId,
    workspaceId: session.workspaceId,
    boundaries: effectiveBoundaries,
    name: presetName,
    mode: opts.mode,
  })

  const governance = await loadGovernanceSnapshot({
    userId: session.userId,
    workspaceId: session.workspaceId,
  })
  const resolved = resolveAgainstGovernance(scope, governance)

  await setActiveScope(sessionToken, resolved.scope, { scopeDefinitionId })

  // If mode=live, wire live context delivery (non-blocking).
  if (opts.mode === 'live') {
    try {
      const { activateLiveContext } = await import('../../services/live-context/activate')
      await activateLiveContext({
        scope: resolved.scope,
        sessionToken,
        userId: session.userId,
        workspaceId: session.workspaceId,
      })
    } catch (err) {
      console.warn('[MCP scope_configure] live activation failed (non-blocking):', err)
    }
  }

  return scopeResult(resolved.scope, resolved.conflicts, 'Scope set.')
}

async function handleAdjust(
  session: MCPSession,
  sessionToken: string,
  opts: { boundaries?: Boundary[]; mode: ScopeMode }
): Promise<MCPToolResult> {
  if (!opts.boundaries || opts.boundaries.length === 0) {
    return textResult('Adjust requires a boundaries array.', { isError: true })
  }

  const current = await getActiveScope(sessionToken, session.userId)
  const baseBoundaries = current?.boundaries ?? []

  // Merge: new boundaries override by dimension+op pair.
  const keyOf = (b: Boundary) => `${b.dimension}:${b.op}:${b.name ?? ''}`
  const mergedMap = new Map<string, Boundary>()
  for (const b of baseBoundaries) mergedMap.set(keyOf(b), b)
  for (const b of opts.boundaries) mergedMap.set(keyOf(b), b)
  const merged = [...mergedMap.values()]

  const validation = validateScopeBoundaries(merged)
  if (!validation.valid) {
    return conflictResult(validation.conflicts, 'Adjustment rejected due to contradictions.')
  }

  const scope = buildScopeFromBoundaries({
    userId: session.userId,
    workspaceId: session.workspaceId,
    boundaries: merged,
    name: current?.name,
    mode: opts.mode,
  })

  const governance = await loadGovernanceSnapshot({
    userId: session.userId,
    workspaceId: session.workspaceId,
  })
  const resolved = resolveAgainstGovernance(scope, governance)
  await setActiveScope(sessionToken, resolved.scope)

  return scopeResult(resolved.scope, resolved.conflicts, 'Scope adjusted.')
}

async function handleListPresets(session: MCPSession): Promise<MCPToolResult> {
  const presets = await listUserPresets(session.userId, session.workspaceId)
  if (presets.length === 0) {
    return textResult('No saved presets. Use action=save_preset to create one.')
  }

  const lines = presets.map(
    (p) => `- ${p.name} (${p.boundaries.length} boundaries) — id: ${p.definitionId}`
  )
  return textResult(`Saved scope presets:\n${lines.join('\n')}`)
}

async function handleSavePreset(
  session: MCPSession,
  sessionToken: string,
  opts: { boundaries?: Boundary[]; presetName?: string }
): Promise<MCPToolResult> {
  if (!opts.presetName || opts.presetName.trim().length === 0) {
    return textResult('save_preset requires presetName.', { isError: true })
  }

  let bs = opts.boundaries
  if (!bs || bs.length === 0) {
    const current = await getActiveScope(sessionToken, session.userId)
    bs = current?.boundaries ?? []
  }
  if (bs.length === 0) {
    return textResult('Nothing to save — no boundaries provided and no active scope.', {
      isError: true,
    })
  }

  const id = await savePreset({
    userId: session.userId,
    workspaceId: session.workspaceId,
    name: opts.presetName,
    boundaries: bs,
  })

  return textResult(`Preset '${opts.presetName}' saved (id: ${id}).`)
}

// ─── Result helpers ──────────────────────────────────────────────────────────

function textResult(text: string, opts: { isError?: boolean } = {}): MCPToolResult {
  return { content: [{ type: 'text', text }], isError: opts.isError }
}

function scopeResult(scope: Scope, conflicts: ScopeConflict[], prefix: string): MCPToolResult {
  let text = `${prefix}\n\n[SCOPE]\n${serializeScopeToJson(scope)}`
  if (conflicts.length > 0) {
    text += `\n\n[CONFLICTS]\n${JSON.stringify(conflicts, null, 2)}`
    text += '\n\nGovernance wins: blocked boundaries are NOT applied. Complete the resolution next_step and retry.'
  }
  return { content: [{ type: 'text', text }] }
}

function conflictResult(conflicts: ScopeConflict[], prefix: string): MCPToolResult {
  return {
    content: [
      {
        type: 'text',
        text: `${prefix}\n\n[CONFLICTS]\n${JSON.stringify(conflicts, null, 2)}`,
      },
    ],
    isError: true,
  }
}
