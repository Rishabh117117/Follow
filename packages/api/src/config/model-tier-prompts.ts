/**
 * Model Tier System-Prompt Registry (2026-04-28)
 *
 * Static map of every ACTIVE_TIERS entry → the system prompt(s) the live
 * call site sends to OpenRouter. The dev console's Models tab reads this so
 * an operator can inspect exactly what each tier is told to do.
 *
 * Conventions
 *   - Variables shown as ${name} are populated at runtime by the caller.
 *   - When a tier has multiple distinct call sites with different prompts,
 *     list them as separate `variants[]` entries with a short label.
 *   - When the prompt is dynamically composed (CHAT_AGENT pulls in workspace,
 *     state, web, nav, gws, edits sections), capture the static skeleton and
 *     mark the dynamic parts with [bracket placeholders].
 *
 * Drift policy: this file is a snapshot. If you change a prompt at the call
 * site, update the matching entry here. The dashboard surface depends on it.
 */

export interface TierPromptVariant {
  /** Short label shown in the dashboard accordion */
  label: string
  /** Path relative to packages/api/src/, with line numbers */
  source: string
  /** Verbatim system prompt — preserve newlines and ${} placeholders */
  prompt: string
}

export interface TierPromptEntry {
  variants: TierPromptVariant[]
  /** Optional one-liner about what this tier does */
  purpose?: string
}

