"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FEntry } from "@/lib/followSandbox";
import type { FChat, FDoc } from "@/lib/followProduct";
import {
  buildFollowGraph,
  createGraphSim,
  projectNode,
  type Camera,
  type GEdge,
  type GNode,
  type Vec3,
} from "@/lib/followGraph";
import s from "./FollowSandbox.module.css";

/**
 * Graph — the knowledge graph under the sandbox workspace, hand-rolled on a
 * 2D canvas with a perspective projection (no 3D library, no new deps). The
 * shipped Follow product renders this same structure (facts wired to their
 * source thread/file, contradictions in red) in its Knowledge view — this
 * mirrors it over the sandbox's own 32-fact memory.
 *
 * Ownership split: lib/followGraph.ts is pure layout math (buildFollowGraph +
 * createGraphSim + projectNode); everything here is camera, input, painting.
 *
 * CRITICAL: the first frame paints SYNCHRONOUSLY on mount (not inside a rAF
 * callback) — hidden tabs never fire rAF, and automated verification runs in
 * a hidden tab. The rAF loop then animates the settle + auto-rotate on top.
 */

const TOOL_COLOR: Record<string, string> = {
  Claude: "#D97757",
  ChatGPT: "#10A37F",
  Gemini: "#4285F4",
};
const TOOL_COLOR_DEFAULT = "#8a8377";
const FILE_COLOR = "#7a5f3c";
const FACT_COLOR = "#C2410C";
const CONTESTED_COLOR = "#b3423a";
const TOPIC_COLOR = "#9a938a";

const NODE_RADIUS: Record<GNode["kind"], number> = {
  member: 11,
  conversation: 6.5,
  file: 6.5,
  topic: 5,
  fact: 3.5,
};
const CONTESTED_FACT_RADIUS = 5;

const HOVER_PX = 12;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.6;
const BASE_DISTANCE = 230;
const FOCAL = 260;
const AUTO_ROTATE_SPEED = 0.00022; // radians/ms, idle-only
const SETTLE_ENERGY_FLOOR = 0.15; // below this the layout is visually still

/* lighter tint of a tool color, used for conversation nodes so members read
   as the "anchor" and conversations as their lighter satellites */
function tint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function nodeColor(node: GNode): string {
  if (node.kind === "file") return FILE_COLOR;
  if (node.kind === "topic") return TOPIC_COLOR;
  if (node.kind === "fact") return node.contested ? CONTESTED_COLOR : FACT_COLOR;
  const toolColor = (node.tool && TOOL_COLOR[node.tool]) || TOOL_COLOR_DEFAULT;
  if (node.kind === "conversation") return tint(toolColor, 0.35);
  return toolColor; // member
}

function nodeRadius(node: GNode): number {
  if (node.kind === "fact" && node.contested) return CONTESTED_FACT_RADIUS;
  return NODE_RADIUS[node.kind];
}

type HoverInfo = { node: GNode; screenX: number; screenY: number } | null;

