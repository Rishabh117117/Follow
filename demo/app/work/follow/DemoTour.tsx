"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./follow.module.css";

/**
 * The sandbox walkthrough — five numbered stops, product-onboarding style,
 * run as a SPOTLIGHT tour that lives INSIDE the sandbox: the overlay (four
 * dim panels around a live hole, accent ring with a landing flash, coach
 * card) portals into `#follow-sandbox-stage` and is absolutely positioned
 * within it, so the whole tour scrolls WITH the sandbox — scroll away and
 * it stays behind in the demo instead of riding the viewport. The coach
 * card is PINNED to one spot — bottom-center of the stage — and never
 * moves; measure() clamps the spotlight hole above the card's band so the
 * message and the spotlight can never overlap.
 *
 * The hole is real (four panels, not a box-shadow cutout), so the
 * spotlighted region stays fully interactive; a rAF loop re-measures the
 * target (stage-relative) every frame, covering view swaps and resizes.
 * Esc, the dim, ✕, skip, or ANY click into the sandbox itself ends the
 * tour (capture-phase listener; clicks on the overlay's own controls are
 * excluded via [data-tour-overlay]).
 *
 * Entry points: AUTO once per mount when the sandbox scrolls ~35% into
 * view (no scroll-jack, no focus steal, "skip tour" up front), or any tour
 * card — clickable edge to edge — which jumps straight to that stop.
 */

const STOPS: { view: string; target: "main" | "ask"; title: string; line: string }[] = [
  {
    view: "items",
    target: "main",
    title: "Skim their week",
    line: "All items is the team’s five days, newest first: 16 conversations, 7 files.",
  },
  {
    view: "conversations",
    target: "main",
    title: "Open a conversation",
    line: "See how an answer really happened: the assistant thinks, checks the team’s index, then replies.",
  },
  {
    view: "graph",
    target: "main",
    title: "Spin the graph",
    line: "The whole memory as one structure: every fact wired to its source, contested points in red.",
  },
  {
    view: "ask",
    target: "ask",
    title: "Ask Follow yourself",
    line: "Type a question and it runs Follow’s real tools live, thinking and tool calls on screen.",
  },
  {
    view: "mcp",
    target: "main",
    title: "Watch the wire",
    line: "The MCP console runs the same loop with the raw requests and results exposed.",
  },
];

type Box = { top: number; left: number; width: number; height: number };

const stageEl = () => document.getElementById("follow-sandbox-stage");