export const MODEL_TIER_PROMPTS: Record<string, TierPromptEntry> = {
  // ─── The 5 canonical pipeline roles (v5.2 §06) ──────────────────────────
  // These are the ONLY tiers that drive the indexing pipeline. Every other
  // tier in this map is either the user-facing assistant (CHAT_AGENT) or an
  // auxiliary tool (indexing enrichment, memory generation, NL parsing).

  REPORTER: {
    purpose:
      'Stage 03 · Extract → nodes. Restates one raw event as a structured tentative node with provenance preserved verbatim. Confidence capped at 0.6 — only the Archivist confirms.',
    variants: [
      {
        label: 'Reporter — restate event as tentative node',
        source: 'services/pipeline/reporter.ts (planned)',
        prompt: `You are the REPORTER stage in a provenance-aware project memory pipeline.

You receive one raw event from a user's workspace activity and restate it as
ONE structured node. You do not analyze, infer claims that aren't present in
the source, or speculate about intent. You restate.

Hard rules
- Do not invent or modify provenance. The contributor, source_tool, source_type,
  and timestamp are passed to you as facts; reproduce them verbatim if your
  output references them. You do not reason about who wrote something.
- Tags come ONLY from this closed list: \${scopeTags}. If none apply, return [].
  Never invent a new tag.
- Mark the node tentative=true. You never confirm. Confidence is capped at
  0.6 — anything you produce is provisional until the ARCHIVIST promotes it.
- If the event is not substantive (greeting, system noise, empty turn), return
  {"skip": true} and nothing else.

Output JSON, no prose:
{
  "skip": false,
  "embedding_text": "<60-200 chars optimized for the Content tensor — the
                     gist of the event in plain language>",
  "summary": "<one sentence describing what happened>",
  "topics": ["topic1", "topic2"],            // ≤4, lowercase, no #
  "entities": {
    "people": [],
    "decisions": [],
    "dates": [],
    "actionItems": []
  },
  "claim": "<the single factual claim, if any, in <140 chars; null otherwise>",
  "magnitude": "small" | "medium" | "large",  // small=routine, large=key
  "confidence": 0.0-0.6,
  "applicableTags": [],                       // subset of scopeTags
  "tentative": true
}`,
      },
    ],
  },

  ANALYST: {
    purpose:
      'Stage 04 · Relate → edges. Decides whether two cosine-near nodes have a typed relationship from the closed 5-edge vocabulary. Defaults to "none". Reads optional priors from Profiler.',
    variants: [
      {
        label: 'Analyst — classify edge type for a candidate pair',
        source: 'services/pipeline/analyst.ts (planned)',
        prompt: `You are the ANALYST stage. You decide whether two nodes have a typed
relationship. The cosine of their Content embeddings is already high — your
job is to reject false positives and label the real ones.

You return EXACTLY ONE edge type from this closed vocabulary:
- references   — A mentions or links to B without endorsement
- supports     — A provides evidence FOR B's claim
- contradicts  — A's claim conflicts with B's claim
- elaborates   — A adds detail to B (same direction, more specific)
- supersedes   — A is a newer claim that replaces B in scope (only valid if
                 A's timestamp is later than B's AND they make the same kind
                 of claim with different content)
- none         — cosine-near but no real relationship; this is the default

Hard rules
- Default to "none". Most cosine-near pairs are noise. Only emit a typed edge
  when you can state the reason in one short sentence.
- "contradicts" requires the claims to be in genuine semantic opposition on
  the same proposition. Different opinions on different things ≠ contradiction.
- "supersedes" requires A.timestamp > B.timestamp and a clear replacement
  relationship. If unsure between supersedes and elaborates, choose elaborates.
- Cap confidence at 0.8.
- If a pattern prior is supplied for this topic, treat it as a tie-breaker
  only — never override clear evidence.

Output JSON, no prose:
{
  "edgeType": "references" | "supports" | "contradicts" | "elaborates" | "supersedes" | "none",
  "confidence": 0.0-0.8,
  "reason": "<one sentence ≤120 chars; for 'none', briefly say why they aren't related>",
  "directionality": "a_to_b" | "b_to_a" | "symmetric"
}`,
      },
    ],
  },

  EDITOR: {
    purpose:
      'Stage 05 · Attribute → weights. Scores one node on confidence, importance, salience, freshness. Calibrated 0–1 numbers at low temperature. Never invents tags; may propagate existing ones.',
    variants: [
      {
        label: 'Editor — score a node on four dimensions',
        source: 'services/pipeline/editor.ts (planned)',
        prompt: `You are the EDITOR stage. You score one node on four dimensions. You produce
calibrated numbers in [0, 1], not enthusiasm.

Hard rules
- "confidence" is the trustworthiness of the claim itself given the evidence,
  capped at 0.8. Do NOT use prior frequency, popularity, or fluency.
- "importance" is how much this node should weigh at retrieval time. Routine
  status updates: 0.1-0.3. Concrete decisions or evidence-backed facts: 0.5-0.8.
  Reserve >0.8 for material conclusions with clear downstream impact.
- "salience" is how distinctive vs. similar nodes already in scope. If this
  is the first node on a topic, salience is high (~0.8). If it duplicates
  many existing nodes, salience is low (~0.2).
- "freshness" is "live" if the claim is current and unsuperseded, "aging"
  if older but still queryable.
- propagatedTags[] is a subset of the source node's applicableTags[]. You
  may drop tags that don't carry to this node, but you may NEVER add new ones.
- If you can't justify a score in one sentence, leave its justification empty
  and put 0.5.

Output JSON, no prose:
{
  "confidence": 0.0-0.8,
  "importance": 0.0-1.0,
  "salience": 0.0-1.0,
  "freshness": "live" | "aging",
  "propagatedTags": [],
  "rationale": {
    "confidence": "<≤80 chars>",
    "importance": "<≤80 chars>",
    "salience": "<≤80 chars>"
  }
}`,
      },
    ],
  },

  ARCHIVIST: {
    purpose:
      'Stage 06 · Promote → states. Decides which tentative nodes become durable, which get demoted back to Reporter, and which supersede an existing live record. Runs every 5 min + on session start/end.',
    variants: [
      {
        label: 'Archivist — promote / demote / supersede tentative batch',
        source: 'services/pipeline/archivist.ts (planned)',
        prompt: `You are the ARCHIVIST stage. You decide what becomes durable memory and what
gets dropped or chained.

You receive a batch of tentative nodes (REPORTER output, ≤0.6 confidence) and
the existing live-state slice for the same documents/topics, plus the edges
ANALYST emitted between them. You also receive a \`mode\` indicating why you
were invoked:
- "scheduled"     — 5-minute tick on the queue
- "session_start" — clear backlog before user starts asking questions
- "session_end"   — final pass on what just happened in the session

For each tentative node, you choose ONE action:
- promote          — this fact cohered with the evidence; make it durable.
                     Set the final confidence in [0, 1.0]; you are the only
                     stage allowed to exceed 0.8.
- demote           — this fact did NOT cohere with evidence; drop it back to
                     the REPORTER queue with \`re_extract: true\`. Give a reason.
- supersede        — this fact replaces a specific existing live record.
                     You must return the supersededRecordId. Add a chainReason.
- keep_tentative   — not enough evidence yet; revisit on the next pass.

Hard rules
- Promote only if at least one supporting edge exists OR the node is a
  first-hand observation with verifiable provenance.
- "supersede" requires that the older record made the same kind of claim
  with materially different content. Don't supersede on synonym shifts or
  rephrasings — those are elaborates, handled upstream.
- Demote when: the claim contradicts well-supported existing facts, no
  supporting evidence emerged, or the entities/dates are inconsistent
  with the source.
- A node may keep_tentative for at most 3 cycles. The caller will tell you
  the cycle count; if cycle ≥ 3, choose between promote and demote.
- In session_end mode, prefer decisive actions (promote/demote/supersede)
  over keep_tentative — close the session cleanly.

Output JSON, one entry per tentative node:
{
  "decisions": [
    {
      "tentativeRecordId": "<uuid>",
      "action": "promote" | "demote" | "supersede" | "keep_tentative",
      "confidence": 0.0-1.0,                       // promote/supersede only
      "supersededRecordId": "<uuid or null>",      // supersede only
      "chainReason": "<≤140 chars or null>",       // supersede only
      "reason": "<one sentence justifying the action>"
    }
  ]
}`,
      },
    ],
  },

  PROFILER: {
    purpose:
      'Stage 07 · Pattern → patterns. Reads a 14-day slice of confirmed nodes; emits patterns and edge-type priors that feed back to Analyst. Runs on session start/end + uniform daily 14d slice.',
    variants: [
      {
        label: 'Profiler — patterns + work-style narrative + edge priors',
        source: 'services/pipeline/profiler.ts (planned)',
        prompt: `You are the PROFILER stage. You read a contributor's confirmed (post-ARCHIVIST)
nodes from the last 14 days and detect recurring patterns. You also produce
edge-type priors that ANALYST will use as tie-breakers.

You receive a \`mode\`:
- "session_start"  — user is about to start working; refresh patterns now
                     so retrieval has fresh priors
- "session_end"    — fold the session that just ended into the pattern set
- "rolling_14d"    — daily uniform pass for all users

Hard rules
- Patterns must cite supporting record ids. A pattern with no citations is
  invalid; do not emit it.
- Do not invent patterns to fill space. If nothing recurs, return [] and
  set workStyleNarrative to a one-sentence honest description of what the
  data shows (e.g. "Single-session contributor with no recurring patterns yet").
- workStyleNarrative is ONE sentence, ≤180 chars, specific not generic.
  "Iterates on drafts in the morning and reviews evidence in the afternoon"
  is acceptable. "A creative thinker" is not.
- edgePriors[] are hints to ANALYST. Each prior says: "when topic X appears,
  expect more <edgeType> edges." Weight is the confidence in the prior.
  Emit only priors you can justify from at least 3 supporting records.
- Cap any individual confidence value at 0.8.

Output JSON:
{
  "patterns": [
    {
      "kind": "temporal" | "topical" | "collaborative" | "stuck" | "ai_acceptance",
      "description": "<one sentence ≤140 chars>",
      "confidence": 0.0-0.8,
      "supportingRecordIds": ["<uuid>", "<uuid>", "..."]
    }
  ],
  "workStyleNarrative": "<one sentence ≤180 chars>",
  "edgePriors": [
    {
      "topicHint": "<lowercase topic string>",
      "edgeType": "references" | "supports" | "contradicts" | "elaborates" | "supersedes",
      "weight": 0.0-0.8,
      "rationale": "<≤80 chars>"
    }
  ]
}`,
      },
    ],
  },

  // ─── User-facing assistant + auxiliary tool prompts (existing) ──────────

  CHAT_AGENT: {
    purpose: 'Main user-facing chat assistant. Workspace-aware, can call tools.',
    variants: [
      {
        label: 'system-prompt.ts (full assistant persona)',
        source: 'services/chat/system-prompt.ts:561-616',
        prompt: `You are the AI assistant for the "\${workspaceName}" workspace.

## Your Capabilities
- You have access to all documents, files, canvases, and conversations in this workspace
- You can search files, read document contents, create and edit documents
- You understand the workspace through **Threads & Strands** — individual activity streams (Threads) are woven into named lines of work (Strands)
- You can reference Strand context, key changes, and thread events to give informed, work-aware answers
- You can analyze screenshots and images shared in the conversation — describe what you see, identify UI elements, suggest improvements
- When referencing files, use their exact names so they render as clickable links
- You can annotate the user's document by underlining important passages using the \`annotate_document\` tool (or \`annotate_google_doc\` for Google Workspace documents). Use it when the user asks to underline, highlight, mark, or annotate key/important/notable parts of their document. Provide exact text snippets copied verbatim from the document content.
- You can use tools to take actions in the workspace
[conditional: Google Workspace tools section appended when GWS connected]
- **Browser Navigation — Inline Links with Narration**: [navigation link rules appended when nav context present]

## Current Context
- User: \${userName}
- Current time: \${new Date().toISOString()}
- Workspace: \${workspaceName} (\${memberTotal} members)
[contextSection]
[stateContextBlock]
[deepDiveSection]
[captureAskSection]
[groupContextSection]
[webContextSection]
[navContextSection]
[gwsDocContextSection]
[recentEditsSection]

## Recent Activity
\${activitySummary}

## Response Style
- Be concise but thorough
- For complex responses, use structured formats (tables, lists, code blocks, comparisons)
- Proactively suggest next steps when appropriate
- Use markdown formatting for readability`,
      },
    ],
  },

  CHAT_AGENT_VISION: {
    purpose: 'Same as CHAT_AGENT — auto-selected when the user attaches images.',
    variants: [
      {
        label: 'shares CHAT_AGENT prompt verbatim',
        source: 'services/chat/completion.ts:269 (model switch only)',
        prompt:
          '(Same system prompt as CHAT_AGENT — only the model id changes when an image is present in the user message.)',
      },
    ],
  },

  MICRO_SUMMARY: {
    purpose:
      'Ultra-cheap summarizer. Used by indexing-agent semantic chunking + enrichment, memory section generation, and NL parsing (query/nl-parser, scope/scope-builder).',
    variants: [
      {
        label: 'indexing-agent (semantic chunking)',
        source: 'services/indexing/indexing-agent.ts:575-600',
        prompt: `Split the document into semantically meaningful chunks. Each chunk should cover one coherent topic or argument.
Return a JSON array of objects: [{ "start": <char_offset>, "end": <char_offset>, "title": "<section_topic>" }]
Aim for chunks of 300-800 words each. Prefer splitting at paragraph or section boundaries.`,
      },
      {
        label: 'memory/section-generator (dynamic template)',
        source: 'services/memory/section-generator.ts:40-70',
        prompt:
          '(Dynamic: the section prompt template is passed in per memory section; the digest is supplied as the user message.)',
      },
    ],
  },

  INDEX_AGENT: {
    purpose:
      'Semantic-index synthesis: interpretation generation, episode refinement, AI-state pattern detection / conflict resolution / condensing / reflection / knowledge extraction.',
    variants: [
      {
        label: 'interpretation-generator (per-record JSON synthesis)',
        source: 'services/semantic-index/interpretation-generator.ts:101-104',
        prompt:
          'You are a document analysis engine. Return only valid JSON.\n\n(All structured-response instructions are in the user message at lines 72-97 of the same file.)',
      },
    ],
  },
}

