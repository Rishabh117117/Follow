import type { Metadata } from "next";
import Link from "next/link";
import ProjectPager from "@/components/ProjectPager/ProjectPager";
import Reveal from "@/components/Reveal/Reveal";
import Unfold from "@/components/Unfold/Unfold";
import ProjectSideNav from "@/components/ProjectSideNav/ProjectSideNav";
import SkipToDemo from "@/components/SkipToDemo/SkipToDemo";
import BeforeSystem from "./BeforeSystem";
import FollowSystem from "./FollowSystem";
import DemoTour from "./DemoTour";
import AmbientField from "./AmbientField";
import FollowSandbox from "./FollowSandbox";
import TermTip from "./TermTip";
import UnderTheHood from "./UnderTheHood";
import { FOLLOW_ROOT_STYLE } from "./theme";
import styles from "./follow.module.css";

export const metadata: Metadata = {
  title: "Follow",
  description:
    "Follow: a shared, trackable memory layer that sits between a team’s AI tools. The capstone covers the research, the two pivots, the system in one interactive picture, and a live sandbox of the shipped product.",
};

// §4.1 — the Follow accent lives in ./theme.ts (shared with the /prototype
// route); --navy (the dark band) is declared on styles.page so it stays
// scoped to this route.

const SECTIONS = [
  { id: "timeline", label: "Timeline" },
  { id: "problem", label: "The problem" },
  { id: "insights", label: "Insights" },
  { id: "response", label: "The response" },
  { id: "what-it-does", label: "What it does" },
  { id: "demo", label: "Sandbox" },
  { id: "under-the-hood", label: "Under the hood" },
];

