"use client";

import type { FEntry } from "@/lib/followSandbox";
import s from "./FollowSandbox.module.css";

/**
 * The extracted-facts footer shared by Conversations and Files detail
 * panes: "{N} facts extracted into team memory" + a chip per fact that
 * jumps to the Facts view filtered to that fact's topic.
 */
export default function FactsFooter({
  facts,
  onJump,
}: {
  facts: FEntry[];
  onJump: (topic: string) => void;
}) {
  if (facts.length === 0) return null;
  return (
    <div className={s.factsFooter}>
      <p className={s.factsFooterHead}>
        {facts.length} fact{facts.length === 1 ? "" : "s"} extracted into team memory
      </p>
      <div className={s.factsFooterChips}>
        {facts.map((f) => (
          <button
            key={f.id}
            type="button"
            className={s.factChip}
            onClick={() => onJump(f.topic)}
            title={`Open in Facts · topic: ${f.topic}`}
          >
            {f.contradicts && <span className={s.factChipZap}>⚡ </span>}
            {f.claim.length > 78 ? `${f.claim.slice(0, 78)}…` : f.claim}
          </button>
        ))}
      </div>
    </div>
  );
}
