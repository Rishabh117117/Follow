/* =========================================================================
   Follow — the knowledge-graph data layer (pure logic, no React, no DOM).

   The shipped Follow product renders a force-directed graph in its Knowledge
   view: every fact wired to the thread or file it came from, contradictions
   drawn in red. This mirrors that structure over the sandbox's own memory
   (lib/followSandbox.ts + lib/followProduct.ts) — same 32 facts, 16 threads,
   7 files, same 3 contested pairs.

   Two responsibilities, kept strictly separate so the sim stays testable:
     - buildFollowGraph()  — nodes + edges from the sandbox data (pure, sync)
     - createGraphSim()    — a seeded 3D force layout (pure, sync, no timers)

   The view (app/work/follow/GraphView.tsx) owns the canvas, camera, and
   projection; nothing in this file touches a Canvas2DContext or window.
   ========================================================================= */

import { F_MEMBERS, F_YOU, type FEntry, type FTool } from "./followSandbox";
import { fSourceForEntry, type FChat, type FDoc } from "./followProduct";

/* ------------------------------- graph types ---------------------------- */

export type GNodeKind = "member" | "conversation" | "file" | "fact" | "topic";

export type GNode = {
  id: string;
  kind: GNodeKind;
  label: string;
  memberId?: string;
  tool?: FTool;
  contested?: boolean;
  refId?: string; // chat id / doc id / topic string the node opens to
};

export type GEdgeKind = "authored" | "uploaded" | "produced" | "contradicts" | "topic";

export type GEdge = {
  source: string; // GNode.id
  target: string; // GNode.id
  kind: GEdgeKind;
};

export type FollowGraph = { nodes: GNode[]; edges: GEdge[] };

/* ------------------------------ graph builder ---------------------------- */

const CLAIM_SLICE = 48;

function claimLabel(claim: string): string {
  return claim.length > CLAIM_SLICE ? `${claim.slice(0, CLAIM_SLICE).trimEnd()}…` : claim;
}

/**
 * Build the knowledge graph from the sandbox's live data. Deterministic:
 * calling this twice with the same inputs yields identically-ordered nodes
 * and edges (the sim's seeded RNG then gives a stable initial layout on top).
 */
export function buildFollowGraph(entries: FEntry[], chats: FChat[], docs: FDoc[]): FollowGraph {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (n: GNode) => {
    if (nodeIds.has(n.id)) return;
    nodeIds.add(n.id);
    nodes.push(n);
  };

  /* ---- member nodes ---- */
  for (const m of F_MEMBERS) {
    addNode({ id: `member:${m.id}`, kind: "member", label: m.name, memberId: m.id, tool: m.tool });
  }
  const hasYou = entries.some((e) => e.memberId === F_YOU.id) || chats.some((c) => c.memberId === F_YOU.id);
  if (hasYou) {
    addNode({ id: `member:${F_YOU.id}`, kind: "member", label: F_YOU.name, memberId: F_YOU.id, tool: F_YOU.tool });
  }

  /* ---- conversation nodes + authored edges ---- */
  for (const c of chats) {
    const id = `conversation:${c.id}`;
    addNode({ id, kind: "conversation", label: c.title, memberId: c.memberId, tool: c.tool, refId: c.id });
    const memberNodeId = `member:${c.memberId}`;
    if (nodeIds.has(memberNodeId)) edges.push({ source: id, target: memberNodeId, kind: "authored" });
  }

  /* ---- file nodes + uploaded edges ---- */
  for (const d of docs) {
    const id = `file:${d.id}`;
    const uploader = F_MEMBERS.find((m) => m.id === d.uploaderId) ?? (d.uploaderId === F_YOU.id ? F_YOU : undefined);
    addNode({ id, kind: "file", label: d.title, memberId: d.uploaderId, tool: uploader?.tool, refId: d.id });
    const memberNodeId = `member:${d.uploaderId}`;
    if (nodeIds.has(memberNodeId)) edges.push({ source: id, target: memberNodeId, kind: "uploaded" });
  }

  /* ---- topic nodes (unique, in first-seen order) ---- */
  const topicOrder: string[] = [];
  for (const e of entries) {
    if (!topicOrder.includes(e.topic)) topicOrder.push(e.topic);
  }
  for (const topic of topicOrder) {
    addNode({ id: `topic:${topic}`, kind: "topic", label: topic, refId: topic });
  }

  /* ---- fact nodes + produced/topic edges ---- */
  for (const e of entries) {
    const id = `fact:${e.id}`;
    addNode({
      id,
      kind: "fact",
      label: claimLabel(e.claim),
      memberId: e.memberId,
      contested: !!e.contradicts,
      refId: e.topic,
    });

    const src = fSourceForEntry(e, chats, docs);
    if (src) {
      const sourceNodeId = src.kind === "chat" ? `conversation:${src.chat.id}` : `file:${src.doc.id}`;
      if (nodeIds.has(sourceNodeId)) edges.push({ source: id, target: sourceNodeId, kind: "produced" });
    } else {
      // no resolvable conversation/file source — anchor to the author instead
      // of leaving the fact floating disconnected from the graph.
      const memberNodeId = `member:${e.memberId}`;
      if (nodeIds.has(memberNodeId)) edges.push({ source: id, target: memberNodeId, kind: "produced" });
    }

    const topicNodeId = `topic:${e.topic}`;
    if (nodeIds.has(topicNodeId)) edges.push({ source: id, target: topicNodeId, kind: "topic" });
  }

  /* ---- contradicts edges — once per pair (dedupe a<b by id) ---- */
  for (const e of entries) {
    if (!e.contradicts) continue;
    if (!(e.id < e.contradicts)) continue; // only emit from the lexicographically-smaller side
    const otherId = `fact:${e.contradicts}`;
    const thisId = `fact:${e.id}`;
    if (nodeIds.has(otherId) && nodeIds.has(thisId)) {
      edges.push({ source: thisId, target: otherId, kind: "contradicts" });
    }
  }

  return { nodes, edges };
}