export default function FollowPage() {
  return (
    <div style={FOLLOW_ROOT_STYLE} className={styles.page}>
      {/* page-wide soft background layer — every section floats over this */}
      <AmbientField />
      {/* site-wide scroll-reveal: fades section content up as it enters view */}
      <Reveal />
      <ProjectSideNav sections={SECTIONS} />
      <div className={styles.pageContent}>
      {/* ============ HERO ============ */}
      <header className={styles.hero}>
        <div className={styles.heroBody}>
          <div className={styles.dotsmark}>
            <span className={styles.dots}>
              <span className={styles.d} />
              <span className={styles.d} />
              <span className={styles.d} />
              <span className={`${styles.d} ${styles.ai}`} />
            </span>
            <span className={styles.ml}>
              the invisible <em>teammate</em>
            </span>
          </div>
          <p className={styles.heroEyebrow}>
            Capstone · MS Strategic Design &amp; Management, Parsons · Spring 2026
          </p>
          <h1 className={styles.heroLockup}>
            Follow<span className={styles.dot}>.</span>
          </h1>
          <p className={styles.heroTitle}>
            One shared memory for your team’s AI chats, and the{" "}
            <em>artifacts</em> they produce.
          </p>
          <p className={styles.heroSub}>
            Follow sits between the AI tools your team already uses and
            turns every chat and document into shared knowledge: one index
            of what the team knows, and a directory of who knows it.
          </p>
          <SkipToDemo />
        </div>
      </header>

      {/* ============ PROJECT TIMELINE (deck-style, at the start) ============ */}
      <section className="section" data-ambient-dim id="timeline" data-snav-target>
        <div className="container" data-reveal>
          <h2 className={`mono ${styles.kicker}`}>Project timeline</h2>
          <p className="lede">
            Spring 2025 → May 2026: field research, expert interviews, and the
            two pivots that turned Follow from an AI-native document tool into a
            team-memory layer.
          </p>
          {/* legend + chart sit on a full-bleed frosted band (the Healthy
              Materials timeline recipe) — the blue/orange ambient blurs
              through behind the chart */}
          <div className={styles.tlGlass}>
          <div className={styles.tlGlassInner}>
          <div className={styles.tlLegend}>
            <span className={styles.it}>
              <span className={`${styles.sw} ${styles.ink}`} />
              Field research
            </span>
            <span className={styles.it}>
              <span className={`${styles.sw} ${styles.acc}`} />
              Expert interview
            </span>
            <span className={styles.it}>
              <span className={`${styles.sw} ${styles.holo}`} />
              Product moment
            </span>
            <span className={styles.it}>
              <span className={`${styles.sw} ${styles.piv}`} />
              Pivot
            </span>
          </div>
          <div className={styles.tlScroll}>
            <svg
              viewBox="0 0 1120 300"
              preserveAspectRatio="xMidYMid meet"
              role="img"
              aria-label="Project timeline, Spring 2025 to May 2026: Housing Works origin, concept v1, peer tests, pivot to a workspace extension, interviews with Alexandra Becker, Andy and Atanu Sinha, build sprints, pivot to teams-first, and the v6 capstone."
            >
              <rect x="453.5" y="22" width="3" height="248" fill="var(--accent)" opacity=".85" />
              <rect x="378" y="22" width="155" height="34" rx="4" fill="var(--accent)" />
              <text x="455" y="40" textAnchor="middle" fontFamily="IBM Plex Mono,monospace" fontSize="10.5" fontWeight="700" fill="#fff" letterSpacing="1.2">
                PIVOT 1 · MAR 17
              </text>
              <text x="455" y="52" textAnchor="middle" fontFamily="IBM Plex Mono,monospace" fontSize="9.5" fill="#fff" opacity=".92">
                doc editor → workspace ext.
              </text>
              <rect x="863.5" y="22" width="3" height="248" fill="var(--accent)" opacity=".85" />
              <rect x="788" y="22" width="155" height="34" rx="4" fill="var(--accent)" />
              <text x="865" y="40" textAnchor="middle" fontFamily="IBM Plex Mono,monospace" fontSize="10.5" fontWeight="700" fill="#fff" letterSpacing="1.2">
                PIVOT 2 · LATE APR
              </text>
              <text x="865" y="52" textAnchor="middle" fontFamily="IBM Plex Mono,monospace" fontSize="9.5" fill="#fff" opacity=".92">
                individuals → teams-first
              </text>

              <line x1="50" y1="150" x2="1070" y2="150" stroke="var(--ink)" strokeWidth="2" />
              <g fontFamily="IBM Plex Mono,monospace" fontSize="10" fill="var(--soft)" letterSpacing="1">
                <line x1="95" y1="150" x2="95" y2="156" stroke="var(--soft)" />
                <text x="95" y="172" textAnchor="middle">SPRING ’25</text>
                <line x1="300" y1="150" x2="300" y2="156" stroke="var(--soft)" />
                <text x="300" y="172" textAnchor="middle">FEB ’26</text>
                <line x1="430" y1="150" x2="430" y2="156" stroke="var(--soft)" />
                <text x="430" y="172" textAnchor="middle">MAR ’26</text>
                <line x1="700" y1="150" x2="700" y2="156" stroke="var(--soft)" />
                <text x="700" y="172" textAnchor="middle">APR ’26</text>
                <line x1="1010" y1="150" x2="1010" y2="156" stroke="var(--soft)" />
                <text x="1010" y="172" textAnchor="middle">MAY ’26</text>
              </g>

              <line x1="95" y1="150" x2="95" y2="196" stroke="var(--soft)" strokeDasharray="2 3" />
              <circle cx="95" cy="150" r="6" fill="var(--ink)" />
              <text x="95" y="214" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="13.5" fontWeight="700" fill="var(--ink)">
                Housing Works
              </text>
              <text x="95" y="230" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="11" fontStyle="italic" fill="var(--soft)">
                3-person team · the origin
              </text>

              <line x1="250" y1="150" x2="250" y2="108" stroke="var(--soft)" strokeDasharray="2 3" />
              <circle cx="250" cy="150" r="6" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.5" />
              <text x="250" y="98" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="13.5" fontWeight="700" fill="var(--ink)">
                Concept v1
              </text>
              <text x="250" y="82" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="11" fontStyle="italic" fill="var(--soft)">
                cognitive debt · AI-native doc
              </text>

              <line x1="375" y1="150" x2="375" y2="196" stroke="var(--soft)" strokeDasharray="2 3" />
              <circle cx="375" cy="150" r="6" fill="var(--ink)" />
              <text x="375" y="214" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="13.5" fontWeight="700" fill="var(--ink)">
                Peer tests
              </text>
              <text x="375" y="230" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="11" fontStyle="italic" fill="var(--soft)">
                4 peers · early wireframe
              </text>

              <line x1="540" y1="150" x2="540" y2="108" stroke="var(--soft)" strokeDasharray="2 3" />
              <circle cx="540" cy="150" r="6" fill="var(--ink)" />
              <text x="540" y="98" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="13.5" fontWeight="700" fill="var(--ink)">
                Alexandra Becker
              </text>
              <text x="540" y="82" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="11" fontStyle="italic" fill="var(--soft)">
                concept test · outside view · Mar 31
              </text>

              <line x1="620" y1="150" x2="620" y2="196" stroke="var(--soft)" strokeDasharray="2 3" />
              <circle cx="620" cy="150" r="6" fill="var(--ink)" />
              <text x="620" y="214" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="13.5" fontWeight="700" fill="var(--ink)">
                Workshop
              </text>
              <text x="620" y="230" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="11" fontStyle="italic" fill="var(--soft)">
                Intelligence Gap · 4 teams
              </text>

              <line x1="705" y1="150" x2="705" y2="108" stroke="var(--soft)" strokeDasharray="2 3" />
              <circle cx="705" cy="150" r="6" fill="var(--accent)" />
              <text x="705" y="98" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="13.5" fontWeight="700" fill="var(--ink)">
                Andy
              </text>
              <text x="705" y="82" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="11" fontStyle="italic" fill="var(--accent)">
                expert · agentic systems
              </text>

              <line x1="785" y1="150" x2="785" y2="196" stroke="var(--soft)" strokeDasharray="2 3" />
              <circle cx="785" cy="150" r="6" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.5" />
              <text x="785" y="214" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="13.5" fontWeight="700" fill="var(--ink)">
                Build sprints
              </text>
              <text x="785" y="230" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="11" fontStyle="italic" fill="var(--soft)">
                MCP tools · the pipeline
              </text>

              <line x1="945" y1="150" x2="945" y2="108" stroke="var(--soft)" strokeDasharray="2 3" />
              <circle cx="945" cy="150" r="6" fill="var(--accent)" />
              <text x="945" y="98" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="13.5" fontWeight="700" fill="var(--ink)">
                Atanu Sinha
              </text>
              <text x="945" y="82" textAnchor="middle" fontFamily="Inter,sans-serif" fontSize="11" fontStyle="italic" fill="var(--accent)">
                expert · 25-yr operator
              </text>

              <line x1="1025" y1="150" x2="1025" y2="196" stroke="var(--soft)" strokeDasharray="2 3" />
              <circle cx="1025" cy="150" r="6" fill="var(--paper)" stroke="var(--ink)" strokeWidth="2.5" />
              <text x="1025" y="214" textAnchor="end" fontFamily="Inter,sans-serif" fontSize="13.5" fontWeight="700" fill="var(--ink)">
                v6 capstone
              </text>
              <text x="1025" y="230" textAnchor="end" fontFamily="Inter,sans-serif" fontSize="11" fontStyle="italic" fill="var(--soft)">
                teams-first · this artifact
              </text>
            </svg>
          </div>
          </div>
          </div>
          <p className={styles.tlFoot}>
            <strong>What this is not:</strong> a longitudinal deployment study.
            The peer tests informed a pivot, not a validation; the longitudinal
            pilot ahead is the move from modeled to measured.
          </p>

          {/* research methodology, clubbed under the timeline (the journey) */}
          <div className={styles.clubbed}>
            <h3 className={`mono ${styles.kicker}`}>The research</h3>
            <p className="lede">
              Mixed-methods, and honest about scope: a theoretical spine, plus six
              primary engagements, from lived experience to expert interviews.
            </p>
            {/* the two research columns are glass Unfolds now (UNFOLD-POLISH),
                mirroring the Healthy Materials research pattern — the count
                rides the header so the collapsed state still says how much
                sits inside */}
            <div className={styles.rcols}>
              <Unfold
                header={
                  <span className={styles.rlabel}>
                    Secondary · the theoretical spine · 6
                  </span>
                }
              >
                <div className={styles.rlist}>
                  <div className={styles.r}>
                    <strong>Wegner</strong> · transactive memory systems
                  </div>
                  <div className={styles.r}>
                    <strong>Clark &amp; Chalmers</strong> · the extended mind
                  </div>
                  <div className={styles.r}>
                    <strong>Sweller</strong> · cognitive load theory
                  </div>
                  <div className={styles.r}>
                    <strong>Bienefeld et al.</strong> · TMS in human-AI teams
                  </div>
                  <div className={styles.r}>
                    <strong>Kosmyna et al. (MIT)</strong> · cognitive debt
                  </div>
                  <div className={styles.r}>
                    <strong>Doshi &amp; Hauser</strong> · homogenization risk
                  </div>
                </div>
              </Unfold>
              <Unfold
                header={
                  <span className={styles.rlabel}>
                    Primary · engagements · 6
                  </span>
                }
              >
                <div className={styles.rlist}>
                  <div className={styles.r}>
                    <strong>Housing Works NYC</strong>
                    <span className={styles.kind}>Lived experience</span>
                  </div>
                  <div className={styles.r}>
                    <strong>Intelligence Gap workshop</strong>
                    <span className={styles.kind}>4 teams · 12 participants</span>
                  </div>
                  <div className={styles.r}>
                    <strong>Peer concept tests</strong>
                    <span className={styles.kind}>4 peers · early wireframe</span>
                  </div>
                  <div className={styles.r}>
                    <strong>Andy</strong>
                    <span className={styles.kind}>Expert · agentic systems</span>
                  </div>
                  <div className={styles.r}>
                    <strong>Alexandra Becker</strong>
                    <span className={styles.kind}>Concept test · outside perspective</span>
                  </div>
                  <div className={styles.r}>
                    <strong>Atanu Sinha</strong>
                    <span className={styles.kind}>Expert · 25-year operator</span>
                  </div>
                </div>
              </Unfold>
            </div>
          </div>
        </div>
      </section>

      {/* ============ THE GAP (white block): problem · today's structure · insights ============ */}
      <section className={`section ${styles.blockWhite}`}>
        <div className="containerText" data-reveal id="problem" data-snav-target>
          <h2 className={`mono ${styles.kicker}`}>The problem</h2>
          <p className={styles.probState}>
            As work moves into AI workflows, the reasoning behind it
            disappears into private chats.
          </p>
          <p className="lede">
            Every decision now gets worked out with an AI first: the
            constraints, the rejected options, the why. All of it stays in
            one person’s thread, invisible to the rest of the team.
          </p>
          <p className={styles.body}>
            Teams already run as a{" "}
            <TermTip
              term="transactive memory system"
              source="Coined by Daniel Wegner, 1985."
            >
              A group’s shared memory: instead of everyone knowing everything,
              members specialize and quietly keep a directory of{" "}
              <em>who knows what</em>, so the team retrieves knowledge by
              knowing whom to ask.
            </TermTip>{" "}
            with each other: everyone keeps a rough map of who knows what.
            Nothing like it exists for their AI tools: the context that
            shaped the work scatters across separate chats. Across five
            concept tests, most people volunteered the same feeling
            unprompted: their AI-assisted work didn’t quite feel like theirs.
          </p>
        </div>

        <div className="container" data-reveal>
          <div className={styles.reelHead}>
            <p className={`mono ${styles.kicker}`}>The structural change · today</p>
            <h2 className={styles.reelTitle}>
              Same team. Same tools. The reasoning <em>scatters</em>.
            </h2>
          </div>
          <BeforeSystem />
          <p className={styles.reelNote}>
            Adapted from the capstone deck: three teammates, three AIs, each
            working in a private thread the others can’t see.
          </p>
        </div>

        <div className="container" data-reveal id="insights" data-snav-target>
          <h2 className={`mono ${styles.kicker}`}>
            Insights &amp; areas of opportunity
          </h2>
          <p className="lede">
            Three findings shaped where Follow plays, and where the opportunity
            is largest.
          </p>
          <div className={styles.insights}>
            <div className={styles.ins}>
              <span className={styles.num}>01</span>
              <h3>AI is the invisible teammate.</h3>
              <p>
                Teams already run as transactive memory systems with each other,
                but not with their AI, because its contributions were never
                captured in a form the team could route to.
              </p>
            </div>
            <div className={styles.ins}>
              <span className={styles.num}>02</span>
              <h3>Cross-tool memory is structurally vacant.</h3>
              <p>
                Native memory inside one AI tool is solved by vendors. Cross-tool,
                cross-contributor memory is empty; no vendor with the surface to
                build it has a reason to make it cross-vendor.
              </p>
            </div>
            <div className={styles.ins}>
              <span className={styles.num}>03</span>
              <h3>Provenance matters where stakes are high.</h3>
              <p>
                The strongest signal for value comes where the cost of being wrong
                is asymmetric: legal review, regulated work, compliance. That’s
                also where pricing tolerance is highest.
              </p>
            </div>
          </div>

          <div className={styles.guilt}>
            <p>
              “The deliverable shipped — we didn’t fail. But I could have done
              better work if I’d known how my teammates got where they got.”
            </p>
            <p className={styles.src}>
              From the Housing Works experience; the five concept tests kept
              surfacing the same feeling, unprompted.
            </p>
          </div>
        </div>
      </section>

      {/* ============ HMW ============ */}
      <section className="section">
        <div className="containerText" data-reveal>
          {/* glass card — the ambient orbs blur through, like the timeline band */}
          <div className={styles.hmwGlass}>
            <p className={styles.hmwEyebrow}>The opportunity</p>
            <h2 className={styles.hmw}>
              How might we give a team{" "}
              <em>one shared, trustable memory</em>, across every AI tool they
              already use?
            </h2>
          </div>
        </div>
      </section>

      {/* ============ FOLLOW CONCEPT — the response (the system, in one picture) ============ */}
      <section className="section" id="response" data-snav-target>
        <div className="container" data-reveal>
          <p className={`mono ${styles.kicker}`}>The response</p>
          <h2 className={styles.revealName} aria-label="The response: Follow">
            Follow<span className={styles.dot}>.</span>
          </h2>
          <p className={styles.revealLine}>
            A shared memory layer that lives <em>between</em> your AI tools, not
            inside any one of them. This is the whole system:
          </p>
          <FollowSystem />
        </div>
      </section>

      {/* ============ WHAT IT DOES — not-RAG + the product behaviors ============ */}
      <section className="section" data-ambient-dim id="what-it-does" data-snav-target>
        <div className="container" data-reveal>
          <h2 className={`mono ${styles.kicker}`}>What it does</h2>
          <p className="lede">
            Not another search box over your chats. A memory with receipts,
            and six things fall out of that.
          </p>

          <div className={styles.rag}>
            <div className={styles.ragCard}>
              {/* a magnifier over text lines — retrieval searches wording */}
              <svg className={styles.ragIcon} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4.5 5h10.5M4.5 9h12M4.5 13h6.5" />
                <circle cx="15.5" cy="15.5" r="3.8" />
                <path d="M18.2 18.2L21 21" />
              </svg>
              <p className={`mono ${styles.ragTag}`}>typical RAG</p>
              <p className={styles.ragClaim}>Finds text that matches.</p>
              <p className={styles.ragSub}>
                You get back a similar-sounding paragraph: no owner, no date,
                no idea whether the team still believes it.
              </p>
            </div>
            <div className={`${styles.ragCard} ${styles.ragF}`}>
              {/* the same magnifier — over a graph instead of wording */}
              <svg className={styles.ragIcon} viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="5.5" cy="7" r="2" />
                <circle cx="12" cy="5" r="2" />
                <circle cx="7.5" cy="13" r="2" />
                <path d="M7.4 6.4l2.7-.9M6 8.9l1 2.2M9.2 12.1l2.5-5.2" />
                <circle cx="15.5" cy="15.5" r="3.8" />
                <path d="M18.2 18.2L21 21" />
              </svg>
              <p className={`mono ${styles.ragTag}`}>Follow</p>
              <p className={styles.ragClaim}>Finds the source.</p>
              <p className={styles.ragSub}>
                Who worked it out, in which chat, when, what it connects to,
                and whether anyone disagrees.
              </p>
            </div>
            <span className={styles.ragVs} aria-hidden="true">
              vs
            </span>
          </div>
          <p className={`mono ${styles.ragNote}`}>
            Glean indexes your documents. Follow indexes the reasoning that
            produced them.
          </p>

          <div className={styles.cards}>
            <Unfold
              header={
                <span className={styles.widHead}>
                  <svg className={styles.widIcon} viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="4.5" cy="6" r="1.7" />
                    <circle cx="4.5" cy="12" r="1.7" />
                    <circle cx="4.5" cy="18" r="1.7" />
                    <path d="M6.4 6.4 L15 11" />
                    <path d="M6.4 12 H15" />
                    <path d="M6.4 17.6 L15 13" />
                    <rect x="16.5" y="7" width="3.4" height="10" rx="1.2" />
                  </svg>
                  <span className={styles.widText}>
                    <span className={styles.widNo}>01</span>
                    <h3 className={styles.widTitle}>Works across tools</h3>
                  </span>
                </span>
              }
            >
              <p className={styles.widBody}>
                Maya’s Claude, Alex’s ChatGPT, Sam’s Gemini: every teammate’s
                AI reads and writes the same memory, over MCP.
              </p>
            </Unfold>
            <Unfold
              header={
                <span className={styles.widHead}>
                  <svg className={styles.widIcon} viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="5.5" y="3.5" width="13" height="17" rx="1.6" />
                    <path d="M8.5 8 H15.5" />
                    <path d="M8.5 11 H13" />
                    <path d="M8.5 15.5 l2 2 l4 -4.2" />
                  </svg>
                  <span className={styles.widText}>
                    <span className={styles.widNo}>02</span>
                    <h3 className={styles.widTitle}>Answers with receipts</h3>
                  </span>
                </span>
              }
            >
              <p className={styles.widBody}>
                Every fact carries who said it, in which chat, and when, so
                answers come back attributed, and you can check them.
              </p>
            </Unfold>
            <Unfold
              header={
                <span className={styles.widHead}>
                  <svg className={styles.widIcon} viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3.5 14 H10.3" />
                    <path d="M8.2 11.8 L10.6 14 L8.2 16.2" />
                    <path d="M20.5 14 H13.7" />
                    <path d="M15.8 11.8 L13.4 14 L15.8 16.2" />
                    <path d="M12 13 V5" />
                    <path d="M12 5 L16 6.4 L12 7.8" />
                  </svg>
                  <span className={styles.widText}>
                    <span className={styles.widNo}>03</span>
                    <h3 className={styles.widTitle}>Disagreements stay visible</h3>
                  </span>
                </span>
              }
            >
              <p className={styles.widBody}>
                When two teammates’ AIs conclude different things, Follow flags
                the conflict and keeps both sides on the record.
              </p>
            </Unfold>
            <Unfold
              header={
                <span className={styles.widHead}>
                  <svg className={styles.widIcon} viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="8" cy="8" r="2.2" />
                    <circle cx="16" cy="8" r="2.2" />
                    <circle cx="16" cy="16" r="2.2" />
                    <circle cx="8" cy="16" r="2.2" fill="currentColor" stroke="none" />
                    <circle cx="8" cy="16" r="4.3" />
                  </svg>
                  <span className={styles.widText}>
                    <span className={styles.widNo}>04</span>
                    <h3 className={styles.widTitle}>A live who-knows-what</h3>
                  </span>
                </span>
              }
            >
              <p className={styles.widBody}>
                The directory of what your team knows and who knows it,
                maintained by the work itself, not by anyone filling in
                profiles.
              </p>
            </Unfold>
            <Unfold
              header={
                <span className={styles.widHead}>
                  <svg className={styles.widIcon} viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3.5" y="13" width="12.5" height="6" rx="1.6" />
                    <rect x="3.5" y="5" width="12.5" height="6" rx="1.6" fill="currentColor" stroke="none" />
                    <path d="M20 18 V8" />
                    <path d="M17.8 10 L20 7.6 L22.2 10" />
                  </svg>
                  <span className={styles.widText}>
                    <span className={styles.widNo}>05</span>
                    <h3 className={styles.widTitle}>Memory that stays current</h3>
                  </span>
                </span>
              }
            >
              <p className={styles.widBody}>
                New decisions retire the old ones they replace, and the old
                version stays in the trail, so nothing silently vanishes.
              </p>
            </Unfold>
            <Unfold
              header={
                <span className={styles.widHead}>
                  <svg className={styles.widIcon} viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="3" y="5" width="8.5" height="12" rx="1.3" />
                    <path d="M5.5 8.5 H9" />
                    <path d="M5.5 11.5 H9" />
                    <circle cx="19" cy="7.5" r="2" />
                    <circle cx="19" cy="16.5" r="2" />
                    <path d="M11.5 10 L17 7.9" />
                    <path d="M11.5 12 L17 16.1" />
                  </svg>
                  <span className={styles.widText}>
                    <span className={styles.widNo}>06</span>
                    <h3 className={styles.widTitle}>Documents join the memory</h3>
                  </span>
                </span>
              }
            >
              <p className={styles.widBody}>
                Uploads and live docs alike. Follow follows the artifact: its
                facts land in the same shared memory and version up as it
                changes.
              </p>
            </Unfold>
          </div>
        </div>
      </section>

      {/* ============ THE SANDBOX (the demo promise, made real) ============ */}
      <section className="section" id="demo" data-snav-target>
        <div className="container" data-reveal>
          <p className={`mono ${styles.kicker}`}>The sandbox</p>
          <h2 className={styles.reelTitle}>
            The shipped dashboard, replicated <em>live</em>.
          </h2>
          <div className={styles.storyCard}>
            <p className={`mono ${styles.storyKicker}`}>the story</p>
            <div className={styles.storySteps}>
              <div className={styles.storyStep}>
                <span className={styles.storyNum}>01</span>
                <p className={styles.storyStepTitle}>The team</p>
                <p className={styles.storyStepBody}>
                  Aurora is a fictional checkout-redesign team. Maya designs
                  in Claude, Alex runs product in ChatGPT, Sam builds in
                  Gemini: three tools, normally three silos.
                </p>
              </div>
              <div className={styles.storyStep}>
                <span className={styles.storyNum}>02</span>
                <p className={styles.storyStepTitle}>The week</p>
                <p className={styles.storyStepBody}>
                  One working week, captured as they worked: 16 conversations,
                  7 files, a 32-fact memory. Three questions ended the week
                  still contested; Follow keeps both sides on the record.
                </p>
              </div>
              <div className={styles.storyStep}>
                <span className={styles.storyNum}>03</span>
                <p className={styles.storyStepTitle}>Your seat</p>
                <p className={styles.storyStepBody}>
                  You’re the fourth teammate. Ask Follow anything about the
                  week: it thinks, picks its tools, and you watch every call
                  cross the wire. Save the conversation and you join the
                  memory too.
                </p>
              </div>
            </div>
          </div>
          <DemoTour />
          <p className={`mono ${styles.techLine}`}>
            live model · Follow&apos;s actual MCP tool contracts (
            <a
              href="https://github.com/Rishabh117117/workspace-platform"
              target="_blank"
              rel="noopener noreferrer"
            >
              workspace-platform ↗
            </a>
            ) · fictional sample workspace
          </p>
        </div>

        <div className={styles.appBleed} data-ambient-live id="follow-sandbox">
          {/* the tour overlay portals in here — dim/ring/coach card are all
              absolutely positioned within this stage, so the tour lives (and
              scrolls) with the sandbox instead of riding the viewport */}
          <div className={styles.appBleedInner} id="follow-sandbox-stage">
            <FollowSandbox />
          </div>
        </div>

        <div className="container" data-reveal>
          <p className={`mono ${styles.sandboxFoot}`}>
            <Link href="/work/follow/prototype">open the sandbox full-screen ↗</Link>
          </p>
        </div>
      </section>

      {/* ============ UNDER THE HOOD (the real system behind the sandbox) ============ */}
      {/* ownership claim: confirmed by RS before merge */}
      <section className="section" data-ambient-dim id="under-the-hood" data-snav-target>
        <div className="containerText" data-reveal>
          <UnderTheHood>
          <p className="lede">
            The sandbox above runs the shipped system, not a mockup.
            What&rsquo;s behind it:
          </p>
          <div className={styles.rlist}>
            <div className={styles.r}>
              <strong>Stack</strong>: TypeScript MCP server (Hono, JSON-RPC at
              /mcp), Next.js sandbox client, deployed on Railway.
            </div>
            <div className={styles.r}>
              <strong>Pipeline</strong>: five LLM roles (Reporter, Analyst,
              Editor, Archivist, Profiler; the Editor currently flag-gated)
              turn raw AI conversations into a versioned index: typed edges,
              provenance on every fact, supersession instead of overwrites.
            </div>
            <div className={styles.r}>
              <strong>Testing</strong>: ≈2,100 automated tests across the
              pipeline, tool contracts, and clients.
            </div>
            <div className={styles.r}>
              <strong>Ownership</strong>: the architecture, data model, tool
              contracts, and evaluation are mine; implementation is AI-assisted
              with Claude Code, with every change reviewed and tested.
            </div>
            <div className={styles.r}>
              <strong>Limits</strong>: beta scope; capture quality tracks MCP
              client support.
            </div>
          </div>
          </UnderTheHood>
        </div>
      </section>

      {/* ============ PROJECT PAGER ============ */}
      <ProjectPager slug="follow" />
      </div>
    </div>
  );
}
