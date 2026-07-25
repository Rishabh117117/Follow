"use client";

import { useState } from "react";
import "./FollowSystem.css";

/**
 * Follow — the system, in one picture (FOLLOW-SYS-1..3).
 *
 * The combined concept + how-it-works diagram: the team's SOURCES on top —
 * three person·tool pairs AND the team's documents (live-synced + uploaded;
 * Follow follows the artifact, chat or doc, the same way) — raining into
 * the shared Follow index (an accent-colored slab). Chat packets are dots,
 * document packets are squares; answers flow back up in blue. Five stations
 * — team · docs · capture · layer · recall — are real buttons: hover, tap,
 * or focus one and the caption dock explains it in plain terms with the
 * sandbox's own canon as examples.
 *
 * The index slab OPENS (click / Enter, aria-expanded): an inside view
 * unfolds from its top edge — a miniature of the sandbox's real knowledge
 * graph. Same ontology as lib/followGraph.ts (member · conversation · file ·
 * fact · topic nodes; authored · uploaded · produced · topic · contradicts
 * edges), GraphView's color language, labels drawn from the sandbox's
 * actual facts. A 16s CSS loop replays the life of a fact: one arrives from
 * a chat, links typed, a contradiction flagged (both kept) — then the LIVE
 * payment-sheet spec re-syncs and a square doc packet lands as fact v2,
 * superseding v1 (ghosted, never deleted — the shipped product's re-sync
 * supersession), before a query pulls it back out. Legend strip below.
 * Animations are scoped to .fsysOpen so the loop restarts on every open;
 * reduced motion gets the finished static picture with a static caption.
 */

type Station = "team" | "docs" | "capture" | "layer" | "recall";

const PAIRS = [
  { name: "Maya", tool: "Claude", av: "fsysAvClaude" },
  { name: "Alex", tool: "ChatGPT", av: "fsysAvChatGPT" },
  { name: "Sam", tool: "Gemini", av: "fsysAvGemini" },
] as const;

/* four source lanes: three chat wires + the documents wire on the right */
const WIRE_CHAT = ["12.5%", "37.5%", "62.5%"] as const;
const WIRE_DOC = "87.5%";

const CAPTIONS: Record<
  Station | "idle",
  { tag: string; body: string; eg?: string }
> = {
  idle: {
    tag: "the whole system",
    body: "Three teammates, three different AI tools, and the team’s documents, with one shared memory between them. Hover or tap any part to see what it does, and click the index to look inside it.",
  },
  team: {
    tag: "the team, working as usual",
    body: "Maya, Alex and Sam each think with their own AI, in the tool they already use. Nobody switches apps, nobody writes anything up. Follow asks nothing of them.",
    eg: "Maya, product designer · Alex, product manager · Sam, engineer",
  },
  docs: {
    tag: "documents feed it too",
    body: "Follow follows the artifact: a chat or a document, same treatment. Live docs, like the spec in Google Docs, are followed as they change; their facts version up and the old version stays in the trail. Uploads join the same way.",
    eg: "e.g. usability-notes.pdf → three facts · the payment-sheet spec re-syncs → its facts version up",
  },
  capture: {
    tag: "every chat files itself",
    body: "As they work, each conversation flows into Follow on its own: the question, the answer, and the reasoning in between. No copy-paste, no “remember to document it.”",
    eg: "e.g. Maya × Claude, Tue: “default to guest checkout, offer an account after payment” lands as a decision",
  },
  layer: {
    tag: "one shared memory",
    body: "Follow keeps what each chat settled (decisions, findings, constraints), filed with its source. Click the slab to watch it work: typed links, a flagged clash, a new version retiring its predecessor.",
    eg: "e.g. Stripe vs Adyen fees: Alex’s estimate and Sam’s real-volume model, both kept, marked contested",
  },
  recall: {
    tag: "answers come back with receipts",
    body: "The next time anyone (or anyone’s AI) needs context, it asks Follow. The answer arrives attributed: who worked it out, in which chat or doc, when.",
    eg: "e.g. Sam’s Gemini asks about wallet placement → Maya’s payment-sheet spec, cited back to its source",
  },
};

const ARIA: Record<Station, string> = {
  team: "The team and their AI tools: Maya with Claude, Alex with ChatGPT, Sam with Gemini",
  docs: "The team's documents, live-synced and uploaded; Follow follows the artifact and versions its facts as it changes",
  capture: "The write path: every chat files itself into the shared memory",
  layer:
    "The Follow index, the shared layer: one memory, sources kept, disagreements flagged, who knows what. Opens the inside view of the knowledge graph.",
  recall: "The read path: answers come back with their sources",
};

