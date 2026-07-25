/* =========================================================================
   Follow — the team-memory sandbox (D-02: self-contained, sample data).
   A pre-loaded workspace: three teammates, three different AI tools, one
   shared memory. Every entry carries provenance (who · tool · chat · when);
   two pairs genuinely contradict each other — Follow flags them instead of
   silently picking a side.

   HONESTY: the workspace, people, and entries are sample data written for
   the sandbox. The shipped Follow product captures real AI threads over MCP.
   ========================================================================= */

export type FTool = "Claude" | "ChatGPT" | "Gemini";

export type FMember = {
  id: string;
  name: string;
  role: string;
  tool: FTool;
  /* claude.md-style: a short, present-tense brief the index keeps current —
     what they own, what they were up to this week, and a live tension if
     one exists. Rendered in the directory view + folded into the assistant's
     grounding context (followContext) so "what's Maya been up to?" answers
     from this instead of a full entry dump. */
  brief: string;
};

export type FKind = "decision" | "finding" | "constraint";

export type FEntry = {
  id: string;
  memberId: string;
  chat: string; // the AI thread (or uploaded file) the fact came from
  when: string; // relative label (Mon … today)
  topic: string;
  kind: FKind;
  claim: string; // the extracted, queryable fact
  contradicts?: string; // id of the entry it conflicts with
  sourceKind?: "chat" | "doc"; // default "chat"; "doc" = extracted from an uploaded file
  sourceId?: string; // FDoc id for doc facts; chat facts resolve via producedEntryIds
};

export const F_WORKSPACE = {
  name: "Aurora — checkout redesign",
  url: "app.follow.team/w/aurora-checkout",
  meta: "3 teammates · 3 AI tools · one memory",
};

export const F_HONESTY =
  "Concept sandbox · pre-loaded sample workspace · the shipped Follow product captures real AI threads over MCP";

export const F_MEMBERS: FMember[] = [
  {
    id: "maya",
    name: "Maya",
    role: "Product designer",
    tool: "Claude",
    brief:
      "Owns checkout's UX surface — guest flow, accessibility, wallet placement, density. This week: pushed guest-default through on Baymard evidence, closed two WCAG blockers, and shipped the payment-sheet spec. Live tension: her guest-default call is contested by Alex's LTV read.",
  },
  {
    id: "alex",
    name: "Alex",
    role: "Product manager",
    tool: "ChatGPT",
    brief:
      "Owns the funnel, fee model, and compliance scoping. This week: found the real 41% leak at the shipping reveal and built Sprint 2 off all 31 facts. Live tension: his own Adyen savings estimate got corrected by Sam's real-volume model.",
  },
  {
    id: "sam",
    name: "Sam",
    role: "Engineer",
    tool: "Gemini",
    brief:
      "Owns payments integration and performance. This week: confirmed Stripe's SCA path needs no custom retry code and cut LCP ~0.8s by deferring the payments SDK. He's the one who corrected Alex's fee estimate — worth asking him first on payments.",
  },
];

/* the visitor — entries written through the MCP console's save_conversation
   land under this identity (it appears in the team/directory once it has
   at least one entry) */
export const F_YOU: FMember = {
  id: "you",
  name: "You",
  role: "Visitor · MCP console",
  tool: "ChatGPT",
  brief:
    "Fourth seat on Aurora — joined this week. Nothing captured yet; anything you save from the MCP console lands here and joins the index like everyone else's threads.",
};

/* chronological order for "what changed" reasoning */
export const F_WHEN_ORDER = ["Mon", "Tue", "Wed", "Thu", "today"] as const;

