import "./FollowSystem.css";

/**
 * Before Follow — the problem picture, in the SAME design language as
 * FollowSystem (person·tool chips + the team's docs · dashed wires · a
 * slab), but grey and broken: the docs are just as much the source here —
 * nothing about them is stale — yet their context evaporates mid-wire
 * exactly like the chats' (no shared memory between any of it), and the
 * only place anything converges is THE MEETING — a navy slab that forgets.
 * The slab geometry deliberately rhymes with the response section's
 * Follow-index slab: same shape, opposite fate. Static server component;
 * shares FollowSystem.css (`.fsys.fsysBefore`).
 */

const PAIRS = [
  { name: "Maya", tool: "Claude", av: "fsysAvClaude" },
  { name: "Alex", tool: "ChatGPT", av: "fsysAvChatGPT" },
  { name: "Sam", tool: "Gemini", av: "fsysAvGemini" },
] as const;

const WIRE_CHAT = ["12.5%", "37.5%", "62.5%"] as const;
const WIRE_DOC = "87.5%";

export default function BeforeSystem() {
  return (
    <figure
      className="fsys fsysBefore"
      role="img"
      aria-label="Before Follow: Maya with Claude, Alex with ChatGPT, Sam with Gemini, and the team's documents, the same sources. Each chat's and each doc's context evaporates between them, with no shared memory, and the only place anything meets is the meeting, which forgets what it doesn’t know."
    >
      <div className="fsysStage">
        <div className="fsysRow">
          <div className="fsysTeam">
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
          </div>
          <div className="fsysDocs">
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
          </div>
        </div>

        <div className="fsysFlow">
          <svg className="fsysWires" width="100%" height="100%" aria-hidden="true">
            {WIRE_CHAT.map((x, i) => (
              <g key={x} style={{ "--i": i } as React.CSSProperties}>
                <line className="fsysLine" x1={x} y1="0" x2={x} y2="100%" />
                {/* context drops out of each chat… and evaporates mid-wire */}
                <circle className="fsysPkt fsysPktLost" cx={x} cy="0" r="3.6" />
              </g>
            ))}
            {/* …and out of the docs, the same way — the source is fine, the
                sharing is what's broken */}
            <line className="fsysLine" x1={WIRE_DOC} y1="0" x2={WIRE_DOC} y2="100%" />
            <rect
              className="fsysPkt fsysPktLostSq"
              x={WIRE_DOC}
              y="-8"
              width="7.2"
              height="7.2"
              style={{ "--i": 3 } as React.CSSProperties}
            />
          </svg>
          <span className="fsysPill fsysPillNo" aria-hidden="true">
            <span className="fsysPillArrow">✕</span>
            no shared memory
          </span>
        </div>

        <div className="fsysMeet">
          <span className="fsysMeetTag">the only place it meets</span>
          <span className="fsysMeetName">
            The meeting<span className="fsysMeetDot">.</span>
          </span>
          <span className="fsysMeetPillars">
            partial recaps · no sources · forgets what it doesn’t know
          </span>
        </div>
      </div>

      <figcaption className="fsysSub">
        Each teammate works with their own AI in a private thread, the team’s
        docs sit off to the side, and the only place it all meets is a
        meeting, which forgets what it doesn’t know.
      </figcaption>
    </figure>
  );
}