/* =========================================================================
   The inside view — the sandbox graph's real ontology, miniature.
   Node/edge kinds mirror lib/followGraph.ts; colors mirror GraphView
   (facts accent-orange, members/threads tool-colored, files gold, topics
   neutral); the labels are the sandbox's own facts.
   ========================================================================= */

const GF = { maya: "#d97757", alex: "#10a37f", sam: "#4285f4" } as const;

const G_MEMBERS = [
  { x: 120, y: 116, c: GF.maya, letter: "M", label: "Maya · Claude" },
  { x: 352, y: 332, c: GF.alex, letter: "A", label: "Alex · ChatGPT" },
  { x: 600, y: 110, c: GF.sam, letter: "S", label: "Sam · Gemini" },
];
const G_CONVS = [
  { x: 196, y: 182, c: GF.maya, label: "guest checkout · thread", ly: 202 },
  { x: 452, y: 300, c: GF.alex, label: "fee modelling · thread", ly: 287 },
  { x: 540, y: 188, c: GF.sam, label: "SCA & retries · thread", ly: 208 },
];
// files — the third is LIVE-synced: the versioning beat's source
const G_FILES = [
  { x: 300, y: 92, label: "usability-notes.pdf" },
  { x: 492, y: 344, label: "analytics-export.csv" },
  { x: 214, y: 304, label: "payment-sheet spec · live" },
];
// static facts (the sandbox's own claims, shortened to fit); lx/ly/anchor
// override the default centered-below label when neighbors would collide
const G_FACTS: {
  x: number;
  y: number;
  label: string;
  lx?: number;
  ly?: number;
  anchor?: "start" | "end";
}[] = [
  { x: 426, y: 368, label: "41% drop at shipping reveal" },
  { x: 642, y: 214, label: "SCA: no retry code" },
  { x: 610, y: 286, label: "LCP −0.8s" },
  // pushed right so it clears the arriving fact's own label
  { x: 452, y: 220, label: "Alex’s LTV read", lx: 466, ly: 224, anchor: "start" },
  { x: 96, y: 212, label: "WCAG blockers" },
  { x: 172, y: 254, label: "trust signals" },
];
// fact → its source (produced)
const G_PROD: [number, number, number, number][] = [
  [96, 212, 196, 182],
  [172, 254, 196, 182],
  [452, 220, 452, 300],
  [642, 214, 540, 188],
  [610, 286, 540, 188],
  [282, 338, 214, 304],
  [426, 368, 492, 344],
];
// conversation → author (authored) + file → uploader (uploaded)
const G_HUB: [number, number, number, number][] = [
  [196, 182, 120, 116],
  [452, 300, 352, 332],
  [540, 188, 600, 110],
  [214, 304, 120, 116],
  [300, 92, 120, 116],
  [492, 344, 352, 332],
];

const T1 = { x: 360, y: 84 }; // the "checkout" topic
const NEW = { x: 360, y: 208 }; // the arriving chat fact (falls down the centre lane)
const V1 = { x: 282, y: 338 }; // spec fact v1 — superseded when the doc re-syncs
const V2 = { x: 392, y: 318 }; // spec fact v2 — carried in by the doc packet
const DOC = { x: 214, y: 304 }; // the live payment-sheet spec

