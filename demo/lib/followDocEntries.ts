/* =========================================================================
   Follow — doc-facts (D-02 product replica).
   The 12 facts extracted from the week's 7 uploaded files. Small + eager:
   no doc bodies live here (those are in lib/followDocs.ts, lazy-loaded).
   Each entry's `chat` field equals its source doc's exact title, and
   `sourceId` resolves back to that doc via fSourceForEntry().

   HONESTY: sample data written for the sandbox, consistent with the 20
   canonical memory entries in lib/followSandbox.ts. The shipped Follow
   product captures real AI threads over MCP.
   ========================================================================= */

import type { FEntry } from "./followSandbox";

export const F_DOC_ENTRIES: FEntry[] = [
  {
    id: "fd1",
    memberId: "alex",
    chat: "Aurora Checkout — PRD v2.1",
    when: "Mon",
    topic: "planning",
    kind: "constraint",
    claim:
      "PRD v2.1: EU and US storefronts relaunch together — checkout ships localized (EN/DE/FR) with SCA-ready payments from day one.",
    sourceKind: "doc",
    sourceId: "doc-1",
  },
  {
    id: "fd2",
    memberId: "alex",
    chat: "Aurora Checkout — PRD v2.1",
    when: "Mon",
    topic: "design",
    kind: "constraint",
    claim:
      "PRD v2.1: promo-code entry stays visible at checkout — merchandising committed to code-led campaigns for Q3.",
    contradicts: "fd4",
    sourceKind: "doc",
    sourceId: "doc-1",
  },
  {
    id: "fd3",
    memberId: "sam",
    chat: "Checkout v1 postmortem (2024)",
    when: "Mon",
    topic: "payments",
    kind: "finding",
    claim:
      "v1 postmortem: hand-rolled card fields caused 60% of checkout incidents — v2 uses the processor's hosted fields, full stop.",
    sourceKind: "doc",
    sourceId: "doc-2",
  },
  {
    id: "fd4",
    memberId: "sam",
    chat: "Checkout v1 postmortem (2024)",
    when: "Mon",
    topic: "design",
    kind: "finding",
    claim:
      "v1 postmortem: the promo-code box invited comparison-shopping exits — 14% of abandons followed a promo-field focus; hide it behind a link.",
    contradicts: "fd2",
    sourceKind: "doc",
    sourceId: "doc-2",
  },
  {
    id: "fd5",
    memberId: "maya",
    chat: "Checkout usability test — round 1 notes (n=6)",
    when: "Tue",
    topic: "guest-checkout",
    kind: "finding",
    claim:
      "Usability round 1 (n=6): 5 of 6 tried to check out without an account; two called the forced sign-up a dealbreaker, unprompted.",
    sourceKind: "doc",
    sourceId: "doc-3",
  },
  {
    id: "fd6",
    memberId: "maya",
    chat: "Checkout usability test — round 1 notes (n=6)",
    when: "Tue",
    topic: "accessibility",
    kind: "finding",
    claim:
      "Usability round 1: both screen-reader participants missed the toast-only error — neither could complete the card step unaided.",
    sourceKind: "doc",
    sourceId: "doc-3",
  },
  {
    id: "fd7",
    memberId: "alex",
    chat: "May checkout funnel — analytics export",
    when: "Tue",
    topic: "analytics",
    kind: "finding",
    claim:
      "May funnel: mobile converts at 1.8% vs 4.3% on desktop — the gap is the single biggest revenue lever in checkout.",
    sourceKind: "doc",
    sourceId: "doc-4",
  },
  {
    id: "fd8",
    memberId: "alex",
    chat: "May checkout funnel — analytics export",
    when: "Tue",
    topic: "analytics",
    kind: "finding",
    claim:
      "May funnel: 71% of checkout sessions are mobile; every additional form field costs measurably more there than on desktop.",
    sourceKind: "doc",
    sourceId: "doc-4",
  },
  {
    id: "fd9",
    memberId: "sam",
    chat: "PCI-DSS SAQ-A + SCA readiness checklist",
    when: "Wed",
    topic: "compliance",
    kind: "constraint",
    claim:
      "SAQ-A eligibility requires hosted payment fields end-to-end — any custom card input bumps us to SAQ A-EP plus quarterly ASV scans.",
    sourceKind: "doc",
    sourceId: "doc-5",
  },
  {
    id: "fd10",
    memberId: "maya",
    chat: "Payment sheet v3 — design spec",
    when: "Thu",
    topic: "design",
    kind: "decision",
    claim:
      "Payment sheet v3: single-column layout on the 4px grid, 13px labels — synced to design-tokens v2.3 compact scale.",
    sourceKind: "doc",
    sourceId: "doc-7",
  },
  {
    id: "fd11",
    memberId: "maya",
    chat: "Payment sheet v3 — design spec",
    when: "Thu",
    topic: "accessibility",
    kind: "decision",
    claim:
      "Payment sheet v3 bakes in the inline-error pattern — error text tied to each field via aria-describedby plus an aria-live announce.",
    sourceKind: "doc",
    sourceId: "doc-7",
  },
  {
    id: "fd12",
    memberId: "alex",
    chat: "Support tickets — checkout themes, May",
    when: "Wed",
    topic: "analytics",
    kind: "finding",
    claim:
      "Support tickets, May: 'where's my confirmation email?' is the top checkout-adjacent theme (31%) — the confirmation screen needs an explicit email-sent state.",
    sourceKind: "doc",
    sourceId: "doc-6",
  },
];
