/* =========================================================================
   Follow MCP — the console's tool layer, based on the ACTUAL Follow code.

   Tool names, descriptions, and input schemas mirror the shipped MCP server
   in the workspace-platform repo (packages/api/src/mcp/tools/*.ts, one file
   per tool, 12 tools over JSON-RPC at /mcp — designed headless: user and
   machine callers both). Response TEXT SHAPES were verified two ways:
   reading the handlers, and calling the live Follow connector (query_index,
   directory_query, get_activity) — e.g. the directory JSON below matches a
   real response field-for-field.

   The EXECUTOR here runs the same contracts against the sandbox workspace
   (lib/followSandbox.ts) instead of the production index — the portfolio
   demo is self-contained by design (D-02). Params the sandbox can't honor
   (Boundary[] governance overrides, structured query mode) are trimmed from
   the schemas rather than silently ignored. This registers 6 of the real
   server's 12 tools.

   Repo: https://github.com/Rishabh117117/workspace-platform
   ========================================================================= */

import {
  F_WORKSPACE,
  F_MEMBERS,
  fMember,
  fTopics,
  type FEntry,
} from "./followSandbox";
import { fSourceForEntry, type FChat, type FDoc } from "./followProduct";

/* ---- OpenAI/OpenRouter function-tool format (what /api/ask forwards) ---- */
export type McpToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export const FOLLOW_MCP_TOOLS: McpToolDef[] = [
  {
    type: "function",
    function: {
      name: "query_index",
      description:
        "Query the Follow knowledge index. Semantic mode: provide `query` (natural-language string) for fuzzy retrieval via the reference agent. Returns matched facts with titles and match scores.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language question (semantic mode).",
          },
          scope: {
            type: "string",
            enum: ["personal", "project", "auto"],
            description: "Which index to query. 'auto' uses the active session scope. Default: 'auto'",
          },
          max_results: {
            type: "number",
            description: "Maximum results (semantic mode). Default: 5",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "directory_query",
      description:
        "Look up WHO knows about a topic — which team members have contributed knowledge, their depth of analysis, sources used, and any contradictions between contributors. Use this instead of query_index when the question is about people ('who worked on X?', 'who knows about Y?'), when the topic is contested, or when routing to the right person beats a summary. Returns contributor profiles with coverage depth and a routing recommendation.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description: "What topic or area to look up contributors and sources for",
          },
          include_contradictions: {
            type: "boolean",
            description: "Whether to return contradictions (default: true)",
          },
          max_contributors: {
            type: "number",
            description: "Maximum contributors to return (default: 10)",
          },
        },
        required: ["topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "detect_contradictions",
      description:
        "Detect cross-contributor conflicts and contradictions in the active project index. Returns claims from different contributors that disagree.",
      parameters: {
        type: "object",
        properties: {
          topic: {
            type: "string",
            description:
              "Optional topic to narrow contradiction search. If empty, returns all active contradictions.",
          },
          include_resolved: {
            type: "boolean",
            description: "Include previously resolved contradictions. Default: false",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_activity",
      description:
        "Get recent activity from your personal or project index. Shows indexed facts, contributions, messages, and file uploads.",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["personal", "project", "auto"],
            description: "Which index to query. Default: 'auto'",
          },
          since: {
            type: "string",
            description: "Time filter. E.g., 'today', 'this week', '3 days'. Default: 'today'",
          },
          type: {
            type: "string",
            enum: ["all", "contributions", "contradictions", "messages", "ingestions"],
            description: "Filter by activity type. Default: 'all'",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_conversation",
      description:
        "Import a conversation from an external AI tool into Follow, so it becomes part of the team's searchable memory (idempotent by content hash in the shipped server). Provide a title and the messages; an optional summary becomes the indexed claim.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Conversation title" },
          sourceType: {
            type: "string",
            description: "Where the conversation came from, e.g. 'mcp-demo', 'chatgpt', 'claude'. Default: 'mcp-demo'",
          },
          messages: {
            type: "array",
            description: "The conversation turns to save",
            items: {
              type: "object",
              properties: {
                role: { type: "string" },
                content: { type: "string" },
              },
              required: ["role", "content"],
            },
          },
          summary: {
            type: "string",
            description: "One-sentence takeaway — becomes the indexed, queryable claim.",
          },
        },
        required: ["title", "messages"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "retrieve",
      description:
        "Provenance-first retrieval, one level deeper than text matching: returns the source behind the facts that match — the originating conversation excerpt, who worked it out, when, and the facts it connects to. Use alongside query_index when you need the receipts, not just the summary.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language question — what to find the source for.",
          },
          limit: {
            type: "number",
            description: "Maximum sources to return (1-3). Default: 2",
          },
        },
        required: ["query"],
      },
    },
  },
];