export default function GraphView({
  entries,
  chats,
  docs,
  onOpenChat,
  onOpenDoc,
  onOpenFactTopic,
  onOpenDirectory,
}: {
  entries: FEntry[];
  chats: FChat[];
  docs: FDoc[];
  onOpenChat: (id: string) => void;
  onOpenDoc: (id: string) => void;
  onOpenFactTopic: (topic: string) => void;
  onOpenDirectory: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<HoverInfo>(null);

  // graph structure is derived once per (entries, chats, docs) identity —
  // stable across re-renders unless the underlying data actually changes.
  const graph = useMemo(() => buildFollowGraph(entries, chats, docs), [entries, chats, docs]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nodes = graph.nodes;
    const edges = graph.edges;
    const sim = createGraphSim(nodes, edges, 42);
    const positions: Vec3[] = sim.positions;

    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const camera: Camera = { yaw: 0.5, pitch: 0.28, distance: BASE_DISTANCE, focal: FOCAL };
    let zoom = 1;
    let dpr = Math.max(1, window.devicePixelRatio || 1);
    let cssW = 0;
    let cssH = 0;

    let dragging = false;
    let lastPX = 0;
    let lastPY = 0;
    let interactedSinceIdle = false;
    let lastInteractionAt = 0;
    let settled = false;
    let raf = 0;
    let lastFrameTime = 0;
    let hoveredNodeIndex = -1;

    // ---- sizing (devicePixelRatio-aware; ResizeObserver keeps it current) ----
    function resize() {
      const rect = wrap!.getBoundingClientRect();
      cssW = Math.max(1, Math.round(rect.width));
      cssH = Math.max(1, Math.round(rect.height));
      dpr = Math.max(1, window.devicePixelRatio || 1);
      canvas!.width = Math.round(cssW * dpr);
      canvas!.height = Math.round(cssH * dpr);
      canvas!.style.width = `${cssW}px`;
      canvas!.style.height = `${cssH}px`;
    }

    // ---- projection + painting (a single synchronous function; called both
    // from the mount effect directly AND from the rAF loop, satisfying the
    // "first frame renders synchronously" requirement) ----
    type Proj = { node: GNode; index: number; x: number; y: number; depth: number; scale: number };

    function computeProjections(): Proj[] {
      const cam = { ...camera, distance: BASE_DISTANCE / zoom };
      const out: Proj[] = new Array(nodes.length);
      for (let i = 0; i < nodes.length; i++) {
        const p = projectNode(positions[i], cam);
        out[i] = { node: nodes[i], index: i, x: p.x, y: p.y, depth: p.depth, scale: p.scale };
      }
      return out;
    }

    function fogAlpha(depth: number, minD: number, maxD: number): number {
      if (maxD <= minD) return 1;
      const t = (depth - minD) / (maxD - minD); // 0 near, 1 far
      return 1 - t * 0.65; // far nodes fade ~65% toward the backdrop
    }

    function paint() {
      const projections = computeProjections();
      let minD = Infinity;
      let maxD = -Infinity;
      for (const p of projections) {
        if (p.depth < minD) minD = p.depth;
        if (p.depth > maxD) maxD = p.depth;
      }
      // painter's algorithm: far-to-near
      const order = [...projections].sort((a, b) => b.depth - a.depth);
      const cx = cssW / 2;
      const cy = cssH / 2;

      ctx!.save();
      ctx!.scale(dpr, dpr);
      ctx!.clearRect(0, 0, cssW, cssH);

      const cardBg = getComputedStyle(wrap!).getPropertyValue("--card").trim() || "#fcfbf7";
      const lineColor = getComputedStyle(wrap!).getPropertyValue("--line").trim() || "#d9d6cd";

      // ---- edges first, split so contradicts draws last-among-edges ----
      const byIndex = new Map(projections.map((p) => [p.index, p]));
      const normalEdges: GEdge[] = [];
      const contradictEdges: GEdge[] = [];
      for (const e of edges) (e.kind === "contradicts" ? contradictEdges : normalEdges).push(e);

      function drawEdge(e: GEdge, hovered: boolean) {
        const a = byIndex.get(nodeIndexOf(e.source));
        const b = byIndex.get(nodeIndexOf(e.target));
        if (!a || !b) return;
        const avgDepth = (a.depth + b.depth) / 2;
        const fog = fogAlpha(avgDepth, minD, maxD);
        let alpha: number;
        let width: number;
        let color: string;
        if (e.kind === "contradicts") {
          color = CONTESTED_COLOR;
          width = 2;
          alpha = hovered ? 1 : 0.85 * fog;
        } else if (e.kind === "topic") {
          color = lineColor;
          width = 0.75;
          alpha = hovered ? 0.9 : 0.22 * fog;
        } else {
          color = lineColor;
          width = 1;
          alpha = hovered ? 1 : 0.55 * fog;
        }
        ctx!.strokeStyle = color;
        ctx!.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx!.lineWidth = width;
        ctx!.beginPath();
        ctx!.moveTo(cx + a.x, cy + a.y);
        ctx!.lineTo(cx + b.x, cy + b.y);
        ctx!.stroke();
      }

      const hoveredNode = hoveredNodeIndex >= 0 ? nodes[hoveredNodeIndex] : null;
      const hoveredId = hoveredNode ? nodes[hoveredNodeIndex].id : null;
      for (const e of normalEdges) {
        const hovered = !!hoveredId && (e.source === hoveredId || e.target === hoveredId);
        drawEdge(e, hovered);
      }
      for (const e of contradictEdges) {
        const hovered = !!hoveredId && (e.source === hoveredId || e.target === hoveredId);
        drawEdge(e, hovered);
      }
      ctx!.globalAlpha = 1;

      // ---- nodes, far to near ----
      for (const p of order) {
        const node = p.node;
        const fog = fogAlpha(p.depth, minD, maxD);
        const r = Math.max(1.2, nodeRadius(node) * p.scale);
        const color = nodeColor(node);
        const isHovered = p.index === hoveredNodeIndex;

        // contested-fact halo ring
        if (node.kind === "fact" && node.contested) {
          ctx!.beginPath();
          ctx!.arc(cx + p.x, cy + p.y, r + 2.5, 0, Math.PI * 2);
          ctx!.strokeStyle = CONTESTED_COLOR;
          ctx!.lineWidth = 1.4;
          ctx!.globalAlpha = isHovered ? 1 : 0.75 * fog;
          ctx!.stroke();
        }
        if (isHovered) {
          ctx!.beginPath();
          ctx!.arc(cx + p.x, cy + p.y, r + 4, 0, Math.PI * 2);
          ctx!.strokeStyle = color;
          ctx!.lineWidth = 1.6;
          ctx!.globalAlpha = 0.9;
          ctx!.stroke();
        }

        ctx!.beginPath();
        ctx!.arc(cx + p.x, cy + p.y, r, 0, Math.PI * 2);
        ctx!.fillStyle = mixToward(color, cardBg, isHovered ? 0 : (1 - fog) * 0.7);
        ctx!.globalAlpha = isHovered ? 1 : Math.max(0.25, fog);
        ctx!.fill();

        // member labels are always-on
        if (node.kind === "member") {
          ctx!.globalAlpha = Math.max(0.35, fog);
          ctx!.fillStyle = getComputedStyle(wrap!).getPropertyValue("--ink").trim() || "#1a1a1a";
          ctx!.font = "600 13px var(--font-body, Inter, sans-serif)";
          ctx!.textAlign = "center";
          ctx!.textBaseline = "top";
          ctx!.fillText(node.label, cx + p.x, cy + p.y + r + 3);
        }
      }
      ctx!.globalAlpha = 1;
      ctx!.restore();
    }

    // node id -> index (built once; nodes array is stable per mount)
    const idIndex = new Map<string, number>();
    nodes.forEach((n, i) => idIndex.set(n.id, i));
    function nodeIndexOf(id: string): number {
      return idIndex.get(id) ?? -1;
    }

    function mixToward(hex: string, target: string, t: number): string {
      if (t <= 0) return hex;
      const parse = (h: string) => {
        if (h.startsWith("rgb")) {
          const m = h.match(/[\d.]+/g) || ["0", "0", "0"];
          return [Number(m[0]), Number(m[1]), Number(m[2])];
        }
        const n = parseInt(h.replace("#", ""), 16);
        return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
      };
      const [r1, g1, b1] = parse(hex);
      const [r2, g2, b2] = parse(target || "#fcfbf7");
      const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
      return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`;
    }

    function findHover(clientX: number, clientY: number): number {
      const rect = canvas!.getBoundingClientRect();
      const px = clientX - rect.left - cssW / 2;
      const py = clientY - rect.top - cssH / 2;
      const projections = computeProjections();
      let best = -1;
      let bestDist = HOVER_PX;
      for (const p of projections) {
        const dx = p.x - px;
        const dy = p.y - py;
        const d = Math.sqrt(dx * dx + dy * dy);
        const r = nodeRadius(p.node) * p.scale;
        if (d <= Math.max(HOVER_PX, r + 4) && d < bestDist) {
          bestDist = d;
          best = p.index;
        }
      }
      return best;
    }

    // ---- resize plumbing ----
    resize();
    const ro = new ResizeObserver(() => {
      resize();
      paint();
    });
    ro.observe(wrap!);

    // ---- FIRST FRAME: synchronous, not inside rAF — hidden tabs never fire
    // rAF, and automated verification runs in a hidden tab. ----
    paint();

    // ---- interaction: pointer drag rotates, wheel zooms ----
    function markInteracted() {
      interactedSinceIdle = true;
      lastInteractionAt = performance.now();
    }

    function onPointerDown(e: PointerEvent) {
      dragging = true;
      lastPX = e.clientX;
      lastPY = e.clientY;
      markInteracted();
      canvas!.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (dragging) {
        const dx = e.clientX - lastPX;
        const dy = e.clientY - lastPY;
        lastPX = e.clientX;
        lastPY = e.clientY;
        camera.yaw += dx * 0.0055;
        camera.pitch += dy * 0.0045;
        const limit = Math.PI / 2 - 0.05;
        camera.pitch = Math.max(-limit, Math.min(limit, camera.pitch));
        markInteracted();
        paint(); // synchronous re-render after interaction
      } else {
        const idx = findHover(e.clientX, e.clientY);
        if (idx !== hoveredNodeIndex) {
          hoveredNodeIndex = idx;
          if (idx >= 0) {
            const p = computeProjections().find((pp) => pp.index === idx);
            if (p) {
              setHover({
                node: nodes[idx],
                screenX: cssW / 2 + p.x,
                screenY: cssH / 2 + p.y,
              });
            }
          } else {
            setHover(null);
          }
          paint();
        }
        canvas!.style.cursor = idx >= 0 ? "pointer" : "grab";
      }
    }
    function onPointerUp(e: PointerEvent) {
      dragging = false;
      try {
        canvas!.releasePointerCapture(e.pointerId);
      } catch {
        /* no-op — pointer may already be released */
      }
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const delta = e.deltaY * 0.0016;
      zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom - delta));
      markInteracted();
      paint();
    }
    function onClick(e: MouseEvent) {
      const idx = findHover(e.clientX, e.clientY);
      if (idx < 0) return;
      const node = nodes[idx];
      if (node.kind === "conversation" && node.refId) onOpenChat(node.refId);
      else if (node.kind === "file" && node.refId) onOpenDoc(node.refId);
      else if (node.kind === "fact" && node.refId) onOpenFactTopic(node.refId);
      else if (node.kind === "topic" && node.refId) onOpenFactTopic(node.refId);
      else if (node.kind === "member") onOpenDirectory();
    }

    canvas!.addEventListener("pointerdown", onPointerDown);
    canvas!.addEventListener("pointermove", onPointerMove);
    canvas!.addEventListener("pointerup", onPointerUp);
    canvas!.addEventListener("pointercancel", onPointerUp);
    canvas!.addEventListener("wheel", onWheel, { passive: false });
    canvas!.addEventListener("click", onClick);

    // ---- rAF loop: settle ticks while energy is high, then idle auto-rotate.
    // Auto-rotate pauses on interaction, when the tab is hidden (document.hidden
    // is checked every frame below — no separate visibilitychange listener
    // needed, the rAF loop simply skips advancing rotation that frame), and
    // entirely under prefers-reduced-motion (the settle ticks still run once
    // to lay the graph out; only the idle rotation is gated). ----
    function frame(t: number) {
      const dt = lastFrameTime ? t - lastFrameTime : 16;
      lastFrameTime = t;

      let didWork = false;

      if (!settled) {
        const energy = sim.tick();
        if (energy < SETTLE_ENERGY_FLOOR) settled = true;
        didWork = true;
      }

      const idleFor = t - lastInteractionAt;
      const isIdle = !dragging && (!interactedSinceIdle || idleFor > 900);
      if (isIdle && !reduceMotion && !document.hidden) {
        camera.yaw += AUTO_ROTATE_SPEED * dt;
        didWork = true;
      }

      if (didWork) paint();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      canvas!.removeEventListener("pointerdown", onPointerDown);
      canvas!.removeEventListener("pointermove", onPointerMove);
      canvas!.removeEventListener("pointerup", onPointerUp);
      canvas!.removeEventListener("pointercancel", onPointerUp);
      canvas!.removeEventListener("wheel", onWheel);
      canvas!.removeEventListener("click", onClick);
    };
    // graph is derived from entries/chats/docs via useMemo above; re-running
    // this effect when `graph` changes remounts the sim (reseeds deterministically).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, onOpenChat, onOpenDoc, onOpenFactTopic, onOpenDirectory]);

  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;
  const contestedCount = graph.edges.filter((e) => e.kind === "contradicts").length;

  const ariaLabel = `3D knowledge graph: ${nodeCount} nodes (members, conversations, files, facts, and topics) connected by ${edgeCount} edges, including ${contestedCount} contradiction${contestedCount === 1 ? "" : "s"}. Drag to rotate, scroll to zoom, click a node to open it.`;

  return (
    <>
      <p className={s.graphBlurb}>
        ◆ the whole memory as one structure. Drag the graph to look around.
      </p>
      <div
        ref={wrapRef}
        className={s.graphWrap}
        role="img"
        aria-label={ariaLabel}
        data-graph-nodes={nodeCount}
        data-graph-edges={edgeCount}
      >
        <canvas ref={canvasRef} className={s.graphCanvas} />
        {hover && (
          <div
            className={s.graphTooltip}
            style={{ left: hover.screenX, top: hover.screenY }}
            aria-hidden="true"
          >
            <span className={s.graphTooltipKind}>{hover.node.kind}</span>
            <span className={s.graphTooltipLabel}>{hover.node.label}</span>
            {hover.node.contested && <span className={s.graphTooltipZap}>⚡ contested</span>}
            <span className={s.graphTooltipHint}>click to open</span>
          </div>
        )}
      </div>
      <div className={s.graphLegend}>
        <span className={s.graphLegendItem}>
          <span className={s.graphDot} style={{ background: TOOL_COLOR_DEFAULT }} /> member
        </span>
        <span className={s.graphLegendItem}>
          <span className={s.graphDot} style={{ background: tint(TOOL_COLOR.Claude, 0.35) }} /> conversation
        </span>
        <span className={s.graphLegendItem}>
          <span className={s.graphDot} style={{ background: FILE_COLOR }} /> file
        </span>
        <span className={s.graphLegendItem}>
          <span className={s.graphDot} style={{ background: FACT_COLOR }} /> fact
        </span>
        <span className={s.graphLegendItem}>
          <span className={s.graphZap}>⚡</span> contested
        </span>
        <span className={s.graphLegendItem}>
          <span className={s.graphDot} style={{ background: TOPIC_COLOR }} /> topic
        </span>
      </div>
      <p className={s.graphHint}>drag to rotate · scroll to zoom · click a node to open it</p>
    </>
  );
}