export default function DemoTour() {
  const [stop, setStop] = useState<number | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const startedRef = useRef(false); // any start, auto or manual — auto never fires twice
  const focusCardRef = useRef(true); // manual starts hand focus to the card; auto doesn't steal it

  const measure = useCallback((i: number) => {
    const stage = stageEl();
    if (!stage) return;
    const mobile = window.matchMedia("(max-width: 719px)").matches;
    const t =
      STOPS[i].target === "ask" && mobile
        ? stage // the dock is a full-screen overlay down here — ring the whole app
        : document.querySelector(`[data-tour="${STOPS[i].target}"]`);
    const tr = t?.getBoundingClientRect();
    if (!tr || tr.width === 0) return;
    const sr = stage.getBoundingClientRect();
    const r = { top: tr.top - sr.top, left: tr.left - sr.left, width: tr.width, height: tr.height };
    // the coach card owns a fixed band at the stage's bottom — clamp the
    // hole so the spotlight never runs under the message (first paint has
    // no card yet; the rAF loop applies the clamp a frame later)
    const cr = cardRef.current?.getBoundingClientRect();
    if (cr) {
      const bandTop = cr.top - sr.top - 10;
      if (r.top + r.height > bandTop) r.height = Math.max(40, bandTop - r.top);
    }
    setBox((prev) =>
      prev &&
      Math.abs(prev.top - r.top) < 0.5 &&
      Math.abs(prev.left - r.left) < 0.5 &&
      Math.abs(prev.width - r.width) < 0.5 &&
      Math.abs(prev.height - r.height) < 0.5
        ? prev
        : r,
    );
  }, []);

  const goto = useCallback(
    (i: number, opts?: { scroll?: boolean }) => {
      startedRef.current = true;
      window.dispatchEvent(new CustomEvent("follow:goto", { detail: STOPS[i].view }));
      setStop(i);
      // one synchronous measurement so the spotlight is placed on the very
      // first paint — the rAF loop keeps it fresh after
      measure(i);
      if (opts?.scroll !== false) {
        const el = document.getElementById("follow-sandbox");
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      }
    },
    [measure],
  );

  const start = (i: number) => {
    if (stop === null) restoreRef.current = document.activeElement as HTMLElement | null;
    focusCardRef.current = true;
    goto(i);
  };

  const end = useCallback(() => {
    setStop(null);
    setBox(null);
    restoreRef.current?.focus?.({ preventScroll: true });
    restoreRef.current = null;
  }, []);

  // AUTO-start: the first time the visitor lands on the demo (sandbox ~35%
  // in view), open the tour at stop 1 — without scrolling or stealing focus.
  useEffect(() => {
    const target = document.getElementById("follow-sandbox");
    if (!target || startedRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (startedRef.current) {
          io.disconnect();
          return;
        }
        if (entries[0]?.isIntersecting) {
          io.disconnect();
          restoreRef.current = document.activeElement as HTMLElement | null;
          focusCardRef.current = false;
          goto(0, { scroll: false });
        }
      },
      { threshold: 0.35 },
    );
    io.observe(target);
    return () => io.disconnect();
  }, [goto]);

  // track the target every frame while the tour runs — view swaps and
  // resizes covered by one loop (parked with the tab); scrolling needs no
  // tracking at all now, the overlay is anchored in the stage
  useEffect(() => {
    if (stop === null) return;
    let raf = 0;
    const track = () => {
      if (!document.hidden) measure(stop);
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    return () => cancelAnimationFrame(raf);
  }, [stop, measure]);

  // Esc ends the tour from anywhere
  useEffect(() => {
    if (stop === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") end();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stop, end]);

  // clicking INSIDE the spotlighted sandbox hands control over: the tour
  // gets out of the way and the click lands normally (capture phase, no
  // preventDefault — "click" only, so touch scrolls don't dismiss). The
  // overlay's own controls are excluded; the dims keep their click-to-end.
  useEffect(() => {
    if (stop === null) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest) return;
      if (t.closest("[data-tour-overlay]")) return;
      if (t.closest("#follow-sandbox")) end();
    };
    document.addEventListener("click", onDocClick, true);
    return () => document.removeEventListener("click", onDocClick, true);
  }, [stop, end]);

  // hand focus to the coach card when a MANUAL tour opens (not per stop)
  const open = stop !== null;
  useEffect(() => {
    if (open && focusCardRef.current) cardRef.current?.focus({ preventScroll: true });
  }, [open]);

  const s = stop !== null ? STOPS[stop] : null;
  const stage = s && box ? stageEl() : null;

  return (
    <div className={styles.tour}>
      <p className={`mono ${styles.tourKicker}`}>
        new here? the tour: five stops, two minutes
      </p>
      {/* one-liner stop buttons — the spotlight does the explaining; each
          stop's full line lives in the coach card once it's running */}
      <ol className={styles.tourRail}>
        {STOPS.map((st, i) => (
          <li key={st.view} className={styles.tourStop}>
            <button
              type="button"
              className={styles.tourGo}
              aria-label={`Show me stop ${i + 1} of ${STOPS.length}: ${st.title}`}
              onClick={() => start(i)}
            >
              <span className={`mono ${styles.tourNo}`}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className={styles.tourTitle}>{st.title}</span>
              <span className={styles.tourArrow} aria-hidden="true">
                ↓
              </span>
            </button>
          </li>
        ))}
      </ol>

      {s && box && stage
        ? createPortal(
            <div className={styles.spot} data-tour-overlay="">
              {/* four dim panels — the hole between them is empty, so the
                  spotlighted region stays fully interactive */}
              <div
                className={styles.spotDim}
                style={{ top: 0, left: 0, right: 0, height: Math.max(0, box.top) }}
                onClick={end}
              />
              <div
                className={styles.spotDim}
                style={{ top: box.top, left: 0, width: Math.max(0, box.left), height: box.height }}
                onClick={end}
              />
              <div
                className={styles.spotDim}
                style={{ top: box.top, left: box.left + box.width, right: 0, height: box.height }}
                onClick={end}
              />
              <div
                className={styles.spotDim}
                style={{ top: box.top + box.height, left: 0, right: 0, bottom: 0 }}
                onClick={end}
              />
              {/* keyed per stop so the landing flash replays every move */}
              <div
                key={`ring${stop}`}
                className={styles.spotRing}
                style={{
                  top: box.top - 4,
                  left: box.left - 4,
                  width: box.width + 8,
                  height: box.height + 8,
                }}
              />
              {/* fixed dock: the card sits at one spot — the stage's
                  bottom-center — for the whole tour */}
              <div className={styles.spotDockWrap}>
                <div
                  ref={cardRef}
                  className={styles.spotCard}
                  role="dialog"
                  aria-label={`Tour stop ${stop! + 1} of ${STOPS.length}: ${s.title}`}
                  aria-live="polite"
                  tabIndex={-1}
                >
                  <button type="button" className={styles.spotSkip} onClick={end} aria-label="End the tour">
                    ✕
                  </button>
                  <p className={`mono ${styles.spotNo}`}>
                    stop {stop! + 1} / {STOPS.length}
                  </p>
                  <h3 className={styles.spotTitle}>{s.title}</h3>
                  <p className={styles.spotLine}>{s.line}</p>
                  <div className={styles.spotBtns}>
                    {stop === 0 ? (
                      <button type="button" className={`mono ${styles.spotGhost}`} onClick={end}>
                        skip tour
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={`mono ${styles.spotGhost}`}
                        onClick={() => goto(stop! - 1)}
                      >
                        ← back
                      </button>
                    )}
                    <button
                      type="button"
                      className={`mono ${styles.spotNext}`}
                      onClick={() => (stop! >= STOPS.length - 1 ? end() : goto(stop! + 1))}
                    >
                      {stop! >= STOPS.length - 1 ? "finish ✓" : "next →"}
                    </button>
                  </div>
                  <p className={`mono ${styles.spotHint}`}>
                    or just click in, the tour gets out of the way
                  </p>
                </div>
              </div>
            </div>,
            stage,
          )
        : null}
    </div>
  );
}
