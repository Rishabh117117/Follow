"use client";

import { useEffect, useRef, useState } from "react";
import { F_ASK_PROMPTS, type FEntry } from "@/lib/followSandbox";
import { mcpConsoleContext, runFollowTool } from "@/lib/followMcp";
import type { FDoc } from "@/lib/followProduct";
import s from "./FollowSandbox.module.css";

/**
 * "Ask Follow" — the workspace assistant. Show, don't tell: every answer is
 * assembled live on screen — the model's thinking, then each Follow tool it
 * calls against this workspace's index (query_index, directory_query, …),
 * rendered the way the shipped product renders them (✳ Thinking · ⚙ Query
 * index · request/result on expand), then the grounded answer. Same loop as
 * the MCP console; this surface keeps the steps compact, the console shows
 * the raw wire.
 */

type DockItem =
  | { kind: "user"; text: string }
  | { kind: "answer"; text: string; error?: boolean }
  | { kind: "thinking"; text: string }
  | { kind: "step"; name: string; args: string; result: string; isError?: boolean };

type ApiMsg =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; content: string; tool_calls: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

const MAX_ROUNDS = 4;

const GREETING =
  "Ask about Aurora's week: what's contested, who to talk to, what changed. I check the team's index before answering, and you'll see every step.";

/* the shipped product humanizes tool names in the step rows */
const STEP_NAME: Record<string, string> = {
  query_index: "Query index",
  directory_query: "Directory query",
  detect_contradictions: "Detect contradictions",
  get_activity: "Get activity",
  save_conversation: "Save conversation",
};

function stepGist(result: string): string {
  const first = (result || "").split("\n").find((l) => l.trim()) ?? "";
  let m = first.match(/Found (\d+) result/i);
  if (m) return `${m[1]} result${m[1] === "1" ? "" : "s"}`;
  m = first.match(/Found (\d+) contradiction/i);
  if (m) return `${m[1]} conflict${m[1] === "1" ? "" : "s"}`;
  if (/^No results/i.test(first)) return "no results";
  if (/^Saved \d+ message/i.test(first)) return "saved";
  if (/^Activity/i.test(first)) return "activity";
  return first.length > 26 ? `${first.slice(0, 25)}…` : first || "done";
}