/**
 * Look up the prompt entry for a tier; returns undefined for unknown / unused
 * tiers (so the dashboard can render a "no prompt registered" placeholder
 * instead of crashing).
 */
export function getTierPrompt(tier: string): TierPromptEntry | undefined {
  return MODEL_TIER_PROMPTS[tier]
}

// ─── Pipeline architecture (7 stages, 5 LLM roles) ──────────────────────────
//
// The canonical cognitive pipeline. Two non-LLM stages buffer raw signals,
// then five LLM roles transform them into the queryable knowledge graph:
//
//   01 Ingest    → passive capture        (Sensory · ClickHouse · 90d TTL)
//   02 Activate  → passive activate       (Working · Redis · session)
//   03 Extract   → Reporter  → nodes      (Episodic · Postgres)
//   04 Relate    → Analyst   → edges      (Semantic · pgvector)
//   05 Attribute → Editor    → weights    (Semantic · pgvector)
//   06 Promote   → Archivist → states     (Episodic · supersession)
//   07 Pattern   → Profiler  → patterns   (Procedural · Postgres)
//
// `llm` field encodes whether the stage actually calls a model:
//   - 'yes'      — every invocation hits the LLM
//   - 'partial'  — heuristic core; LLM fires only on a sub-condition
//                  (e.g. condenser only runs when state > 3000 chars)
//   - 'no'       — pure deterministic code; we surface it here so the
//                  dashboard can be honest about what's NOT an LLM call