/* --------------------------------- 3D sim -------------------------------- */

export type Vec3 = { x: number; y: number; z: number };

/** mulberry32 — tiny, fast, deterministic PRNG (no deps). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type GraphSim = {
  /** advance one physics step; returns the remaining kinetic energy so the
   *  caller can stop ticking once the layout has settled. */
  tick(): number;
  /** positions aligned 1:1 with the `nodes` array passed to createGraphSim. */
  positions: Vec3[];
};

const REPULSION_K = 900; // pairwise repulsion strength
const CENTER_K = 0.006; // gentle pull toward the origin
const DAMPING = 0.85;
const MIN_DIST = 0.5; // floor to avoid singularities when nodes coincide

// per-edge-kind spring constants: [restLength, stiffness]
const EDGE_SPRING: Record<GEdgeKind, { length: number; k: number }> = {
  authored: { length: 34, k: 0.03 },
  uploaded: { length: 34, k: 0.03 },
  produced: { length: 26, k: 0.045 },
  contradicts: { length: 20, k: 0.05 }, // slightly shorter — pulls contested facts close
  topic: { length: 60, k: 0.012 }, // weaker + longer — topics are loose clusters
};

/**
 * A seeded 3D force layout: pairwise repulsion + spring attraction along
 * edges + gentle centering + velocity damping. O(n²) repulsion is fine at
 * the sandbox's scale (~70 nodes). Deterministic for a given seed, so the
 * graph settles into the same shape on every mount/reseed.
 */
