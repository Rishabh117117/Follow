/* =========================================================================
   Follow — the lazy-loaded product data module.

   Aggregates the three members' captured chats + the uploaded docs into the
   week's full sequence. This module is dynamically imported (never a static
   import) so the 16 chat transcripts + 7 doc bodies don't inflate the
   /work/follow first-load bundle — FollowSandbox pulls it in via
   `await import("@/lib/followProductData")` once the sandbox mounts.

   HONESTY: see lib/followProduct.ts / lib/followSandbox.ts — sample data.
   ========================================================================= */

import type { FChat } from "./followProduct";
import { F_DOCS } from "./followDocs";
import { MAYA_CHATS } from "./followChats/maya";
import { ALEX_CHATS } from "./followChats/alex";
import { SAM_CHATS } from "./followChats/sam";

/* all 16 captured conversations, global seq order (docs + chats interleave —
   this array is chats-only; fItemsFeed() merges it with F_DOCS by seq) */
export const F_CHATS: FChat[] = [...MAYA_CHATS, ...ALEX_CHATS, ...SAM_CHATS].sort(
  (a, b) => a.seq - b.seq,
);

export { F_DOCS };