export const F_ENTRIES: FEntry[] = [
  // ---- payments ----
  {
    id: "f1",
    memberId: "sam",
    chat: "Stripe API deep-dive",
    when: "Mon",
    topic: "payments",
    kind: "finding",
    claim:
      "Stripe PaymentIntents handles SCA retries natively — we don't need to build our own retry state machine.",
  },
  {
    id: "f2",
    memberId: "alex",
    chat: "Processor cost model",
    when: "Tue",
    topic: "payments",
    kind: "finding",
    claim:
      "Adyen's interchange++ pricing would save us ~12% on processing versus Stripe — we should plan the switch.",
    contradicts: "f3",
  },
  {
    id: "f3",
    memberId: "sam",
    chat: "Fee modelling round 2",
    when: "Thu",
    topic: "payments",
    kind: "finding",
    claim:
      "Interchange++ only beats Stripe's blended rate past ~$2M/yr in volume; at our ~$800k, Stripe is cheaper.",
    contradicts: "f2",
  },
  {
    id: "f4",
    memberId: "maya",
    chat: "Checkout wallet UX",
    when: "Wed",
    topic: "payments",
    kind: "finding",
    claim:
      "Apple Pay / Google Pay above the fold cuts checkout from 12 taps to 3 for returning mobile users.",
  },

  // ---- guest checkout ----
  {
    id: "f5",
    memberId: "maya",
    chat: "Guest checkout research",
    when: "Mon",
    topic: "guest-checkout",
    kind: "finding",
    claim:
      "Baymard: 26% of US shoppers abandoned a cart last quarter specifically because the site required an account.",
  },
  {
    id: "f6",
    memberId: "maya",
    chat: "Guest checkout research",
    when: "Mon",
    topic: "guest-checkout",
    kind: "decision",
    claim:
      "Guest checkout becomes the default path; account creation moves to the order-confirmation screen.",
    contradicts: "f7",
  },
  {
    id: "f7",
    memberId: "alex",
    chat: "LTV strategy thread",
    when: "Wed",
    topic: "guest-checkout",
    kind: "finding",
    claim:
      "Account-first flows show ~2.1× higher repeat purchase in our category benchmarks — we shouldn't bury account creation.",
    contradicts: "f6",
  },
  {
    id: "f8",
    memberId: "sam",
    chat: "Session handling",
    when: "Thu",
    topic: "guest-checkout",
    kind: "constraint",
    claim:
      "Guest carts must survive 30 days — that needs a signed cookie plus a server-side cart store, not localStorage.",
  },

  // ---- accessibility ----
  {
    id: "f9",
    memberId: "maya",
    chat: "A11y audit prep",
    when: "Tue",
    topic: "accessibility",
    kind: "finding",
    claim:
      "The current card form fails WCAG 2.2 AA on focus-visible and error identification — both are relaunch blockers.",
  },
  {
    id: "f10",
    memberId: "maya",
    chat: "A11y audit prep",
    when: "Tue",
    topic: "accessibility",
    kind: "decision",
    claim:
      "Errors get written inline next to the field AND announced via aria-live — no toast-only error messages.",
  },
  {
    id: "f11",
    memberId: "sam",
    chat: "Form perf + a11y",
    when: "Wed",
    topic: "accessibility",
    kind: "finding",
    claim:
      "Native <select> beats our custom dropdown on screen readers and iOS — keeping native for state and country fields.",
  },

  // ---- performance ----
  {
    id: "f12",
    memberId: "sam",
    chat: "Bundle audit",
    when: "Mon",
    topic: "performance",
    kind: "finding",
    claim:
      "The payments SDK is 38% of checkout JS; lazy-loading it after address entry cuts LCP by ~0.8s on 4G.",
  },
  {
    id: "f13",
    memberId: "sam",
    chat: "Bundle audit",
    when: "Mon",
    topic: "performance",
    kind: "decision",
    claim:
      "The address step ships as server components; only the card fields hydrate on the client.",
  },

  // ---- analytics ----
  {
    id: "f14",
    memberId: "alex",
    chat: "Funnel metrics",
    when: "Tue",
    topic: "analytics",
    kind: "finding",
    claim:
      "Drop-off concentrates at the shipping-cost reveal (41%), not at payment — surprise fees are the leak, not friction.",
  },
  {
    id: "f15",
    memberId: "alex",
    chat: "Funnel metrics",
    when: "Tue",
    topic: "analytics",
    kind: "decision",
    claim: "The shipping estimate moves to the cart page, before checkout even starts.",
  },

  // ---- design / compliance / planning ----
  {
    id: "f16",
    memberId: "maya",
    chat: "Checkout visual pass",
    when: "Thu",
    topic: "design",
    kind: "decision",
    claim:
      "Checkout uses the compact density scale — 4px grid, 13px labels — synced to design-tokens v2.3.",
  },
  {
    id: "f17",
    memberId: "alex",
    chat: "Compliance check",
    when: "Thu",
    topic: "compliance",
    kind: "constraint",
    claim:
      "PSD2/SCA applies to the EU rollout — 3DS2 challenge flows are launch scope, not a fast-follow.",
  },
  {
    id: "f18",
    memberId: "sam",
    chat: "3DS integration",
    when: "today",
    topic: "compliance",
    kind: "finding",
    claim:
      "Stripe's 3DS2 is automatic on PaymentIntents; Adyen needs explicit threeDS2 configuration per region.",
  },
  {
    id: "f19",
    memberId: "maya",
    chat: "Trust signals",
    when: "today",
    topic: "guest-checkout",
    kind: "finding",
    claim:
      "Accepted-payment icons plus a returns link near the CTA lifted completion 4–6% in comparable studies.",
  },
  {
    id: "f20",
    memberId: "alex",
    chat: "Sprint plan",
    when: "today",
    topic: "planning",
    kind: "decision",
    claim:
      "Sprint 2 scope: guest-default flow behind a flag, shipping-estimate-in-cart, and the inline a11y error pattern.",
  },
];

