"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  F_WORKSPACE,
  F_HONESTY,
  F_ENTRIES,
  fMember,
  fTopics,
  fDirectory,
  type FEntry,
} from "@/lib/followSandbox";
import { F_DOC_ENTRIES } from "@/lib/followDocEntries";
import { fSourceForEntry, type FChat, type FDoc } from "@/lib/followProduct";
import { FOLLOW_MCP_TOOLS } from "@/lib/followMcp";
import { buildFollowGraph } from "@/lib/followGraph";
import FollowAskDock from "./FollowAskDock";
import McpConsole from "./McpConsole";
import AllItemsView from "./AllItemsView";
import ConversationsView from "./ConversationsView";
import FilesView from "./FilesView";
import GraphView from "./GraphView";
import s from "./FollowSandbox.module.css";

/**
 * The Follow product-replica sandbox — the shipped dashboard's landing
 * surface, mirrored: All items · Conversations · Files · Facts · Who knows
 * what · MCP console. Every one of the 20 canonical memory entries traces
 * back to a fully written captured conversation (16 threads) or an uploaded
 * file (7 docs, 12 doc-facts) — browsable here with the MCP tool loop shown
 * on the wire, exactly like the live console renders it.
 *
 * Chats + docs are LAZY: they arrive via a dynamic import of
 * lib/followProductData (16 transcripts + 7 doc bodies) once this component
 * mounts, so /work/follow's first-load JS isn't ballooned by content that
 * only matters once someone opens the sandbox.
 */

type View = "items" | "conversations" | "files" | "memory" | "graph" | "directory" | "mcp";

const KIND_LABEL: Record<FEntry["kind"], string> = {
  decision: "decision",
  finding: "finding",
  constraint: "constraint",
};

/* ---- mobile tab-bar / More-sheet icons (stroke = currentColor) ---- */
const svgProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
const IconItems = () => (
  <svg {...svgProps}>
    <rect x="3.5" y="4.5" width="17" height="4" rx="1.3" />
    <rect x="3.5" y="10" width="17" height="4" rx="1.3" />
    <rect x="3.5" y="15.5" width="17" height="4" rx="1.3" />
  </svg>
);
const IconFacts = () => (
  <svg {...svgProps}>
    <path d="M12 3l2.3 5.9L20 11l-5.7 2.1L12 19l-2.3-5.9L4 11l5.7-2.1z" />
  </svg>
);
const IconAsk = () => (
  <svg {...svgProps}>
    <path d="M4 5.5h16v10H9.5L5.5 19v-3.5H4z" />
  </svg>
);
const IconMore = () => (
  <svg {...svgProps}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
  </svg>
);
const IconConvo = () => (
  <svg {...svgProps}>
    <path d="M4 5h16v9H8l-4 3.5V14H4z" />
  </svg>
);
const IconFile = () => (
  <svg {...svgProps}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4" />
  </svg>
);
const IconGraph = () => (
  <svg {...svgProps}>
    <circle cx="6" cy="17" r="2.3" />
    <circle cx="18" cy="7" r="2.3" />
    <circle cx="17" cy="18" r="2" />
    <path d="M7.7 15.4l8.6-6.8M8.1 17.4l7 .4" />
  </svg>
);
const IconPeople = () => (
  <svg {...svgProps}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5" />
    <path d="M16 5.2a3 3 0 010 5.6M17.5 20c0-2.4-1-4.2-2.6-5.2" />
  </svg>
);
const IconConsole = () => (
  <svg {...svgProps}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <path d="M7 9.5l3 2.5-3 2.5M12.5 15h4" />
  </svg>
);

/* the five secondary views behind the "More" tab (Items/Facts/Ask are the
   other three bottom-bar destinations) */
const MORE_VIEWS: { view: View; label: string; icon: () => React.ReactElement }[] = [
  { view: "conversations", label: "Conversations", icon: IconConvo },
  { view: "files", label: "Files", icon: IconFile },
  { view: "graph", label: "Graph", icon: IconGraph },
  { view: "directory", label: "Who knows what", icon: IconPeople },
  { view: "mcp", label: "MCP console", icon: IconConsole },
];

