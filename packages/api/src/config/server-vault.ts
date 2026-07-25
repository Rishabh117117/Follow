/**
 * Server-side Feature Vault — API equivalent of apps/web/src/config/feature-vault.ts
 *
 * Shape mirrors the web vault so the two files read as siblings. The web vault
 * gates UI pages; this vault gates server behaviors (background schedulers,
 * route registrations, service boot paths).
 *
 * To activate a gated surface:
 *   1. Flip `active: true` on the flag here.
 *   2. Restart the API server (changes are read at startup, not at runtime).
 */

export interface ServerVaultFeature {
  id: string
  name: string
  description: string
  active: boolean
  category: 'scheduler' | 'route' | 'service'
}

export const SERVER_VAULT: Record<string, ServerVaultFeature> = {
  /**
   * Live slice sync scheduler — 2-min catch-up pass over live `shared_slices`.
   *
   * Writes `shared_slices` + `slice_sync_events`. `shared_slices` is read by
   * MCP `get_activity` directly and written by MCP `contribute`. This
   * scheduler is a correctness safety net behind the event-driven
   * `sync-trigger` (catches missed events from races, cross-workspace
   * scenarios, process restarts). Keeping on so live slices don't go stale.
   */
  'scheduler-sync': {
    id: 'scheduler-sync',
    name: 'Live Slice Sync Scheduler',
    description: 'Periodic catch-up pass for live shared_slices (2-min interval).',
    active: true,
    category: 'scheduler',
  },

  'route-chat': {
    id: 'route-chat',
    name: 'Chat Routes',
    description: 'In-app chat HTTP endpoints (/api/chat).',
    // ItemsView (Follow dashboard) lists conversations via
    // GET /api/chat/conversations — with this flag off, the route 404s and
    // the dashboard renders zero conversations even when the sidebar count
    // (from /api/indexes DB queries) shows otherwise.
    active: true,
    category: 'route',
  },

  // ─── Pipeline-role LLM gates (2026-04-29) ─────────────────────────────────
  // The canonical pipeline roles each have a feature flag. When OFF, the
  // legacy heuristic / no-op path runs; when ON, the LLM call site fires.
  // Lets operators stage rollout role-by-role and watch cost/quality before
  // committing the whole pipeline to LLM-driven decisions.

  'pipeline-analyst-llm': {
    id: 'pipeline-analyst-llm',
    name: 'Analyst — LLM edge classification',
    description:
      'Replace the heuristic classifyLinkType in indexer.ts with an LLM call to ' +
      'MODEL_TIERS.ANALYST that classifies candidate edges (references/supports/' +
      'contradicts/elaborates/supersedes/none) with a stored reason. ANALYST-ON-1 ' +
      '(2026-06-16) made it production-ready — the model now sees BOTH record texts ' +
      '(FIX-1) and pairs are classified with bounded concurrency (FIX-2a). Still ' +
      'OFF pending the PRE-1 facet-separation gate + PRE-2 cost confirm on the live ' +
      'deploy (run scripts/preflight/facet-separation.ts against the prod DB first). ' +
      'Rollback = flip off → the cosine + thread-type classifyLinkType heuristic ' +
      'runs verbatim (FIX-1/FIX-2a are no-ops when off). CONTRADICT-1 (2026-06-19) ' +
      'turned this ON on the branch + bridged the contradicts edges to a surface ' +
      '(services/contradictions/edges.ts → detect_contradictions). NOT yet merged ' +
      'to prod — gated on the contradiction example + cost review.',
    active: true,
    category: 'service',
  },

  'pipeline-editor-llm': {
    id: 'pipeline-editor-llm',
    name: 'Editor — LLM node scoring',
    description:
      'Run MODEL_TIERS.EDITOR on each node the Archivist promotes, populating editor_confidence/importance/salience/freshness columns. Default off.',
    active: false,
    category: 'service',
  },

  // ─── Anchor substrate (ANCHOR-1, 2026-06-02) ──────────────────────────────
  'node-anchors': {
    id: 'node-anchors',
    name: 'Node anchors',
    description:
      'When on, the indexer writes an Anchor (versioned meaning + span + facet embeddings) alongside each index_records row. Default off — zero pipeline behavior change; legacy records remain readable as low-weight retro-anchors.',
    active: false,
    category: 'service',
  },

  // ─── Pipeline graph harness (GRAPH-1, 2026-06-02 · GRAPH-WIRE-1, 2026-06-16) ─
  'pipeline-graph': {
    id: 'pipeline-graph',
    name: 'Pipeline graph',
    description:
      'GRAPH-WIRE-1 (2026-06-16): the queue consolidation path (archivist_run / ' +
      'profiler_run) now runs through single-role LangGraph entries with the ' +
      'Postgres checkpointer for durable/resumable runs. Outputs are identical ' +
      'to the legacy direct calls (same compute/commit role, DB-driven). The ' +
      'dev-graph route still renders the shadow router + nodeLog. Rollback: set ' +
      'PIPELINE_GRAPH_DISABLE=1 (reverts runner to direct calls) and flip this ' +
      'flag off.',
    active: true,
    category: 'service',
  },
}

export function isServerFeatureActive(flagId: string): boolean {
  return SERVER_VAULT[flagId]?.active ?? false
}

export function getServerVaultFlags(): ServerVaultFeature[] {
  return Object.values(SERVER_VAULT)
}

export function getInactiveServerFlags(): ServerVaultFeature[] {
  return Object.values(SERVER_VAULT).filter((f) => !f.active)
}