/* --------------------------- the executor ------------------------------ */

export type McpExecResult = { text: string; isError?: boolean };

export type McpExecCtx = {
  entries: FEntry[];
  addEntry: (e: FEntry) => void;
  /* uploaded files — optional so the sandbox's pre-doc-view executor calls
     keep working unchanged; when present, directory_query/get_activity fold
     file-ingestion signal in alongside the conversation-derived facts */
  docs?: FDoc[];
  /* captured conversations — optional for the same reason; retrieve needs
     these to resolve a chat-sourced fact back to the transcript blocks it
     came from (fSourceForEntry covers doc sources without this) */
  chats?: FChat[];
};

const STOP = new Set([
  "the", "and", "for", "with", "what", "who", "how", "our", "are", "does",
  "about", "know", "knows", "team", "this", "that", "have", "has", "any",
]);

function tokens(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function scoreEntry(e: FEntry, toks: string[]): number {
  if (toks.length === 0) return 0;
  let hits = 0;
  const claim = e.claim.toLowerCase();
  const chat = e.chat.toLowerCase();
  for (const t of toks) {
    if (e.topic.includes(t)) hits += 3;
    if (claim.includes(t)) hits += 2;
    if (chat.includes(t)) hits += 1;
  }
  return hits;
}

/* pseudo-similarity % in the range the real pgvector search reports */
function pct(hits: number, max: number): number {
  return Math.min(95, Math.round(38 + (hits / Math.max(1, max)) * 55));
}

const WHEN_RANK: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, today: 4 };

function contestedPairs(entries: FEntry[]): [FEntry, FEntry][] {
  const pairs: [FEntry, FEntry][] = [];
  for (const e of entries) {
    if (!e.contradicts) continue;
    const other = entries.find((x) => x.id === e.contradicts);
    if (other && e.id < other.id) pairs.push([e, other]);
  }
  return pairs;
}

/* ---- query_index: real output format —
   `Found N result(s) for "q":` + `**title > section** (NN% match)` blocks ---- */
