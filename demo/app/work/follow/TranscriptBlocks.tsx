"use client";

import type { FBlock } from "@/lib/followProduct";
import s from "./FollowSandbox.module.css";

/**
 * Renders a captured chat's FBlock[] like the source AI tool would show it:
 * user = right bubble, assistant = left with a small tool-name label,
 * thinking = collapsed <details>. Tool calls render COLLAPSED to a one-line
 * brief (⚙ name · key arg → result gist) — expanding reveals the full
 * args/result card (same classes as the MCP console's live wire).
 */

function prettyArgs(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/* one-line gist for the collapsed row: the tool's key argument + the
   result's first line, both hard-truncated so the summary stays a summary */
function toolBrief(args: Record<string, unknown>, result: string): { arg: string; res: string } {
  const keyArg = ["query", "topic", "title", "since", "type", "scope"]
    .map((k) => args?.[k])
    .find((v): v is string => typeof v === "string" && v.length > 0);
  const arg = keyArg ? `“${keyArg.length > 40 ? `${keyArg.slice(0, 39)}…` : keyArg}”` : "";
  const firstLine = (result || "").split("\n").find((l) => l.trim()) ?? "done";
  const res = firstLine.length > 78 ? `${firstLine.slice(0, 77)}…` : firstLine;
  return { arg, res };
}

export default function TranscriptBlocks({ blocks, toolLabel }: { blocks: FBlock[]; toolLabel: string }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.t === "user") {
          return (
            <div key={i} className={`${s.msg} ${s.msgUser}`}>
              {b.text}
            </div>
          );
        }
        if (b.t === "assistant") {
          return (
            <div key={i} className={s.assistantTurn}>
              <span className={s.assistantLabel}>{toolLabel}</span>
              <div className={s.msg}>{b.text}</div>
            </div>
          );
        }
        if (b.t === "thinking") {
          return (
            <details key={i} className={s.thinking}>
              <summary className={s.thinkingSummary}>✳ thinking</summary>
              <p className={s.thinkingBody}>{b.text}</p>
            </details>
          );
        }
        // tool block — collapsed brief; expand for the full wire card
        const brief = toolBrief(b.args, b.result);
        return (
          <details key={i} className={`${s.toolDetails} ${b.isError ? s.toolDetailsErr : ""}`}>
            <summary className={s.toolSummary}>
              <span className={s.toolName}>⚙ {b.name}</span>
              {brief.arg && <span className={s.toolBriefArg}>{brief.arg}</span>}
              <span className={s.toolBriefRes}>→ {brief.res}</span>
              <span className={s.toolMore} aria-hidden="true">
                ▾
              </span>
            </summary>
            <div className={s.toolDetailsBody}>
              <pre className={s.toolArgs}>{prettyArgs(b.args)}</pre>
              <div className={s.toolResHead}>→ result</div>
              <pre className={s.toolRes}>{b.result}</pre>
            </div>
          </details>
        );
      })}
    </>
  );
}