export default function FollowSandbox() {
  const [view, setView] = useState<View>("items");
  const [query, setQuery] = useState("");
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const [contestedOnly, setContestedOnly] = useState(false);

  // mobile app shell only (≤719px): the bottom tab bar swaps between the main
  // views, a full-screen "Ask" overlay, and a slide-up "More" sheet. On
  // desktop these never flip true (the controls that set them are hidden), so
  // the 3-region layout is untouched.
  const [askOpen, setAskOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreSheetRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const prevMoreOpen = useRef(false);

  // the memory is mutable: MCP console saves + doc-fact entries both write
  // into this array. Doc entries are small + eager (no doc bodies), so they
  // seed alongside the canonical 20 from the very first render.
  const [entries, setEntries] = useState<FEntry[]>([...F_ENTRIES, ...F_DOC_ENTRIES]);
  const addEntry = useCallback((e: FEntry) => setEntries((prev) => [...prev, e]), []);

  // chats + docs (bodies) are lazy — undefined until the dynamic import
  // resolves; the three product views render a loading skeleton until then.
  const [chats, setChats] = useState<FChat[] | null>(null);
  const [docs, setDocs] = useState<FDoc[] | null>(null);
  const addChat = useCallback((c: FChat) => setChats((prev) => (prev ? [...prev, c] : [c])), []);

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("@/lib/followProductData").then((mod) => {
      if (cancelled) return;
      setChats(mod.F_CHATS);
      setDocs(mod.F_DOCS);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const chatsReady = chats !== null;
  const docsReady = docs !== null;
  // memoized (not `chats ?? []` inline) so the [] fallback is a stable
  // reference while loading — otherwise every render produces a new array
  // identity, which would cascade into the useMemo/useCallback hooks below
  // that depend on loadedChats/loadedDocs (openSource, graphNodeCount).
  const loadedChats = useMemo(() => chats ?? [], [chats]);
  const loadedDocs = useMemo(() => docs ?? [], [docs]);

  const topics = useMemo(() => fTopics(entries), [entries]);
  const directory = useMemo(() => fDirectory(entries), [entries]);
  const contestedCount = entries.filter((e) => e.contradicts).length / 2;

  // rail badge only — GraphView builds its own graph for rendering; this is
  // cheap (buildFollowGraph is pure array work, no sim) and keeps the count
  // in sync with the view without lifting the sim itself up a level.
  const graphNodeCount = useMemo(
    () => (chatsReady && docsReady ? buildFollowGraph(entries, loadedChats, loadedDocs).nodes.length : 0),
    [chatsReady, docsReady, entries, loadedChats, loadedDocs],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // newest first: reverse of authored order (authored Mon→today)
    return [...entries].reverse().filter((e) => {
      if (contestedOnly && !e.contradicts) return false;
      if (topicFilter && e.topic !== topicFilter) return false;
      if (!q) return true;
      const m = fMember(e.memberId);
      return (
        e.claim.toLowerCase().includes(q) ||
        e.topic.includes(q) ||
        e.chat.toLowerCase().includes(q) ||
        m.name.toLowerCase().includes(q) ||
        m.tool.toLowerCase().includes(q)
      );
    });
  }, [entries, query, topicFilter, contestedOnly]);

  // any in-view navigation (open source →, jump to facts, cross-links) also
  // dismisses the mobile overlays so the target view is actually visible.
  const goView = useCallback((v: View) => {
    setView(v);
    setAskOpen(false);
    setMoreOpen(false);
  }, []);

  const jumpToFacts = useCallback((topic: string) => {
    goView("memory");
    setTopicFilter(topic);
    setContestedOnly(false);
    setQuery("");
  }, [goView]);

  const openChat = useCallback((id: string) => {
    setSelectedChatId(id);
    goView("conversations");
  }, [goView]);

  const openDoc = useCallback((id: string) => {
    setSelectedDocId(id);
    goView("files");
  }, [goView]);

  // Esc closes whichever mobile overlay is open (the tab bar is the primary
  // affordance; this is the keyboard escape hatch).
  useEffect(() => {
    if (!moreOpen && !askOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMoreOpen(false);
        setAskOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen, askOpen]);

  // More sheet a11y: while closed it's only translated off-screen, so its
  // rows would otherwise stay in the tab order (a reverse focus trap). Toggle
  // `inert` imperatively (matches ArchiveReader's pattern — works regardless
  // of the installed React typings) and hand focus into/out of the sheet.
  useEffect(() => {
    const sheet = moreSheetRef.current;
    if (sheet) sheet.toggleAttribute("inert", !moreOpen);
    // preventScroll: the sheet is mid slide-up (off-screen) when this runs, so
    // a plain focus() makes the browser scroll the page to chase it — the
    // "tapping More scrolls the page" glitch. preventScroll keeps focus without
    // the scroll-into-view.
    if (moreOpen) {
      sheet?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    } else if (prevMoreOpen.current) {
      moreBtnRef.current?.focus({ preventScroll: true });
    }
    prevMoreOpen.current = moreOpen;
  }, [moreOpen]);

  // deep-link: /work/follow/prototype#graph (etc.) opens straight to a view.
  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    const alias: Record<string, View> = { facts: "memory" };
    const v = (alias[raw] ?? raw) as View;
    const valid: View[] = ["items", "conversations", "files", "memory", "graph", "directory", "mcp"];
    if (valid.includes(v)) setView(v);
  }, []);

  // the page's demo tour (DemoTour) points the sandbox at a stop by
  // dispatching follow:goto. "ask" only means something in the ≤719px app
  // shell (desktop keeps the Ask dock on screen); the rest are plain views.
  useEffect(() => {
    const onGoto = (e: Event) => {
      const d = String((e as CustomEvent).detail ?? "");
      if (d === "ask") {
        if (window.matchMedia("(max-width: 719px)").matches) {
          setMoreOpen(false);
          setAskOpen(true);
        }
        return;
      }
      const valid: View[] = ["items", "conversations", "files", "memory", "graph", "directory", "mcp"];
      if (valid.includes(d as View)) goView(d as View);
    };
    window.addEventListener("follow:goto", onGoto);
    return () => window.removeEventListener("follow:goto", onGoto);
  }, [goView]);

  const openSource = useCallback(
    (e: FEntry) => {
      const src = fSourceForEntry(e, loadedChats, loadedDocs);
      if (!src) return;
      if (src.kind === "chat") openChat(src.chat.id);
      else openDoc(src.doc.id);
    },
    [loadedChats, loadedDocs, openChat, openDoc],
  );

  const itemCount = chatsReady && docsReady ? entries.length + loadedChats.length + loadedDocs.length : null;

  return (
    <div className={s.frame}>
      <div className={s.chrome} aria-hidden="true">
        <span className={s.dot} />
        <span className={s.dot} />
        <span className={s.dot} />
        <span className={s.url}>↻ {F_WORKSPACE.url}</span>
      </div>

      <div className={s.topbar}>
        <div className={s.brand}>
          <span className={s.brandName}>
            Follow<span className={s.brandDot}>.</span>
          </span>
          <sup className={s.brandSup}>sandbox</sup>
        </div>
        <div className={s.workspace}>
          <span className={s.wsName}>{F_WORKSPACE.name}</span>
          <span className={s.wsMeta}>{F_WORKSPACE.meta}</span>
        </div>
        <div className={s.topRight}>
          <span className={s.syncPill}>
            <span className={s.syncDot} aria-hidden="true" />
            memory synced · {entries.length} entries
          </span>
          <button
            type="button"
            className={`${s.contestedPill} ${contestedOnly ? s.contestedPillOn : ""}`}
            aria-pressed={contestedOnly}
            onClick={() => {
              setContestedOnly((v) => !v);
              goView("memory");
            }}
            title="Show only entries where teammates' AIs disagree"
          >
            ⚡ {contestedCount} contested
          </button>
        </div>
      </div>

      <div className={s.body}>
        {/* ---------------- rail ---------------- */}
        <aside className={s.rail}>
          <nav aria-label="Sandbox views">
            <p className={s.railLabel}>views</p>
            <ul className={s.viewList}>
              <li>
                <button
                  type="button"
                  className={`${s.viewBtn} ${view === "items" ? s.viewOn : ""}`}
                  aria-current={view === "items" ? "true" : undefined}
                  onClick={() => setView("items")}
                >
                  <span>All items</span>
                  <span className={s.viewCount}>{itemCount ?? "·"}</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`${s.viewBtn} ${view === "conversations" ? s.viewOn : ""}`}
                  aria-current={view === "conversations" ? "true" : undefined}
                  onClick={() => setView("conversations")}
                >
                  <span>Conversations</span>
                  <span className={s.viewCount}>{chatsReady ? loadedChats.length : "·"}</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`${s.viewBtn} ${view === "files" ? s.viewOn : ""}`}
                  aria-current={view === "files" ? "true" : undefined}
                  onClick={() => setView("files")}
                >
                  <span>Files</span>
                  <span className={s.viewCount}>{docsReady ? loadedDocs.length : "·"}</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`${s.viewBtn} ${view === "memory" ? s.viewOn : ""}`}
                  aria-current={view === "memory" ? "true" : undefined}
                  onClick={() => setView("memory")}
                >
                  <span>Facts</span>
                  <span className={s.viewCount}>{entries.length}</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`${s.viewBtn} ${view === "graph" ? s.viewOn : ""}`}
                  aria-current={view === "graph" ? "true" : undefined}
                  onClick={() => setView("graph")}
                >
                  <span>Graph</span>
                  <span className={s.viewCount}>{chatsReady && docsReady ? graphNodeCount : "·"}</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`${s.viewBtn} ${view === "directory" ? s.viewOn : ""}`}
                  aria-current={view === "directory" ? "true" : undefined}
                  onClick={() => setView("directory")}
                >
                  <span>Who knows what</span>
                  <span className={s.viewCount}>{directory.length}</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={`${s.viewBtn} ${view === "mcp" ? s.viewOn : ""}`}
                  aria-current={view === "mcp" ? "true" : undefined}
                  onClick={() => setView("mcp")}
                >
                  <span>MCP console</span>
                  <span className={s.viewCount}>{FOLLOW_MCP_TOOLS.length}</span>
                </button>
              </li>
            </ul>
          </nav>

          <div className={s.team}>
            <p className={s.railLabel}>the team</p>
            {directory.map((d) => (
              <div key={d.member.id} className={s.teamRow}>
                <span className={`${s.avatar} ${s[`tool${d.member.tool}`]}`} aria-hidden="true">
                  {d.member.name[0]}
                </span>
                <span className={s.teamWho}>
                  <span className={s.teamName}>{d.member.name}</span>
                  <span className={s.teamTool}>{d.member.tool}</span>
                </span>
                <span className={s.teamCount}>{d.entryCount}</span>
              </div>
            ))}
          </div>

          <div className={s.stats}>
            <p className={s.railLabel}>this workspace</p>
            <div className={s.statRow}>
              <span className={s.statName}>Facts captured</span>
              <span className={s.statVal}>{entries.length}</span>
            </div>
            <div className={s.statRow}>
              <span className={s.statName}>Topics tracked</span>
              <span className={s.statVal}>{topics.length}</span>
            </div>
            <div className={s.statRow}>
              <span className={s.statName}>Contested pairs</span>
              <span className={`${s.statVal} ${s.statHot}`}>{contestedCount}</span>
            </div>
            <div className={s.statRow}>
              <span className={s.statName}>Last capture</span>
              <span className={s.statVal}>today</span>
            </div>
          </div>
        </aside>

        {/* ---------------- main ---------------- */}
        <section
          className={`${s.main} ${view === "graph" ? s.mainGraph : ""}`}
          aria-label="Follow sandbox"
          data-tour="main"
        >
          {view === "items" && (
            <>
              <header className={s.mainHead}>
                <h3 className={s.mainTitle}>All items</h3>
                <p className={s.mainBlurb}>
                  Every captured conversation, uploaded file, and extracted fact: one feed, newest
                  first.
                </p>
              </header>
              {!chatsReady || !docsReady ? (
                <p className={s.loadingSkeleton}>loading the workspace…</p>
              ) : (
                <AllItemsView
                  entries={entries}
                  chats={loadedChats}
                  docs={loadedDocs}
                  onOpenChat={openChat}
                  onOpenDoc={openDoc}
                  onOpenFactTopic={jumpToFacts}
                />
              )}
            </>
          )}

          {view === "conversations" && (
            <>
              <header className={s.mainHead}>
                <h3 className={s.mainTitle}>Conversations</h3>
                <p className={s.mainBlurb}>
                  Captured AI threads, transcript and all: thinking, tool calls, and the facts each
                  one produced.
                </p>
              </header>
              {!chatsReady ? (
                <p className={s.loadingSkeleton}>loading the workspace…</p>
              ) : (
                <ConversationsView
                  chats={loadedChats}
                  entries={entries}
                  selectedId={selectedChatId}
                  onSelect={setSelectedChatId}
                  onOpenFactTopic={jumpToFacts}
                />
              )}
            </>
          )}

          {view === "files" && (
            <>
              <header className={s.mainHead}>
                <h3 className={s.mainTitle}>Files</h3>
                <p className={s.mainBlurb}>
                  Uploaded documents the team indexed: PRDs, research notes, analytics exports,
                  specs.
                </p>
              </header>
              {!docsReady ? (
                <p className={s.loadingSkeleton}>loading the workspace…</p>
              ) : (
                <FilesView
                  docs={loadedDocs}
                  entries={entries}
                  selectedId={selectedDocId}
                  onSelect={setSelectedDocId}
                  onOpenFactTopic={jumpToFacts}
                />
              )}
            </>
          )}

          {view === "memory" && (
            <>
              <header className={s.mainHead}>
                <h3 className={s.mainTitle}>Facts</h3>
                <p className={s.mainBlurb}>
                  Every entry keeps its provenance: who worked it out, in which AI or file, in
                  which thread. Conflicts stay visible.
                </p>
              </header>
              <input
                className={s.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search the memory: claims, people, threads…"
                aria-label="Search the team memory"
              />
              <div className={s.topicRow}>
                {topics.map((t) => (
                  <button
                    key={t.topic}
                    type="button"
                    className={`${s.topicChip} ${topicFilter === t.topic ? s.topicOn : ""}`}
                    aria-pressed={topicFilter === t.topic}
                    onClick={() => setTopicFilter(topicFilter === t.topic ? null : t.topic)}
                  >
                    {t.topic}
                    {t.contested && <span className={s.topicZap}> ⚡</span>}
                    <span className={s.topicCount}>{t.count}</span>
                  </button>
                ))}
              </div>

              {shown.length === 0 && <p className={s.empty}>Nothing in memory matches that.</p>}
              {shown.map((e) => {
                const m = fMember(e.memberId);
                const other = e.contradicts ? entries.find((x) => x.id === e.contradicts) : null;
                const otherM = other ? fMember(other.memberId) : null;
                const isDoc = e.sourceKind === "doc";
                const canOpenSource = chatsReady && docsReady && !!fSourceForEntry(e, loadedChats, loadedDocs);
                return (
                  <article key={e.id} className={`${s.entry} ${e.contradicts ? s.entryHot : ""}`}>
                    <p className={s.claim}>{e.claim}</p>
                    <div className={s.provRow}>
                      {isDoc ? (
                        <span className={`${s.avatar} ${s.avatarSm} ${s.avatarDoc}`} aria-hidden="true">
                          📄
                        </span>
                      ) : (
                        <span className={`${s.avatar} ${s.avatarSm} ${s[`tool${m.tool}`]}`} aria-hidden="true">
                          {m.name[0]}
                        </span>
                      )}
                      <span className={s.prov}>
                        {isDoc
                          ? `${m.name} · 📄 "${e.chat}" · uploaded ${e.when}`
                          : `${m.name} · ${m.tool} · "${e.chat}" · ${e.when}`}
                      </span>
                      <span className={`${s.kind} ${s[`kind_${e.kind}`]}`}>{KIND_LABEL[e.kind]}</span>
                      <span className={s.topicTag}>{e.topic}</span>
                    </div>
                    {other && otherM && (
                      <p className={s.conflict}>
                        <span className={s.conflictBadge}>⚡ contested</span>
                        disagrees with {otherM.name}&apos;s “{other.chat}” ({other.when}). Follow keeps
                        both sides on the record instead of picking one.
                      </p>
                    )}
                    {canOpenSource && (
                      <button type="button" className={s.openSource} onClick={() => openSource(e)}>
                        open source →
                      </button>
                    )}
                  </article>
                );
              })}
            </>
          )}

          {view === "graph" && (
            <>
              <header className={s.mainHead}>
                <h3 className={s.mainTitle}>Graph</h3>
                <p className={s.mainBlurb}>
                  The knowledge graph under this workspace: every fact wired to the thread or file it
                  came from, contradictions in red. The shipped product renders this same graph from its
                  live index.
                </p>
              </header>
              {!chatsReady || !docsReady ? (
                <p className={s.loadingSkeleton}>loading the workspace…</p>
              ) : (
                <GraphView
                  entries={entries}
                  chats={loadedChats}
                  docs={loadedDocs}
                  onOpenChat={openChat}
                  onOpenDoc={openDoc}
                  onOpenFactTopic={jumpToFacts}
                  onOpenDirectory={() => setView("directory")}
                />
              )}
            </>
          )}

          {view === "directory" && (
            <>
              <header className={s.mainHead}>
                <h3 className={s.mainTitle}>Who knows what</h3>
                <p className={s.mainBlurb}>
                  The transactive-memory directory Follow maintains automatically: retrieval by
                  knowing whom to ask. Each person carries a short brief the index keeps up to date.
                </p>
              </header>
              {directory.map((d) => (
                <article key={d.member.id} className={s.person}>
                  <header className={s.personHead}>
                    <span className={`${s.avatar} ${s.avatarLg} ${s[`tool${d.member.tool}`]}`} aria-hidden="true">
                      {d.member.name[0]}
                    </span>
                    <div>
                      <h4 className={s.personName}>{d.member.name}</h4>
                      <p className={s.personMeta}>
                        {d.member.role} · works in {d.member.tool} · last active {d.lastActive}
                      </p>
                    </div>
                    <span className={s.personCount}>{d.entryCount} entries</span>
                  </header>
                  <p className={s.personBrief}>{d.member.brief}</p>
                  <p className={s.briefNote}>maintained by the index · updated {d.lastActive}</p>
                  <div className={s.personTopics}>
                    {d.topics.map((t) => (
                      <button
                        key={t.topic}
                        type="button"
                        className={s.personTopic}
                        onClick={() => {
                          setView("memory");
                          setTopicFilter(t.topic);
                          setQuery(d.member.name);
                        }}
                        title={`See ${d.member.name}'s ${t.topic} entries`}
                      >
                        {t.topic} <span className={s.topicCount}>{t.count}</span>
                      </button>
                    ))}
                  </div>
                </article>
              ))}
              <p className={s.dirFoot}>
                Expertise is derived live from the memory; nobody fills in a profile.
              </p>
            </>
          )}

          {/* stays MOUNTED across view switches so the tool wire survives a
              hop to Facts (to see a saved entry) and back */}
          <div className={view === "mcp" ? s.mcpWrap : s.mcpHidden}>
            <header className={s.mainHead}>
              <h3 className={s.mainTitle}>MCP console</h3>
              <p className={s.mainBlurb}>
                Follow is headless by design: the shipped server exposes these tools over
                JSON-RPC at /mcp, to people and machines alike. Same names, schemas, and
                response shapes here.
              </p>
            </header>
            <McpConsole entries={entries} addEntry={addEntry} docs={loadedDocs} chats={loadedChats} addChat={addChat} />
          </div>
        </section>

        {/* ---------------- Ask Follow dock ----------------
            desktop: the 3rd column. mobile: hidden until the Ask tab flips
            askOpen, then a full-screen overlay (s.assistMobileOpen). */}
        <FollowAskDock
          entries={entries}
          addEntry={addEntry}
          docs={loadedDocs}
          className={askOpen ? s.assistMobileOpen : undefined}
        />
      </div>

      <div className={s.honesty}>
        <span>{F_HONESTY}</span>
        <span className={s.honestyRight}>answers run on a live model API via a server-side proxy</span>
      </div>

      {/* ================= mobile app shell (≤719px only) =================
          A native-app bottom tab bar + slide-up "More" sheet. Both are
          display:none above 719px, so desktop is completely unaffected. */}
      {(() => {
        const moreViewActive = !askOpen && MORE_VIEWS.some((m) => m.view === view);
        const tab = (active: boolean) => `${s.mobileTab} ${active ? s.mobileTabOn : ""}`;
        return (
          <>
            <nav className={s.mobileTabBar} aria-label="Sandbox tabs">
              <button
                type="button"
                className={tab(!askOpen && !moreOpen && view === "items")}
                aria-current={!askOpen && !moreOpen && view === "items" ? "page" : undefined}
                onClick={() => goView("items")}
              >
                <IconItems />
                <span className={s.mobileTabLabel}>Items</span>
              </button>
              <button
                type="button"
                className={tab(!askOpen && !moreOpen && view === "memory")}
                aria-current={!askOpen && !moreOpen && view === "memory" ? "page" : undefined}
                onClick={() => goView("memory")}
              >
                <IconFacts />
                <span className={s.mobileTabLabel}>Facts</span>
              </button>
              <button
                type="button"
                className={tab(askOpen)}
                aria-current={askOpen ? "page" : undefined}
                onClick={() => {
                  setAskOpen((o) => !o);
                  setMoreOpen(false);
                }}
              >
                <IconAsk />
                <span className={s.mobileTabLabel}>Ask</span>
              </button>
              <button
                ref={moreBtnRef}
                type="button"
                className={tab(moreOpen || moreViewActive)}
                aria-expanded={moreOpen}
                aria-haspopup="dialog"
                onClick={() => {
                  setMoreOpen((o) => !o);
                  setAskOpen(false);
                }}
              >
                <IconMore />
                {moreViewActive && !moreOpen && <span className={s.mobileTabDot} aria-hidden="true" />}
                <span className={s.mobileTabLabel}>More</span>
              </button>
            </nav>

            <div
              className={`${s.moreBackdrop} ${moreOpen ? s.moreBackdropOn : ""}`}
              onClick={() => setMoreOpen(false)}
              aria-hidden="true"
            />
            <div
              ref={moreSheetRef}
              className={`${s.moreSheet} ${moreOpen ? s.moreSheetOn : ""}`}
              role="dialog"
              aria-label="More views"
              aria-hidden={!moreOpen}
            >
              <span className={s.moreGrab} aria-hidden="true" />
              <p className={s.moreTitle}>Views</p>
              <div className={s.moreScroll}>
                {MORE_VIEWS.map((m) => {
                  const Icon = m.icon;
                  const count =
                    m.view === "conversations"
                      ? chatsReady
                        ? loadedChats.length
                        : null
                      : m.view === "files"
                        ? docsReady
                          ? loadedDocs.length
                          : null
                        : m.view === "graph"
                          ? chatsReady && docsReady
                            ? graphNodeCount
                            : null
                          : m.view === "directory"
                            ? directory.length
                            : FOLLOW_MCP_TOOLS.length;
                  return (
                    <button
                      key={m.view}
                      type="button"
                      className={`${s.moreRow} ${view === m.view ? s.moreRowOn : ""}`}
                      onClick={() => goView(m.view)}
                    >
                      <span className={s.moreRowIcon}>
                        <Icon />
                      </span>
                      {m.label}
                      <span className={s.moreRowCount}>{count ?? "·"}</span>
                    </button>
                  );
                })}

                <div className={s.moreOverview}>
                  <div className={s.moreTeam}>
                    <p className={s.railLabel}>the team</p>
                    {directory.map((d) => (
                      <div key={d.member.id} className={s.teamRow}>
                        <span className={`${s.avatar} ${s.avatarSm} ${s[`tool${d.member.tool}`]}`} aria-hidden="true">
                          {d.member.name[0]}
                        </span>
                        <span className={s.teamWho}>
                          <span className={s.teamName}>{d.member.name}</span>
                          <span className={s.teamTool}>{d.member.tool}</span>
                        </span>
                        <span className={s.teamCount}>{d.entryCount}</span>
                      </div>
                    ))}
                  </div>
                  <div className={s.moreStats}>
                    <p className={s.railLabel}>this workspace</p>
                    <div className={s.statRow}>
                      <span className={s.statName}>Facts</span>
                      <span className={s.statVal}>{entries.length}</span>
                    </div>
                    <div className={s.statRow}>
                      <span className={s.statName}>Topics</span>
                      <span className={s.statVal}>{topics.length}</span>
                    </div>
                    <div className={s.statRow}>
                      <span className={s.statName}>Contested</span>
                      <span className={`${s.statVal} ${s.statHot}`}>{contestedCount}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
