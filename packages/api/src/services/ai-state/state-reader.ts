import { getImmediateState } from './immediate-updater'
import { getOrCreateState, getOrCreateSharedState } from './state-manager'
import type { AIStateComplete, DocumentSharedState } from '@workspace/shared/types'

/**
 * Read the complete AI state for a user.
 * Two data sources: Redis (immediate layer) + PostgreSQL (event/session/persistent layers).
 * Total latency: ~10-15ms (1 Redis read + 1 PG read).
 */
export async function readFullState(
  userId: string,
  workspaceId: string,
  documentId?: string | null
): Promise<AIStateComplete & { shared?: DocumentSharedState }> {
  // Parallel reads — Redis, PostgreSQL, and optionally shared state
  const [immediate, pgState, sharedState] = await Promise.all([
    getImmediateState(userId, workspaceId),
    getOrCreateState(userId, workspaceId),
    documentId
      ? getOrCreateSharedState(documentId, workspaceId).then((r) => r.state)
      : Promise.resolve(null),
  ])

  return {
    immediate,
    event: pgState.stateEvent,
    session: pgState.stateSession,
    persistent: pgState.statePersistent,
    ...(sharedState ? { shared: sharedState } : {}),
  }
}

/**
 * Format the AI state into a prompt context block.
 * This replaces the 10+ direct DB queries in system-prompt.ts.
 * Target: 500-800 tokens.
 */