function InsideGraph() {
  return (
    <div
      className="fsysGWrap"
      role="img"
      aria-label="Inside the Follow index: the team's memory as a small knowledge graph, with member, conversation, file, fact and topic nodes joined by produced, authored, uploaded, topic-tag and contradicts edges. In a loop, a new fact (“default to guest checkout”) arrives from Maya's thread, is linked to its source and tagged to the checkout topic, and contradicts Alex's LTV read, flagged red with both kept. Then the live payment-sheet spec re-syncs: a document packet lands as fact version 2, superseding version 1, which stays as a ghost. A query finally pulls the answer back out with its source. A legend sits below the graph."
    >
      <div className="fsysGStage">
        <svg className="fsysG" viewBox="0 0 720 420" aria-hidden="true">
          {/* ---- standing edges (under everything) ---- */}
          {G_HUB.map(([x1, y1, x2, y2]) => (
            <line key={`h${x1}${y1}${x2}`} className="fsysGEHub" x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
          {G_PROD.map(([x1, y1, x2, y2]) => (
            <line key={`p${x1}${y1}${x2}`} className="fsysGEProd" x1={x1} y1={y1} x2={x2} y2={y2} />
          ))}
          {/* the contested pair shares the checkout topic */}
          <line className="fsysGETag" x1={452} y1={220} x2={T1.x} y2={T1.y} />

          {/* ---- animated edges ---- */}
          <line className="fsysGEProd fsysGLinkA fsysGE1" pathLength={1} x1={NEW.x} y1={NEW.y} x2={196} y2={182} />
          <line className="fsysGETag fsysGE2" x1={NEW.x} y1={NEW.y} x2={T1.x} y2={T1.y + 11} />
          <line className="fsysGTie fsysGTieA" pathLength={1} x1={NEW.x} y1={NEW.y} x2={452} y2={220} />
          <line className="fsysGEProd fsysGLinkA fsysGE3" pathLength={1} x1={V2.x} y1={V2.y} x2={DOC.x} y2={DOC.y} />
          <line className="fsysGSup fsysGLinkA fsysGSupA" pathLength={1} x1={V2.x} y1={V2.y} x2={V1.x} y2={V1.y} />
          <polygon className="fsysGSupTip" points="290.4,336.5 296.2,331.9 297.4,338.6" />

          {/* ---- nodes ---- */}
          {G_CONVS.map((c) => (
            <rect
              key={`c${c.x}`}
              className="fsysGConv"
              x={c.x - 8}
              y={c.y - 8}
              width="16"
              height="16"
              rx="3"
              fill={c.c}
              stroke={c.c}
            />
          ))}
          {G_FILES.map((f) => (
            <rect key={`f${f.x}`} className="fsysGFile" x={f.x - 7.5} y={f.y - 9} width="15" height="18" rx="2" />
          ))}
          <circle className="fsysGTopic" cx={T1.x} cy={T1.y} r="11" />
          {G_MEMBERS.map((m) => (
            <g key={m.letter}>
              <circle cx={m.x} cy={m.y} r="13" fill={m.c} />
              <text className="fsysGMemberTxt" x={m.x} y={m.y + 4} textAnchor="middle">
                {m.letter}
              </text>
            </g>
          ))}
          {G_FACTS.map((f) => (
            <circle key={`x${f.x}`} className="fsysGFact" cx={f.x} cy={f.y} r="7" />
          ))}

          {/* spec fact v1 — ghosts when the doc's re-sync supersedes it */}
          <circle className="fsysGFact fsysGV1" cx={V1.x} cy={V1.y} r="7" />
          <circle className="fsysGV1Ring" cx={V1.x} cy={V1.y} r="11" />

          {/* the arriving chat fact + the doc-carried v2 */}
          <circle className="fsysGFact fsysGNew" cx={NEW.x} cy={NEW.y} r="8" />
          <circle className="fsysGFact fsysGV2" cx={V2.x} cy={V2.y} r="7" />

          {/* contested pulses on both parties */}
          <circle className="fsysGPulse fsysGPu1" cx={NEW.x} cy={NEW.y} r="14" />
          <circle className="fsysGPulse fsysGPu2" cx={452} cy={220} r="12" />

          {/* the live doc's sync pulse + its square packet riding to v2 */}
          <circle className="fsysGSync" cx={DOC.x} cy={DOC.y} r="16" />
          <rect className="fsysGPktDoc" x={DOC.x - 4} y={DOC.y - 4} width="8" height="8" />

          {/* write packet in · query ring + read packet out */}
          <circle className="fsysGPktIn1" cx={NEW.x} cy="-16" r="5" />
          <circle className="fsysGRing" cx={NEW.x} cy={NEW.y} r="12" />
          <circle className="fsysGPktOut" cx={NEW.x} cy={NEW.y} r="5" />

          {/* ---- labels (hidden on phones — captions + legend carry it) ---- */}
          <g className="fsysGLbls">
            {G_MEMBERS.map((m) => (
              <text key={`lm${m.letter}`} className="fsysGLbl fsysGLblDim" x={m.x} y={m.y + 27} textAnchor="middle">
                {m.label}
              </text>
            ))}
            {G_CONVS.map((c) => (
              <text key={`lc${c.x}`} className="fsysGLbl fsysGLblDim" x={c.x} y={c.ly} textAnchor="middle">
                {c.label}
              </text>
            ))}
            {G_FILES.map((f) => (
              <text key={`lf${f.x}`} className="fsysGLbl fsysGLblDim" x={f.x} y={f.y + 21} textAnchor="middle">
                {f.label}
              </text>
            ))}
            <text className="fsysGLbl fsysGLblDim" x={T1.x + 16} y={T1.y + 4} textAnchor="start">
              checkout · topic
            </text>
            {G_FACTS.map((f) => (
              <text
                key={`lx${f.x}`}
                className="fsysGLbl"
                x={f.lx ?? f.x}
                y={f.ly ?? f.y + 18}
                textAnchor={f.anchor ?? "middle"}
              >
                {f.label}
              </text>
            ))}
            {/* right-aligned so it clears Alex's member label below it */}
            <text className="fsysGLbl fsysGLblV1" x={V1.x - 12} y={V1.y + 18} textAnchor="end">
              spec fact · v1
            </text>
            <text className="fsysGLbl fsysGLblN" x={NEW.x} y={NEW.y + 20} textAnchor="middle">
              guest default · Maya
            </text>
            <text className="fsysGLbl fsysGLblV2" x={V2.x + 14} y={V2.y + 4} textAnchor="start">
              spec fact · v2
            </text>
          </g>
        </svg>

        <div className="fsysGCaps" aria-hidden="true">
          <span className="fsysGCap fsysGCap1">“default to guest checkout” lands as a decision from Maya’s thread</span>
          <span className="fsysGCap fsysGCap2">typed edges: produced by its thread · tagged to the checkout topic</span>
          <span className="fsysGCap fsysGCap3">it contradicts Alex’s LTV read: red tie, both stay live</span>
          <span className="fsysGCap fsysGCap4">the spec doc re-syncs: v2 supersedes v1; the old version stays in the trail</span>
          <span className="fsysGCap fsysGCap5">a query pulls it back out, answer with author + source attached</span>
          <span className="fsysGCap fsysGCap6">one graph: chats and documents, every version kept</span>
          <span className="fsysGCapStatic">
            the team’s memory as a graph: chats and documents in, typed edges, versions kept
          </span>
        </div>
      </div>

      <div className="fsysGLegend" aria-hidden="true">
        <span>
          <i className="fsysLgMem" style={{ background: GF.maya }} />
          <i className="fsysLgMem" style={{ background: GF.alex }} />
          <i className="fsysLgMem" style={{ background: GF.sam }} />
          Maya · Alex · Sam
        </span>
        <span>
          <i className="fsysLgDot" />
          fact
        </span>
        <span>
          <i className="fsysLgConv" />
          conversation
        </span>
        <span>
          <i className="fsysLgFile" />
          file · uploaded · live
        </span>
        <span>
          <i className="fsysLgTopic" />
          topic
        </span>
        <span>
          <i className="fsysLgLn" />
          produced · authored
        </span>
        <span>
          <i className="fsysLgLn fsysLgLnTag" />
          topic tag
        </span>
        <span>
          <i className="fsysLgLn fsysLgLnTie" />
          contradicts
        </span>
        <span>
          <b className="fsysLgSup">→</b>
          supersedes
        </span>
        <span>
          <i className="fsysLgGhost" />
          superseded · kept
        </span>
      </div>
    </div>
  );
}

export default function FollowSystem() {
  // hover + tap/keyboard tracked separately so a focused station survives the
  // mouse wandering off. Same enter/leave + focus/blur quartet as TermTip /
  // the GhApp principle chips (tap works through the browser's synthetic
  // mouseenter, the pattern already proven live on this site).
  const [hovered, setHovered] = useState<Station | null>(null);
  const [picked, setPicked] = useState<Station | null>(null);
  const [openInside, setOpenInside] = useState(false);
  const active: Station | "idle" = hovered ?? picked ?? "idle";

  const st = (id: Station) => ({
    onMouseEnter: () => setHovered(id),
    onMouseLeave: () => setHovered((h) => (h === id ? null : h)),
    onFocus: () => setPicked(id),
    onBlur: () => setPicked((p) => (p === id ? null : p)),
    "aria-label": ARIA[id],
  });

  const cap = CAPTIONS[active];

  return (
    <div
      className={`fsys${active !== "idle" ? " fsysHas" : ""}`}
      data-active={active}
      role="group"
      aria-label="How Follow works, an interactive diagram. Three teammates with their AI tools and the team's documents sit above the shared Follow index; chats and docs flow in, attributed answers flow back. The index opens to show the knowledge graph inside."
    >
      <div className="fsysStage">
        {/* the sources row: three person·tool pairs + the documents chip */}
        <div className="fsysRow">
          <button type="button" className="fsysHit fsysTeam" {...st("team")}>
            {PAIRS.map((p, i) => (
              <span
                key={p.name}
                className="fsysPair"
                style={{ "--i": i } as React.CSSProperties}
              >
                <span className={`fsysAv ${p.av}`} aria-hidden="true">
                  {p.name[0]}
                </span>
                <span className="fsysWho">
                  <span className="fsysName">{p.name}</span>
                  <span className="fsysTool">{p.tool}</span>
                </span>
              </span>
            ))}
          </button>
          <button type="button" className="fsysHit fsysDocs" {...st("docs")}>
            <span className="fsysPair" style={{ "--i": 3 } as React.CSSProperties}>
              <span className="fsysAvDoc" aria-hidden="true">
                <i />
                <i />
              </span>
              <span className="fsysWho">
                <span className="fsysName">Team docs</span>
                <span className="fsysTool fsysDocsSub">live · uploaded</span>
              </span>
            </span>
          </button>
        </div>

        <div className="fsysFlow">
          <svg className="fsysWires" width="100%" height="100%" aria-hidden="true">
            {WIRE_CHAT.map((x, i) => (
              <g key={x} style={{ "--i": i } as React.CSSProperties}>
                <line className="fsysLine" x1={x} y1="0" x2={x} y2="100%" />
                <circle className="fsysPkt fsysPktDown" cx={x} cy="0" r="3.6" />
                <circle className="fsysPkt fsysPktUp" cx={x} cy="0" r="3.6" />
              </g>
            ))}
            {/* the documents lane — square packets, write-only */}
            <line className="fsysLine fsysLineDoc" x1={WIRE_DOC} y1="0" x2={WIRE_DOC} y2="100%" />
            {[0, 1].map((i) => (
              <rect
                key={`doc${i}`}
                className="fsysPkt fsysPktDoc"
                x={WIRE_DOC}
                y="-8"
                width="7.2"
                height="7.2"
                style={{ "--i": i } as React.CSSProperties}
              />
            ))}
          </svg>
          <button
            type="button"
            className="fsysHit fsysPill fsysPillCap"
            {...st("capture")}
          >
            <span className="fsysPillArrow" aria-hidden="true">
              ↓
            </span>
            every chat files itself
          </button>
          <button
            type="button"
            className="fsysHit fsysPill fsysPillRec"
            {...st("recall")}
          >
            answers come back
            <span className="fsysPillArrow" aria-hidden="true">
              ↑
            </span>
          </button>
        </div>

        {/* the shared layer — a colored slab that opens from its top edge:
            the inside view sits ABOVE the label in the DOM, so the reveal
            unfolds upward, toward the wires the data falls in from */}
        <div className={`fsysLayer${openInside ? " fsysOpen" : ""}`}>
          <div className="fsysInside" id="fsys-inside" aria-hidden={!openInside}>
            <div className="fsysInsideClip">
              <InsideGraph />
            </div>
          </div>
          <button
            type="button"
            className="fsysHit fsysLayerBtn"
            {...st("layer")}
            aria-expanded={openInside}
            aria-controls="fsys-inside"
            onClick={() => setOpenInside((o) => !o)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && openInside) setOpenInside(false);
            }}
          >
            <span className="fsysPeek" aria-hidden="true">
              {openInside ? "close ▴" : "click to look inside ▾"}
            </span>
            <span className="fsysLayerTag">the shared layer</span>
            <span className="fsysLayerName">
              The Follow index<span className="fsysLayerDot">.</span>
            </span>
            <span className="fsysLayerPillars">
              one memory · sources kept · disagreements flagged · who knows what
            </span>
          </button>
        </div>
      </div>

      {/* persistent live region; only the children swap, so the change is
          announced (a remounted region itself often isn't) */}
      <div className="fsysDock" role="status" aria-live="polite">
        <div className="fsysDockIn" key={active}>
          <p className="fsysDockTag">{cap.tag}</p>
          <p className="fsysDockBody">{cap.body}</p>
          {cap.eg ? <p className="fsysDockEg">{cap.eg}</p> : null}
        </div>
      </div>
    </div>
  );
}