export function createGraphSim(nodes: GNode[], edges: GEdge[], seed = 42): GraphSim {
  const rng = mulberry32(seed);
  const n = nodes.length;
  const indexOf = new Map<string, number>();
  nodes.forEach((node, i) => indexOf.set(node.id, i));

  // start positions on a sphere (deterministic jitter via the seeded RNG) —
  // avoids the all-nodes-at-origin degenerate case that repulsion can't
  // resolve on its own.
  const positions: Vec3[] = new Array(n);
  const velocities: Vec3[] = new Array(n);
  const RADIUS = 90;
  for (let i = 0; i < n; i++) {
    const u = rng() * 2 - 1; // cos(theta), uniform on [-1,1]
    const theta = Math.acos(u);
    const phi = rng() * Math.PI * 2;
    const r = RADIUS * (0.55 + rng() * 0.45);
    positions[i] = {
      x: r * Math.sin(theta) * Math.cos(phi),
      y: r * Math.sin(theta) * Math.sin(phi),
      z: r * Math.cos(theta),
    };
    velocities[i] = { x: 0, y: 0, z: 0 };
  }

  // resolve edges to index pairs once (skip any that reference an unknown id)
  const edgePairs: { a: number; b: number; length: number; k: number }[] = [];
  for (const e of edges) {
    const a = indexOf.get(e.source);
    const b = indexOf.get(e.target);
    if (a === undefined || b === undefined || a === b) continue;
    const spring = EDGE_SPRING[e.kind];
    edgePairs.push({ a, b, length: spring.length, k: spring.k });
  }

  function tick(): number {
    const forces: Vec3[] = new Array(n);
    for (let i = 0; i < n; i++) forces[i] = { x: 0, y: 0, z: 0 };

    // pairwise repulsion — O(n²), fine at this scale
    for (let i = 0; i < n; i++) {
      const pi = positions[i];
      for (let j = i + 1; j < n; j++) {
        const pj = positions[j];
        let dx = pi.x - pj.x;
        let dy = pi.y - pj.y;
        let dz = pi.z - pj.z;
        let dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < MIN_DIST) dist = MIN_DIST;
        const f = REPULSION_K / (dist * dist);
        const invDist = f / dist;
        dx *= invDist;
        dy *= invDist;
        dz *= invDist;
        forces[i].x += dx;
        forces[i].y += dy;
        forces[i].z += dz;
        forces[j].x -= dx;
        forces[j].y -= dy;
        forces[j].z -= dz;
      }
    }

    // spring attraction along edges
    for (const { a, b, length, k } of edgePairs) {
      const pa = positions[a];
      const pb = positions[b];
      const dx = pb.x - pa.x;
      const dy = pb.y - pa.y;
      const dz = pb.z - pa.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 0.0001;
      const stretch = dist - length;
      const f = stretch * k;
      const invDist = f / dist;
      const fx = dx * invDist;
      const fy = dy * invDist;
      const fz = dz * invDist;
      forces[a].x += fx;
      forces[a].y += fy;
      forces[a].z += fz;
      forces[b].x -= fx;
      forces[b].y -= fy;
      forces[b].z -= fz;
    }

    // gentle centering — keeps the whole graph from drifting off-origin
    for (let i = 0; i < n; i++) {
      forces[i].x -= positions[i].x * CENTER_K;
      forces[i].y -= positions[i].y * CENTER_K;
      forces[i].z -= positions[i].z * CENTER_K;
    }

    // integrate + damp; track kinetic energy for the caller's settle check
    let energy = 0;
    for (let i = 0; i < n; i++) {
      const v = velocities[i];
      v.x = (v.x + forces[i].x) * DAMPING;
      v.y = (v.y + forces[i].y) * DAMPING;
      v.z = (v.z + forces[i].z) * DAMPING;
      positions[i].x += v.x;
      positions[i].y += v.y;
      positions[i].z += v.z;
      energy += v.x * v.x + v.y * v.y + v.z * v.z;
    }
    return energy;
  }

  return { tick, positions };
}

/* ------------------------------- projection ------------------------------ */

export type Camera = {
  /** rotation around the vertical (Y) axis, radians */
  yaw: number;
  /** rotation around the horizontal (X) axis, radians, clamped near ±PI/2 */
  pitch: number;
  /** distance from the origin along the view axis */
  distance: number;
  /** perspective focal length — larger = less distortion, flatter look */
  focal: number;
};

export type Projected = {
  x: number;
  y: number;
  /** view-space depth (larger = farther from the camera); used for sorting
   *  and depth fog. Always > 0 for points in front of the camera. */
  depth: number;
  /** perspective scale factor (1 at the origin's average depth) */
  scale: number;
};

/**
 * Rotate a world-space point by the camera's yaw/pitch, translate along the
 * view axis by `distance`, then apply a simple perspective divide. Returns
 * screen-space coordinates centered on (0,0) — the caller offsets by the
 * canvas center. Kept pure (no canvas/DOM) so it's unit-testable alongside
 * the sim.
 */
export function projectNode(pos: Vec3, camera: Camera): Projected {
  const { yaw, pitch, distance, focal } = camera;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  // rotate around Y (yaw)
  const x1 = pos.x * cosYaw - pos.z * sinYaw;
  const z1 = pos.x * sinYaw + pos.z * cosYaw;
  const y1 = pos.y;

  // rotate around X (pitch)
  const y2 = y1 * cosPitch - z1 * sinPitch;
  const z2 = y1 * sinPitch + z1 * cosPitch;

  const depth = z2 + distance;
  const safeDepth = depth > 1 ? depth : 1; // floor — keeps behind-camera points from inverting/exploding
  const scale = focal / safeDepth;

  return { x: x1 * scale, y: y2 * scale, depth: safeDepth, scale };
}