export function formatStateForPrompt(
  state: AIStateComplete,
  userName: string,
  workspaceName: string
): string {
  const lines: string[] = []

  // ─── Current focus ───
  if (state.immediate.focus.documentId) {
    const viewDuration = state.immediate.focus.sectionViewStartedAt
      ? Math.round(
          (Date.now() - new Date(state.immediate.focus.sectionViewStartedAt).getTime()) / 1000
        )
      : 0

    lines.push(`## Current Context`)
    lines.push(
      `${userName} is viewing "${state.immediate.focus.documentTitle || 'a document'}".`
    )
    if (state.immediate.focus.sectionRef) {
      lines.push(`Focused on: ${state.immediate.focus.sectionRef} (${viewDuration}s).`)
    }
    lines.push(`Surface: ${state.immediate.focus.surface}.`)
  }

  // ─── Collaborator presence ───
  if (state.immediate.presence.collaborators.length > 0) {
    const active = state.immediate.presence.collaborators
      .map((c: { name: string; section: string | null }) => `${c.name}${c.section ? ` (viewing ${c.section})` : ''}`)
      .join(', ')
    lines.push(`Collaborators present: ${active}.`)
  }

  // ─── Recent activity (from event layer) ───
  const keyEvents = state.event.recentEvents.filter((e: { isKeyChange: boolean }) => e.isKeyChange).slice(0, 5)
  if (keyEvents.length > 0) {
    lines.push(`\n## Recent Key Changes`)
    for (const ev of keyEvents) {
      const ago = formatTimeAgo(ev.timestamp)
      let line = `- [${ev.threadType.toUpperCase()}] ${ev.label} (${ago})`

      // Add reflection annotations if present (Sprint IX-5)
      if (ev.reflection) {
        if (ev.reflection.connection) {
          line += `\n  Connection: ${ev.reflection.connection}`
        }
        if (ev.reflection.tension) {
          line += `\n  Tension: ${ev.reflection.tension}`
        }
      }

      lines.push(line)
    }
  }

  // ─── Active tensions ───
  const activeTensions = state.event.activeTensions.filter((t: { resolvedAt: string | null }) => !t.resolvedAt)
  if (activeTensions.length > 0) {
    lines.push(`\n## Active Tensions`)
    for (const t of activeTensions.slice(0, 3)) {
      const confidence = t.tentative ? ' (tentative)' : ''
      lines.push(`- [${t.severity}] ${t.description}${confidence}`)
    }
  }

  // ─── Active knowledge ───
  if (state.event.activeKnowledge.length > 0) {
    lines.push(`\n## Relevant Knowledge`)
    for (const k of state.event.activeKnowledge.slice(0, 5)) {
      lines.push(`- ${k.fact} (source: ${k.source}, confidence: ${k.confidence})`)
    }
  }

  // ─── Session summary ───
  if (state.session.currentSession.startedAt) {
    const docs = state.session.currentSession.documentsWorkedOn
    const aiCount = state.session.currentSession.aiInteractionCount
    lines.push(`\n## This Session`)
    lines.push(`Active since ${formatTimeAgo(state.session.currentSession.startedAt)}.`)
    if (docs.length > 0) {
      lines.push(`Working on: ${docs.map((d: { title: string }) => d.title).join(', ')}.`)
    }
    if (aiCount > 0) {
      lines.push(`AI interactions this session: ${aiCount}.`)
    }
  }

  // ─── New from team ───
  const unsurfaced = state.session.newFromTeam.filter((m: { surfaced: boolean }) => !m.surfaced)
  if (unsurfaced.length > 0) {
    lines.push(`\n## New From Team`)
    for (const m of unsurfaced.slice(0, 3)) {
      lines.push(`- ${m.fromUserName}: ${m.memory}`)
    }
  }

  // ─── User patterns (from persistent layer) ───
  if (state.persistent.patterns.workStyle) {
    lines.push(`\n## User Patterns`)
    lines.push(`Work style: ${state.persistent.patterns.workStyle}.`)
    if (state.persistent.patterns.aiPreferences.grammarAcceptRate !== null) {
      const grammarRate = Math.round(
        (state.persistent.patterns.aiPreferences.grammarAcceptRate || 0) * 100
      )
      const structRate = Math.round(
        (state.persistent.patterns.aiPreferences.structureAcceptRate || 0) * 100
      )
      lines.push(`AI acceptance: grammar ${grammarRate}%, structure ${structRate}%.`)
    }
  }

  // ─── Shared document context (Sprint IX-6) ───
  if ('shared' in state && state.shared) {
    const shared = state.shared as DocumentSharedState

    if (shared.contributions.length > 1) {
      lines.push(`\n## Document Collaborators`)
      for (const c of shared.contributions.slice(0, 5)) {
        lines.push(
          `- ${c.userName} (${c.role}, ${c.totalEvents} events, last active ${formatTimeAgo(c.lastActiveAt)})`
        )
      }
    }

    const activeKnowledge = shared.knowledge
      .filter((k: { status: string }) => k.status === 'active')
      .slice(0, 5)
    if (activeKnowledge.length > 0) {
      lines.push(`\n## Team Knowledge`)
      for (const k of activeKnowledge) {
        lines.push(`- ${k.fact} (via ${k.contributedByName}, ${k.method})`)
      }
    }

    const disputed = shared.knowledge.filter((k: { status: string }) => k.status === 'disputed')
    if (disputed.length > 0) {
      lines.push(`\n## Disputed`)
      for (const d of disputed) {
        const conflicting = shared.knowledge.find(
          (k: { id: string }) => k.id === d.conflictsWith
        )
        if (conflicting) {
          lines.push(
            `- "${d.fact}" (${d.contributedByName}) vs "${conflicting.fact}" (${conflicting.contributedByName})`
          )
        }
      }
    }

    const sharedTensions = shared.tensions
      .filter((t: { resolvedAt: string | null }) => !t.resolvedAt)
      .slice(0, 3)
    if (sharedTensions.length > 0) {
      lines.push(`\n## Cross-Team Tensions`)
      for (const t of sharedTensions) {
        lines.push(`- [${t.severity}/${t.type}] ${t.description}`)
      }
    }

    if (shared.aiUsage.totalInteractions > 0) {
      lines.push(`\n## Document AI Usage`)
      lines.push(
        `${shared.aiUsage.totalInteractions} AI interactions, ${Math.round(shared.aiUsage.acceptanceRate * 100)}% acceptance. Sections with AI: ${shared.aiUsage.sectionsWithAIContent.join(', ') || 'none'}.`
      )
    }
  }

  return lines.join('\n')
}

function formatTimeAgo(isoString: string): string {
  const seconds = Math.round((Date.now() - new Date(isoString).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}