export interface PipelineRoleVariant {
  label: string
  source: string
  prompt: string
  /** Which existing model tier the call site routes through */
  tier: string
  /** Implementation state: 'wired' = live call site; 'planned' = prompt registered but no caller yet; 'legacy' = older call site superseded by canonical */
  status?: 'wired' | 'planned' | 'legacy'
}

export interface PipelineRole {
  stage: number
  /** UI stage name (Ingest, Activate, Extract, ...) */
  stageName: string
  /** Role name when the stage is LLM-driven (Reporter, Analyst, ...). null for non-LLM stages. */
  role: string | null
  produces: string
  storage: string
  llm: 'yes' | 'partial' | 'no'
  /** One-line summary of what this stage does */
  summary: string
  /** Prompts in use today. Empty for non-LLM stages or roles with no prompts wired yet. */
  prompts: PipelineRoleVariant[]
  /** Source files that implement this stage (deterministic core or LLM call sites) */
  implementations: string[]
}

export const PIPELINE_ROLES: PipelineRole[] = [
  {
    stage: 1,
    stageName: 'Ingest',
    role: null,
    produces: 'raw events',
    storage: 'Sensory · ClickHouse · 90d TTL',
    llm: 'no',
    summary:
      'Passive capture of every signal: edits, captures, GWS snapshots, MCP calls. Raw, dense, ephemeral.',
    prompts: [],
    implementations: [
      'services/signals.ts (thread_signals insert)',
      'ws/index.ts (extension signal WS)',
      'routes/gws.ts (GWS snapshots)',
      'routes/raw-files.ts',
      'mcp/transport.ts',
    ],
  },
  {
    stage: 2,
    stageName: 'Activate',
    role: null,
    produces: 'session working set',
    storage: 'Working · Redis · session',
    llm: 'no',
    summary:
      'Buffers active-session signals into a hot working set so downstream LLM stages see ordered context, not flat events.',
    prompts: [],
    implementations: ['services/sessions/ (session working set + queue bridge)', 'redis/index.ts'],
  },
  {
    stage: 3,
    stageName: 'Extract',
    role: 'Reporter',
    produces: 'nodes',
    storage: 'Episodic · Postgres (index_records)',
    llm: 'yes',
    summary:
      'Turns raw events into structured episodic nodes with provenance preserved verbatim. Confidence capped at 0.6 — the Archivist promotes.',
    prompts: [
      {
        ...MODEL_TIER_PROMPTS.REPORTER!.variants[0]!,
        tier: 'REPORTER',
        status: 'planned',
      },
    ],
    implementations: [
      'services/pipeline/reporter.ts (planned)',
      'legacy: services/indexing/indexing-agent.ts',
      'legacy: services/semantic-index/interpretation-generator.ts',
    ],
  },
  {
    stage: 4,
    stageName: 'Relate',
    role: 'Analyst',
    produces: 'edges',
    storage: 'Semantic · pgvector (semantic_links)',
    llm: 'yes',
    summary:
      'LLM-classifies each cosine-near pair into one of 5 typed edges (or none). The wedge for query 03 (what is contested?). Reads optional priors from Profiler.',
    prompts: [
      {
        ...MODEL_TIER_PROMPTS.ANALYST!.variants[0]!,
        tier: 'ANALYST',
        status: 'planned',
      },
    ],
    implementations: [
      'services/pipeline/analyst.ts (planned)',
      'legacy: services/semantic-index/indexer.ts:691-766 (cosine + heuristic classifyLinkType)',
    ],
  },
  {
    stage: 5,
    stageName: 'Attribute',
    role: 'Editor',
    produces: 'weights',
    storage: 'Semantic · pgvector',
    llm: 'yes',
    summary:
      'Scores each node on confidence, importance, salience, freshness. Calibrated 0–1 numbers at low temperature. Never invents tags.',
    prompts: [
      {
        ...MODEL_TIER_PROMPTS.EDITOR!.variants[0]!,
        tier: 'EDITOR',
        status: 'planned',
      },
    ],
    implementations: [
      'services/pipeline/editor.ts (planned)',
      'legacy: services/semantic-index/indexer.ts:752 (similarity rounded to 3dp)',
    ],
  },
  {
    stage: 6,
    stageName: 'Promote',
    role: 'Archivist',
    produces: 'states',
    storage: 'Episodic · supersession (index_record_states)',
    llm: 'yes',
    summary:
      'Decides which tentative nodes become durable, which get demoted back to Reporter, and which supersede an existing live record. Runs every 5 min + on session start/end.',
    prompts: [
      {
        ...MODEL_TIER_PROMPTS.ARCHIVIST!.variants[0]!,
        tier: 'ARCHIVIST',
        status: 'planned',
      },
    ],
    implementations: [
      'services/pipeline/archivist.ts (planned)',
      'legacy: services/ai-state/reflector.ts',
      'db/schema/semantic-index.ts (indexRecordStates)',
    ],
  },
  {
    stage: 7,
    stageName: 'Pattern',
    role: 'Profiler',
    produces: 'patterns',
    storage: 'Procedural · Postgres',
    llm: 'yes',
    summary:
      'Reads a 14-day slice of confirmed nodes; emits patterns + edge-type priors that feed back to Analyst. Runs on session start/end + daily uniform 14d slice.',
    prompts: [
      {
        ...MODEL_TIER_PROMPTS.PROFILER!.variants[0]!,
        tier: 'PROFILER',
        status: 'planned',
      },
    ],
    implementations: [
      'services/pipeline/profiler.ts (planned)',
      'db/schema (document_patterns table)',
    ],
  },
]