function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function FollowAskDock({
  entries,
  addEntry,
  docs,
  className,
}: {
  entries: FEntry[];
  addEntry: (e: FEntry) => void;
  docs: FDoc[];
  className?: string;
}) {
  const [items, setItems] = useState<DockItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const apiMsgs = useRef<ApiMsg[]>([]);
  const entriesRef = useRef(entries);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [items, loading]);

  const execCtx = () => ({
    entries: entriesRef.current,
    addEntry: (e: FEntry) => {
      entriesRef.current = [...entriesRef.current, e];
      addEntry(e);
    },
    docs,
  });

  async function send(preset?: string) {
    const q = (preset ?? input).trim();
    if (!q || loading) return;
    setInput("");
    setItems((it) => [...it, { kind: "user", text: q }]);
    apiMsgs.current = [...apiMsgs.current, { role: "user", content: q }];
    setLoading(true);

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const r = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            demo: "follow-mcp",
            context: mcpConsoleContext(entriesRef.current),
            messages: apiMsgs.current,
          }),
        });
        const data = await r.json().catch(() => null);

        if (!r.ok) {
          if (r.status === 503) setOffline(true);
          setItems((it) => [
            ...it,
            {
              kind: "answer",
              text:
                r.status === 503
                  ? "The answer backend isn't configured in this environment; the memory, files, and directory still work."
                  : data?.error || "(Follow couldn't reach the model.)",
              error: true,
            },
          ]);
          return;
        }

        // any ok response means the backend recovered — clear offline now, not
        // only on the final-answer branch (tool-call rounds `continue` past it)
        setOffline(false);

        if (typeof data?.thinking === "string" && data.thinking.trim()) {
          setItems((it) => [...it, { kind: "thinking", text: data.thinking.trim() }]);
        }

        if (Array.isArray(data?.toolCalls) && data.toolCalls.length > 0) {
          const calls = data.toolCalls as { id: string; name: string; arguments: string }[];
          apiMsgs.current = [
            ...apiMsgs.current,
            {
              role: "assistant",
              content: "",
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: c.arguments },
              })),
            },
          ];
          for (const c of calls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(c.arguments);
            } catch {
              /* the executor reports malformed args */
            }
            const res = runFollowTool(c.name, args, execCtx());
            setItems((it) => [
              ...it,
              { kind: "step", name: c.name, args: c.arguments, result: res.text, isError: res.isError },
            ]);
            apiMsgs.current = [...apiMsgs.current, { role: "tool", tool_call_id: c.id, content: res.text }];
          }
          continue;
        }

        setItems((it) => [...it, { kind: "answer", text: data?.text || "(no response)" }]);
        apiMsgs.current = [...apiMsgs.current, { role: "assistant", content: data?.text || "" }];
        return;
      }
      setItems((it) => [
        ...it,
        { kind: "answer", text: "(that took more tool rounds than I get here; ask a follow-up to continue)", error: true },
      ]);
    } catch {
      setItems((it) => [
        ...it,
        { kind: "answer", text: "(connection error: Follow couldn't reach the API.)", error: true },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const showChips = items.length === 0 && !loading;

  return (
    <aside className={`${s.assist} ${className ?? ""}`} aria-label="Ask Follow" data-tour="ask">
      <header className={s.assistHead}>
        <span className={s.assistTitle}>
          <span className={`${s.assistDot} ${offline ? s.assistDotOff : ""}`} aria-hidden="true" />
          Ask Follow
        </span>
        <span className={s.assistStatus}>{offline ? "offline" : "live model"}</span>
      </header>

      <div className={s.assistThread} ref={scrollRef} aria-live="polite">
        <div className={s.msg}>{GREETING}</div>
        {items.map((it, i) => {
          if (it.kind === "user") {
            return (
              <div key={i} className={`${s.msg} ${s.msgUser}`}>
                {it.text}
              </div>
            );
          }
          if (it.kind === "answer") {
            return (
              <div key={i} className={`${s.msg} ${it.error ? s.msgErr : ""}`}>
                {it.text}
              </div>
            );
          }
          if (it.kind === "thinking") {
            return (
              <details key={i} className={s.dockStep}>
                <summary className={s.dockStepSummary}>
                  <span className={s.dockStepName}>✳ Thinking</span>
                  <span className={s.dockStepChev} aria-hidden="true">
                    ▾
                  </span>
                </summary>
                <p className={s.dockThinkBody}>{it.text}</p>
              </details>
            );
          }
          return (
            <details key={i} className={`${s.dockStep} ${it.isError ? s.dockStepErr : ""}`}>
              <summary className={s.dockStepSummary}>
                <span className={s.dockStepName}>⚙ {STEP_NAME[it.name] ?? it.name}</span>
                <span className={s.dockStepGist}>{stepGist(it.result)}</span>
                <span className={s.dockStepChev} aria-hidden="true">
                  ▾
                </span>
              </summary>
              <div className={s.dockStepIo}>
                <div className={s.dockStepIoLabel}>request</div>
                <pre className={s.toolArgs}>{prettyArgs(it.args)}</pre>
                <div className={s.dockStepIoLabel}>result</div>
                <pre className={s.toolRes}>{it.result}</pre>
              </div>
            </details>
          );
        })}
        {loading && <div className={s.typing}>…</div>}
        {showChips && (
          <div className={s.chips}>
            {F_ASK_PROMPTS.map((p) => (
              <button key={p} type="button" className={s.chip} onClick={() => send(p)}>
                {p}
              </button>
            ))}
          </div>
        )}
      </div>

      <form
        className={s.assistFoot}
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          className={s.assistInput}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask your team's memory…"
          aria-label="Ask Follow"
          disabled={loading}
        />
        <button className={s.assistSend} type="submit" disabled={loading || !input.trim()} aria-label="Send">
          ↑
        </button>
      </form>
    </aside>
  );
}
