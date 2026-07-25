/* =========================================================================
   Follow — the product-replica data layer (types + pure helpers).

   This extends the team-memory sandbox (lib/followSandbox.ts) into the full
   Follow dashboard: captured conversations (with the MCP tool loop on the
   wire), uploaded files, and the fact index they produce — mirroring the
   shipped product's landing surface (All items · Conversations · Files ·
   Facts) on the same pre-loaded sample workspace.

   HONESTY: conversations and files are sample data written for the sandbox,
   consistent with the 20 canonical memory entries. The shipped Follow
   product captures real AI threads over MCP.
   ========================================================================= */

import { F_WHEN_ORDER, fMember, type FEntry, type FMember, type FTool } from "./followSandbox";

/* ------------------------------- blocks -------------------------------- */
/* One captured conversation turn — rendered like the source AI tool would
   show it: user / assistant text, collapsed reasoning, and MCP tool calls
   (same ⚙ card the live console uses). */

export type FBlock =
  | { t: "user"; text: string }
  | { t: "assistant"; text: string }
  | { t: "thinking"; text: string }
  | { t: "tool"; name: string; args: Record<string, unknown>; result: string; isError?: boolean };

export type FChat = {
  id: string; // "cnv-maya-1" …
  memberId: string;
  title: string; // MUST match FEntry.chat for the entries it produced
  when: string; // Mon … today (F_WHEN_ORDER)
  seq: number; // global order within the week (docs + chats interleaved)
  tool: FTool;
  summary: string; // one-line list-row preview
  producedEntryIds: string[]; // facts extracted from this thread
  blocks: FBlock[];
};

/* -------------------------------- files -------------------------------- */

export type FDocKind = "prd" | "postmortem" | "research" | "analysis" | "notes" | "spec";

export const F_DOC_KIND_LABEL: Record<FDocKind, string> = {
  prd: "PRD",
  postmortem: "Postmortem",
  research: "Research",
  analysis: "Analysis",
  notes: "Notes",
  spec: "Spec",
};

export type FDoc = {
  id: string; // "doc-1" …
  title: string; // shown in lists AND used as FEntry.chat for its facts
  filename: string; // "aurora-checkout-prd-v2-1.md"
  kind: FDocKind;
  uploaderId: string;
  when: string; // Mon … today
  seq: number; // global order within the week
  sizeKb: number;
  topics: string[];
  summary: string; // one-line list-row preview
  producedEntryIds: string[];
  /* Body in a small markdown subset the reader renders:
     "## " / "### " headings · paragraphs · "- " bullets · "**bold**" ·
     "> " pull-quote lines. Nothing else. */
  body: string;
};

/* ----------------------------- derivations ----------------------------- */

export function fDayIndex(when: string): number {
  const i = (F_WHEN_ORDER as readonly string[]).indexOf(when);
  return i === -1 ? F_WHEN_ORDER.length : i;
}

export type FSource =
  | { kind: "chat"; chat: FChat }
  | { kind: "doc"; doc: FDoc }
  | null;

/* Where did a fact come from? Doc facts carry sourceId; chat facts resolve
   through producedEntryIds (runtime saves from the MCP console resolve the
   same way once the console starts recording conversations). */
export function fSourceForEntry(e: FEntry, chats: FChat[], docs: FDoc[]): FSource {
  if (e.sourceKind === "doc") {
    const doc = docs.find((d) => d.id === e.sourceId || d.producedEntryIds.includes(e.id));
    return doc ? { kind: "doc", doc } : null;
  }
  const chat = chats.find((c) => c.producedEntryIds.includes(e.id) || c.id === e.sourceId);
  return chat ? { kind: "chat", chat } : null;
}

/* ------------------------------ items feed ----------------------------- */
/* The dashboard's unified "All items" feed — conversations, files, and
   facts interleaved, newest first (matching the shipped ItemsView). */

export type FFeedItem =
  | { type: "conversation"; when: string; seq: number; chat: FChat; member: FMember }
  | { type: "file"; when: string; seq: number; doc: FDoc; member: FMember }
  | { type: "fact"; when: string; seq: number; entry: FEntry; member: FMember };

export function fItemsFeed(entries: FEntry[], chats: FChat[], docs: FDoc[]): FFeedItem[] {
  const items: FFeedItem[] = [];
  for (const chat of chats)
    items.push({ type: "conversation", when: chat.when, seq: chat.seq, chat, member: fMember(chat.memberId) });
  for (const doc of docs)
    items.push({ type: "file", when: doc.when, seq: doc.seq, doc, member: fMember(doc.uploaderId) });
  for (const entry of entries) {
    const src = fSourceForEntry(entry, chats, docs);
    const seq = src ? (src.kind === "chat" ? src.chat.seq : src.doc.seq) : 999;
    items.push({ type: "fact", when: entry.when, seq: seq + 0.5, entry, member: fMember(entry.memberId) });
  }
  return items.sort(
    (a, b) => fDayIndex(b.when) - fDayIndex(a.when) || b.seq - a.seq || (a.type === "fact" ? 1 : -1),
  );
}

/* --------------------------- counting helpers -------------------------- */

export function fChatCountBy(chats: FChat[], memberId: string): number {
  return chats.filter((c) => c.memberId === memberId).length;
}

export function fDocCountBy(docs: FDoc[], memberId: string): number {
  return docs.filter((d) => d.uploaderId === memberId).length;
}

/* Facts a conversation/file produced, in canon order. */
export function fFactsFor(ids: string[], entries: FEntry[]): FEntry[] {
  return ids.map((id) => entries.find((e) => e.id === id)).filter((e): e is FEntry => !!e);
}
