"use client";

import { useEffect, useRef, useState } from "react";
import {
  FOLLOW_MCP_TOOLS,
  MCP_PROMPTS,
  mcpConsoleContext,
  runFollowTool,
} from "@/lib/followMcp";
import type { FEntry } from "@/lib/followSandbox";
import type { FBlock, FChat, FDoc } from "@/lib/followProduct";
import s from "./FollowSandbox.module.css";

/**
 * The MCP console — watch Follow's actual tools work. A real model runs a
 * real tool-calling loop: it decides which tools to call, the calls and their
 * JSON results render on the wire, and the final answer is grounded in what
 * came back. Tool names/schemas/response shapes mirror the shipped MCP server
 * (workspace-platform repo, packages/api/src/mcp/tools); the executor runs
 * the same contracts on this sandbox workspace — including the write path:
 * save_conversation adds a real entry to the memory views.
 */

type WireItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool"; name: string; args: string; result: string; isError?: boolean }
  | { kind: "note"; text: string };

type ApiMsg =
  | { role: "user" | "assistant"; content: string }
  | { role: "assistant"; content: string; tool_calls: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

const MAX_ROUNDS = 4;

function prettyArgs(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default function McpConsole({
  entries,
  addEntry,
  docs,
  chats,
  addChat,
}: {
  entries: FEntry[];
  addEntry: (e: FEntry) => void;
  docs: FDoc[];
  chats: FChat[];
  addChat: (c: FChat) => void;
}) {
  const [items, setItems] = useState<WireItem[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [offline, setOffline] = useState(false);
  const apiMsgs = useRef<ApiMsg[]>([]);
  const entriesRef = useRef(entries);
  const savedChatCount = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [items, loading]);

  // executor context that stays current WITHIN a multi-tool round. `chats`
  // is read fresh each call (not ref-mirrored like entries) since the
  // console never writes to it directly — addChat only appends via the
  // parent's own state, through recordSavedChat below.
  const execCtx = () => ({
    entries: entriesRef.current,
    addEntry: (e: FEntry) => {
      entriesRef.current = [...entriesRef.current, e];
      addEntry(e);
    },
    docs,
    chats,
  });

  function wireItemToBlock(it: WireItem): FBlock | null {
    if (it.kind === "user") return { t: "user", text: it.text };
    if (it.kind === "assistant") return { t: "assistant", text: it.text };
    if (it.kind === "thinking") return { t: "thinking", text: it.text };
    if (it.kind === "tool") {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(it.args);
      } catch {
        /* malformed args render as an empty object on the transcript */
      }
      return { t: "tool", name: it.name, args, result: it.result, isError: it.isError };
    }
    return null; // "note" items (offline/error banners) aren't part of the transcript
  }

  /* After a successful save_conversation, the console's own wire this turn
     becomes a captured conversation — an FChat built from the wire items so
     this session appears in Conversations/All items exactly like any other
     captured thread. The tool result text carries the entry id ("id:
     mcp-N") the executor just wrote via addEntry. producedEntryIds parses
     that id out of the save result text. */
  function recordSavedChat(wire: WireItem[], saveArgs: Record<string, unknown>, resultText: string) {
    const idMatch = resultText.match(/id:\s*([a-z0-9-]+)/i);
    const producedId = idMatch ? idMatch[1] : undefined;
    const title =
      typeof saveArgs.title === "string" && saveArgs.title.trim() ? saveArgs.title.trim() : "MCP console session";

    savedChatCount.current += 1;
    const blocks = wire.map(wireItemToBlock).filter((b): b is FBlock => b !== null);

    const chat: FChat = {
      id: `cnv-you-${savedChatCount.current}`,
      memberId: "you",
      title,
      when: "today",
      seq: 900 + savedChatCount.current,
      tool: "ChatGPT",
      summary: title,
      producedEntryIds: producedId ? [producedId] : [],
      blocks,
    };
    addChat(chat);
  }

  async function send(preset?: string) {
    const q = (preset ?? input).trim();
    if (!q || loading) return;
    setInput("");
    // wireLog mirrors the FULL session's setItems synchronously (no race on
    // the closing save detection below — React state updates are async,
    // this array isn't), so a save captures the whole console session up
    // to and including this turn, not just this turn's slice.
    let wireLog: WireItem[] = [...items, { kind: "user", text: q }];
    let savedThisTurn: { args: Record<string, unknown>; resultText: string } | null = null;
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
              kind: "note",
              text:
                r.status === 503
                  ? "The tool-loop backend isn't configured in this environment; the tools themselves still run. Browse Facts, or read the schemas below."
                  : data?.error || "The model service returned an error.",
            },
          ]);
          return;
        }

        // any ok response means the backend recovered — clear offline now, not
        // only on the final-answer branch (tool-call rounds `continue` past it)
        setOffline(false);

        // the model's reasoning for this round, when the provider returns it —
        // rendered collapsed, the way a normal AI chat shows its thinking
        if (typeof data?.thinking === "string" && data.thinking.trim()) {
          const th: WireItem = { kind: "thinking", text: data.thinking.trim() };
          wireLog = [...wireLog, th];
          setItems((it) => [...it, th]);
        }

        if (Array.isArray(data?.toolCalls) && data.toolCalls.length > 0) {
          const calls = data.toolCalls as { id: string; name: string; arguments: string }[];
          // record the assistant tool-call turn for the wire
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
          // execute each call against the sandbox workspace
          for (const c of calls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(c.arguments);
            } catch {
              /* tolerate malformed args — the executor reports the miss */
            }
            const res = runFollowTool(c.name, args, execCtx());
            const toolItem: WireItem = {
              kind: "tool",
              name: c.name,
              args: c.arguments,
              result: res.text,
              isError: res.isError,
            };
            wireLog = [...wireLog, toolItem];
            setItems((it) => [...it, toolItem]);
            apiMsgs.current = [
              ...apiMsgs.current,
              { role: "tool", tool_call_id: c.id, content: res.text },
            ];
            if (c.name === "save_conversation" && !res.isError) {
              savedThisTurn = { args, resultText: res.text };
            }
          }
          continue; // hand the results back to the model
        }

        // final grounded answer
        const answerText = data?.text || "(no response)";
        wireLog = [...wireLog, { kind: "assistant", text: answerText }];
        setItems((it) => [...it, { kind: "assistant", text: answerText }]);
        apiMsgs.current = [...apiMsgs.current, { role: "assistant", content: data?.text || "" }];
        if (savedThisTurn) recordSavedChat(wireLog, savedThisTurn.args, savedThisTurn.resultText);
        return;
      }
      setItems((it) => [
        ...it,
        { kind: "note", text: `(stopped after ${MAX_ROUNDS} tool rounds; ask a follow-up to continue)` },
      ]);
      if (savedThisTurn) recordSavedChat(wireLog, savedThisTurn.args, savedThisTurn.resultText);
    } catch {
      setItems((it) => [...it, { kind: "note", text: "(connection error: the console couldn't reach the API.)" }]);
    } finally {
      setLoading(false);
    }
  }

  const fresh = items.length === 0 && !loading;

  return (
    <div className={s.console}>
      <div className={s.consoleIntro}>
        <p className={s.consoleLede}>
          A real model, running Follow&apos;s real tools. It decides which to call; every call and
          result crosses the wire below; the answer is grounded in what came back.
        </p>
        <div className={s.toolLegend}>
          {FOLLOW_MCP_TOOLS.map((t) => (
            <span key={t.function.name} className={s.toolChip} title={t.function.description}>
              ⚙ {t.function.name}
            </span>
          ))}
          <a
            className={s.repoLink}
            href="https://github.com/Rishabh117117/workspace-platform"
            target="_blank"
            rel="noopener noreferrer"
          >
            source: workspace-platform ↗
          </a>
        </div>
      </div>

      <div className={s.consoleThread} ref={scrollRef} aria-live="polite">
        {fresh && (
          <p className={s.consoleEmpty}>
            You&apos;ve got the fourth seat on Aurora; Maya, Alex, and Sam&apos;s week is already
            in the memory. Try one of the prompts below: the model thinks, picks its tools, and
            you&apos;ll see the JSON-RPC-shaped traffic in the open. Ask it to{" "}
            <em>save the conversation</em> and this session appears in Conversations and Facts,
            under “You”.
          </p>
        )}
        {items.map((it, i) => {
          if (it.kind === "user") {
            return (
              <div key={i} className={`${s.msg} ${s.msgUser}`}>
                {it.text}
              </div>
            );
          }
          if (it.kind === "assistant") {
            return (
              <div key={i} className={s.msg}>
                {it.text}
              </div>
            );
          }
          if (it.kind === "note") {
            return (
              <div key={i} className={`${s.msg} ${s.msgErr}`}>
                {it.text}
              </div>
            );
          }
          if (it.kind === "thinking") {
            return (
              <details key={i} className={s.thinking}>
                <summary className={s.thinkingSummary}>✳ thinking</summary>
                <p className={s.thinkingBody}>{it.text}</p>
              </details>
            );
          }
          return (
            <div key={i} className={`${s.toolCard} ${it.isError ? s.toolCardErr : ""}`}>
              <div className={s.toolHead}>
                <span className={s.toolName}>⚙ {it.name}</span>
                <span className={s.toolTag}>tool call</span>
              </div>
              <pre className={s.toolArgs}>{prettyArgs(it.args)}</pre>
              <div className={s.toolResHead}>→ result</div>
              <pre className={s.toolRes}>{it.result}</pre>
            </div>
          );
        })}
        {loading && <div className={s.typing}>Model is working, watching for tool calls…</div>}
        {fresh && (
          <div className={s.chips}>
            {MCP_PROMPTS.map((p) => (
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
          placeholder={offline ? "Backend offline; tools still browsable above" : "Ask, and the model will pick its tools…"}
          aria-label="Ask the MCP console"
          disabled={loading}
        />
        <button className={s.assistSend} type="submit" disabled={loading || !input.trim()} aria-label="Send">
          ↑
        </button>
      </form>
    </div>
  );
}