function execQueryIndex(args: Record<string, unknown>, ctx: McpExecCtx): McpExecResult {
  const query = String(args.query ?? "").trim();
  const maxResults = Number(args.max_results ?? 5);
  if (!query) {
    return { text: "Error: provide either 'query' (semantic mode) or 'structured' (Query mode).", isError: true };
  }
  const toks = tokens(query);
  const scored = ctx.entries
    .map((e) => ({ e, hits: scoreEntry(e, toks) }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  if (scored.length === 0) {
    return {
      text: `No results found for "${query}". Your index may not have relevant content yet, or the scope may be too narrow.\n\n[Query classified as: simple]`,
    };
  }
  const top = scored.slice(0, maxResults);
  const maxHits = top[0].hits;
  let text = `Found ${top.length} result(s) for "${query}":\n\n`;
  for (const { e, hits } of top) {
    const m = fMember(e.memberId);
    text += `**${e.chat} > ${e.topic}** (${pct(hits, maxHits)}% match)\n`;
    text += `${e.claim}\n— ${m.name} · ${m.tool} · ${e.when}${e.contradicts ? " · ⚑ contested" : ""}\n\n`;
  }
  text += `[Query classified as: simple]`;
  return { text: text.trim() };
}

/* ---- directory_query: mirrors a real live response field-for-field ---- */
function execDirectoryQuery(args: Record<string, unknown>, ctx: McpExecCtx): McpExecResult {
  const topic = String(args.topic ?? "").trim();
  if (!topic) return { text: "Error: topic parameter is required.", isError: true };
  const includeContradictions = args.include_contradictions !== false;
  const maxContributors = Number(args.max_contributors ?? 10);

  const toks = tokens(topic);
  const matched = ctx.entries.filter((e) => scoreEntry(e, toks) > 0);
  const byMember = new Map<string, FEntry[]>();
  for (const e of matched) {
    byMember.set(e.memberId, [...(byMember.get(e.memberId) ?? []), e]);
  }

  // files whose declared topics match the query — folds upload activity
  // into the same routing signal as conversation-derived facts
  const docs = ctx.docs ?? [];
  const matchedDocs = docs.filter((d) => d.topics.some((t) => toks.some((tok) => t.includes(tok))));
  const filesByMember = new Map<string, number>();
  for (const d of matchedDocs) {
    filesByMember.set(d.uploaderId, (filesByMember.get(d.uploaderId) ?? 0) + 1);
  }
  const memberIds = new Set([...byMember.keys(), ...filesByMember.keys()]);

  const pairs = contestedPairs(matched);
  const contributors = [...memberIds]
    .map((memberId) => {
      const m = fMember(memberId);
      const own = byMember.get(memberId) ?? [];
      const filesUploaded = filesByMember.get(memberId) ?? 0;
      const chats = new Set(own.map((e) => e.chat));
      const latest = own.length
        ? own.reduce((a, b) => (WHEN_RANK[a.when] >= WHEN_RANK[b.when] ? a : b))
        : null;
      return {
        userId: m.id,
        name: m.name,
        email: `${m.id}@aurora.team`,
        brief: m.brief,
        totalFacts: own.length,
        totalFiles: 0,
        filesUploaded,
        totalConversations: chats.size,
        sessionCount: chats.size,
        totalTimeMinutes: 0,
        topicsCovered: [...new Set(own.map((e) => e.topic))],
        sources: ["ai"],
        avgEngagement: Math.round((0.4 + own.length * 0.05) * 100) / 100,
        contradictionCount: own.filter((e) => e.contradicts).length,
        latestContribution: latest ? latest.when : "—",
        stateChainDepth: own.length * 2,
        supersededCount: 0,
      };
    })
    .sort((a, b) => b.totalFacts - a.totalFacts)
    .slice(0, maxContributors);

  const contradictions = includeContradictions
    ? pairs.map(([a, b]) => ({
        description: `${fMember(a.memberId).name} and ${fMember(b.memberId).name} disagree on ${a.topic}`,
        a: { claim: a.claim, contributor: fMember(a.memberId).name, thread: a.chat, when: a.when },
        b: { claim: b.claim, contributor: fMember(b.memberId).name, thread: b.chat, when: b.when },
        status: "unresolved",
      }))
    : [];

  const top = contributors[0];
  const result = {
    topic,
    totalContributors: contributors.length,
    contributors,
    contradictions,
    routingReason: contradictions.length > 0 ? "contested-topic" : "deep-analysis",
    recommendation: top
      ? `${top.name} did the deepest analysis (${top.totalFacts} fact(s) across ${top.totalConversations} thread(s)), covering ${top.topicsCovered.join(", ")}. Consider reviewing their full session.${contradictions.length ? " Note: this topic is contested — see contradictions." : ""}`
      : `No contributors found for "${topic}" in this workspace.`,
  };
  return { text: JSON.stringify(result, null, 2) };
}

/* ---- detect_contradictions: `Found N contradiction(s) in {project}` ---- */
function execDetectContradictions(args: Record<string, unknown>, ctx: McpExecCtx): McpExecResult {
  const topic = typeof args.topic === "string" ? args.topic.trim() : "";
  const toks = topic ? tokens(topic) : [];
  const pool = topic ? ctx.entries.filter((e) => scoreEntry(e, toks) > 0) : ctx.entries;
  const pairs = contestedPairs(pool);
  const project = F_WORKSPACE.name;

  if (pairs.length === 0) {
    return {
      text: `No active contradictions found in ${project}.${topic ? ` (topic filter: "${topic}")` : ""}`,
    };
  }
  let text = `Found ${pairs.length} contradiction(s) in ${project}:\n\n`;
  pairs.forEach(([a, b], i) => {
    const ma = fMember(a.memberId);
    const mb = fMember(b.memberId);
    text += `${i + 1}. [unresolved · cross-contributor · topic: ${a.topic}]\n`;
    text += `   A: "${a.claim}" — ${ma.name} · ${ma.tool} · “${a.chat}” (${a.when})\n`;
    text += `   B: "${b.claim}" — ${mb.name} · ${mb.tool} · “${b.chat}” (${b.when})\n`;
    text += `   Both sides stay on the record; resolution pending.\n\n`;
  });
  return { text: text.trim() };
}

/* ---- get_activity: `Activity for {scope} index since {since}:` — folds
   file-ingestion lines in alongside captured-conversation facts ---- */
function execGetActivity(args: Record<string, unknown>, ctx: McpExecCtx): McpExecResult {
  const since = String(args.since ?? "today");
  const type = String(args.type ?? "all");
  const lower = since.toLowerCase();
  const minRank = lower === "today" ? WHEN_RANK.today : lower.includes("3 day") ? WHEN_RANK.Wed : 0;

  const showContributions = type === "all" || type === "contributions" || type === "messages";
  const showContradictions = type === "all" || type === "contradictions";
  const showIngestions = type === "all" || type === "ingestions";

  type Line = { rank: number; when: string; text: string };
  const lines: Line[] = [];

  if (showContributions || showContradictions) {
    const kept = ctx.entries.filter((e) => (WHEN_RANK[e.when] ?? 0) >= minRank);
    for (const e of kept) {
      if (showContradictions && !showContributions && !e.contradicts) continue;
      const m = fMember(e.memberId);
      const flag = e.contradicts ? " ⚑ contested" : "";
      lines.push({
        rank: WHEN_RANK[e.when] ?? 0,
        when: e.when,
        text: `- [${e.when}] ${m.name} captured “${e.chat}” → ${e.kind}: ${e.claim.slice(0, 90)}${e.claim.length > 90 ? "…" : ""}${flag}`,
      });
    }
  }

  if (showIngestions) {
    const docs = (ctx.docs ?? []).filter((d) => (WHEN_RANK[d.when] ?? 0) >= minRank);
    for (const d of docs) {
      const m = fMember(d.uploaderId);
      lines.push({
        rank: WHEN_RANK[d.when] ?? 0,
        when: d.when,
        text: `- [${d.when}] ${m.name} uploaded “${d.title}” (${d.filename}, ${d.sizeKb}KB) → ${d.producedEntryIds.length} fact(s) extracted`,
      });
    }
  }

  lines.sort((a, b) => b.rank - a.rank);

  if (lines.length === 0) {
    return { text: `No activity in project index since ${since}.` };
  }
  const text = `Activity for project index since ${since}:\n\n${lines.map((l) => l.text).join("\n")}\n\nTotal: ${lines.length} activities`;
  return { text };
}

/* ---- save_conversation: the write path — the console thread becomes a
   searchable memory entry (real success text shape) ---- */
function execSaveConversation(args: Record<string, unknown>, ctx: McpExecCtx): McpExecResult {
  const title = String(args.title ?? "").trim();
  const messages = Array.isArray(args.messages) ? (args.messages as { role?: unknown; content?: unknown }[]) : [];
  const sourceType = String(args.sourceType ?? "mcp-demo");
  const summary = typeof args.summary === "string" ? args.summary.trim() : "";
  if (!title || messages.length === 0) {
    return { text: "Error: title and messages are required.", isError: true };
  }

  const firstUser = messages.find((m) => m.role === "user");
  const claim =
    summary ||
    `Saved from the MCP console: ${String(firstUser?.content ?? title).slice(0, 160)}`;

  // infer a topic from the known topic vocabulary; fall back to mcp-console
  const known = fTopics(ctx.entries).map((t) => t.topic);
  const hay = (title + " " + claim).toLowerCase();
  const topic = known.find((t) => hay.includes(t.replace(/-/g, " ")) || hay.includes(t)) ?? "mcp-console";

  const id = `mcp-${ctx.entries.length + 1}`;
  ctx.addEntry({
    id,
    memberId: "you",
    chat: title,
    when: "today",
    topic,
    kind: "finding",
    claim,
  });

  return {
    text: `Saved ${messages.length} messages from ${sourceType} as "${title}" (id: ${id}, version 1). Intelligence pipeline running in the background.`,
  };
}

/* Plain-text blocks only (user/assistant turns) score for excerpt-picking —
   thinking/tool blocks are process, not the words that produced the claim. */
function textBlocks(chat: FChat): { text: string }[] {
  return chat.blocks.filter(
    (b): b is Extract<typeof b, { t: "user" | "assistant" }> => b.t === "user" || b.t === "assistant",
  );
}

/* Pick the 1-2 lines (sentence-ish chunks) from a block of text that overlap
   most with the claim's own tokens — the "near where the fact was produced"
   excerpt, without a real span index to point at. */
function bestLines(text: string, toks: string[], max: number): string[] {
  const lines = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const scored = lines
    .map((l) => {
      const low = l.toLowerCase();
      const hits = toks.filter((t) => low.includes(t)).length;
      return { l, hits };
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits);
  return scored.slice(0, max).map((x) => x.l);
}

/* ---- retrieve: one level deeper than query_index — the source behind the
   fact, not just the fact. Mirrors query_index's matching/ranking, then
   resolves each hit's provenance via fSourceForEntry (chat or doc) and pulls
   the 1-2 lines closest to where the claim was actually produced. ---- */
function execRetrieve(args: Record<string, unknown>, ctx: McpExecCtx): McpExecResult {
  const query = String(args.query ?? "").trim();
  const limit = Math.min(3, Math.max(1, Number(args.limit ?? 2) || 2));
  if (!query) {
    return { text: "Error: 'query' is required.", isError: true };
  }
  const toks = tokens(query);
  const scored = ctx.entries
    .map((e) => ({ e, hits: scoreEntry(e, toks) }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, limit);

  if (scored.length === 0) {
    return { text: `No sources found for "${query}". The index may not have relevant content yet.` };
  }

  const chats = ctx.chats ?? [];
  const docs = ctx.docs ?? [];

  const blocks = scored.map(({ e }) => {
    const m = fMember(e.memberId);
    const src = fSourceForEntry(e, chats, docs);

    let sourceLine: string;
    let quoted: string[] = [];
    if (!src) {
      sourceLine = "SOURCE: not yet loaded in this session (open the conversation or file view first).";
    } else if (src.kind === "chat") {
      quoted = bestLines(
        textBlocks(src.chat)
          .map((b) => b.text)
          .join("\n"),
        toks,
        2,
      );
      sourceLine = `SOURCE: "${src.chat.title}" — ${m.name} · ${m.tool} · ${src.chat.when}`;
    } else {
      quoted = bestLines(src.doc.body, toks, 2);
      sourceLine = `SOURCE: "${src.doc.title}" — uploaded by ${m.name} · ${src.doc.when}`;
    }

    const connected = ctx.entries
      .filter((other) => other.id !== e.id && other.topic === e.topic)
      .slice(0, 2)
      .map((other) => `${other.id} (${fMember(other.memberId).name}, ${other.when})`);

    let text = `${e.claim}\n(${m.name} · ${e.when})\n${sourceLine}`;
    if (quoted.length > 0) {
      text += `\n${quoted.map((q) => `  "${q}"`).join("\n")}`;
    }
    text += connected.length > 0 ? `\nConnected: ${connected.join(", ")}` : `\nConnected: nothing else on this topic yet`;
    return text;
  });

  return { text: `Found ${blocks.length} source(s) for "${query}":\n\n${blocks.join("\n\n")}` };
}

export function runFollowTool(
  name: string,
  args: Record<string, unknown>,
  ctx: McpExecCtx,
): McpExecResult {
  switch (name) {
    case "query_index":
      return execQueryIndex(args, ctx);
    case "directory_query":
      return execDirectoryQuery(args, ctx);
    case "detect_contradictions":
      return execDetectContradictions(args, ctx);
    case "get_activity":
      return execGetActivity(args, ctx);
    case "save_conversation":
      return execSaveConversation(args, ctx);
    case "retrieve":
      return execRetrieve(args, ctx);
    default:
      return { text: `Unknown tool: ${name}. Available: query_index, directory_query, detect_contradictions, get_activity, save_conversation, retrieve.`, isError: true };
  }
}

/* minimal workspace context for the console — the model must use the TOOLS
   to retrieve anything specific (that's the demo) */
export function mcpConsoleContext(entries: FEntry[]): string {
  const topics = fTopics(entries)
    .map((t) => `${t.topic}(${t.count})`)
    .join(", ");
  return [
    `Also captured this week: 16 conversations · 7 files — every fact links back to its source.`,
    `Workspace: ${F_WORKSPACE.name} (${F_WORKSPACE.meta}).`,
    `Team: ${F_MEMBERS.map((m) => `${m.name} (${m.role}, uses ${m.tool})`).join("; ")}.`,
    `Index: ${entries.length} entries across topics ${topics}. Days run Mon→today.`,
    `You can NOT see the entries directly — retrieve via the MCP tools.`,
  ].join("\n");
}

export const MCP_PROMPTS = [
  "Who on the team knows about payments?",
  "Are there contradictions in guest checkout?",
  "What happened in the workspace today?",
  "What do we know about Stripe fees? Save this conversation after.",
  "Retrieve the source behind the Stripe vs Adyen fee disagreement — who worked out each side, and where?",
];