/* ------------------------------ derivations ---------------------------- */

export function fMember(id: string): FMember {
  return F_MEMBERS.find((m) => m.id === id) ?? F_YOU;
}

export type FTopicStat = { topic: string; count: number; contested: boolean };

export function fTopics(entries: FEntry[]): FTopicStat[] {
  const map = new Map<string, { count: number; contested: boolean }>();
  for (const e of entries) {
    const t = map.get(e.topic) || { count: 0, contested: false };
    t.count++;
    if (e.contradicts) t.contested = true;
    map.set(e.topic, t);
  }
  return [...map.entries()]
    .map(([topic, v]) => ({ topic, ...v }))
    .sort((a, b) => b.count - a.count);
}

export type FDirectoryRow = {
  member: FMember;
  entryCount: number;
  topics: { topic: string; count: number }[];
  lastActive: string;
};

export function fDirectory(entries: FEntry[]): FDirectoryRow[] {
  const members = entries.some((e) => e.memberId === F_YOU.id)
    ? [...F_MEMBERS, F_YOU]
    : F_MEMBERS;
  return members.map((member) => {
    const own = entries.filter((e) => e.memberId === member.id);
    const topics = new Map<string, number>();
    own.forEach((e) => topics.set(e.topic, (topics.get(e.topic) || 0) + 1));
    const lastActive =
      [...F_WHEN_ORDER].reverse().find((w) => own.some((e) => e.when === w)) || "—";
    return {
      member,
      entryCount: own.length,
      topics: [...topics.entries()]
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count),
      lastActive,
    };
  });
}

/* ------------------- assistant grounding context ------------------------ */

/* contested-first, then newest-day-first — the server slices at a fixed
   char budget, so the tail (oldest, uncontested) is the least important */
function orderForContext(entries: FEntry[]): FEntry[] {
  return [...entries].sort((a, b) => {
    const ac = a.contradicts ? 0 : 1;
    const bc = b.contradicts ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return fWhenRank(b.when) - fWhenRank(a.when);
  });
}

function fWhenRank(when: string): number {
  const i = (F_WHEN_ORDER as readonly string[]).indexOf(when);
  return i === -1 ? -1 : i;
}

export function followContext(entries: FEntry[]): string {
  const dir = fDirectory(entries)
    .map(
      (d) =>
        `- ${d.member.name} (${d.member.role}, uses ${d.member.tool}): ${d.entryCount} entries — ${d.topics
          .map((t) => t.topic)
          .join(", ")}; last active ${d.lastActive}`,
    )
    .join("\n");
  // short per-person briefs (claude.md-style) so "what's X been up to?"
  // answers directly instead of forcing a scan of every entry
  const briefs = fDirectory(entries)
    .map((d) => `- ${d.member.name}: ${d.member.brief}`)
    .join("\n");
  const mem = orderForContext(entries)
    .map((e) => {
      const m = fMember(e.memberId);
      const flag = e.contradicts ? ` [CONTESTED — conflicts with ${e.contradicts}]` : "";
      const src =
        e.sourceKind === "doc"
          ? `${m.name} · uploaded file "${e.chat}"`
          : `${m.name} · ${m.tool} · “${e.chat}”`;
      return `${e.id} [${e.topic} · ${e.kind} · ${e.when}] ${e.claim} (${src})${flag}`;
    })
    .join("\n");
  return [
    `Also captured this week: 16 conversations · 7 files — every fact links back to its source.`,
    `Workspace: ${F_WORKSPACE.name} (${F_WORKSPACE.meta}). Days run Mon→today; "recent" = Thu/today.`,
    `Team directory:\n${dir}`,
    `Team briefs (what each person's been up to):\n${briefs}`,
    `Team memory entries:\n${mem}`,
  ].join("\n\n");
}

export const F_ASK_PROMPTS = [
  "What's contested right now?",
  "Who should I ask about payments?",
  "What changed today?",
  "What do the docs say about promo codes?",
];
