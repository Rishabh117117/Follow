"use client";

import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import styles from "./follow.module.css";

/**
 * Follow — inline hover/tap term definition (D15).
 *
 * Mechanics ported from the proven Greener Hours principle-chip tooltip
 * (app/work/greener-hours/GhApp.tsx ~L124-147 + GhApp.module.css ~L102-148):
 * a tabIndex={0} trigger toggles local open state on hover/focus, revealing
 * a glass tooltip anchored above the term. Client component — the problem
 * paragraph it's used in (page.tsx) is a server component and can't hold
 * this state itself.
 *
 * The tooltip panel is a <span role="tooltip">, not a <div>: this component
 * is used mid-paragraph inside a <p>, and <div> is not valid phrasing
 * content there (the browser would auto-close the paragraph, which React
 * would then flag as a hydration mismatch). position:absolute blockifies
 * the span exactly like a div for layout purposes, so nothing is lost.
 *
 * Viewport clamp: the base CSS centers the tooltip on the trigger
 * (left:50%/translateX(-50%)), which is correct for a term near the middle
 * of a line but overflows the viewport when the term wraps close to the
 * left/right edge (measured live at 360px: "transactive memory system"
 * starts a new line flush against the container's left padding, so a
 * centered ~295px tooltip ran ~28px off the left edge). This effect measures
 * the rendered tooltip against the viewport post-layout (useLayoutEffect —
 * before paint, so there's no visible jump) and nudges it back on-screen via
 * a CSS custom property, leaving the common centered case untouched.
 */
export default function TermTip({
  term,
  source,
  children,
}: {
  term: string;
  source?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const wrapRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    if (!open) return;
    const wrap = wrapRef.current;
    const tip = tipRef.current;
    if (!wrap || !tip) return;
    const margin = 12; // keep clear of the viewport edge, not flush against it
    const wrapRect = wrap.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect(); // as CSS-centered, pre-shift
    const viewportW = window.innerWidth;
    const centeredLeft = wrapRect.left + wrapRect.width / 2 - tipRect.width / 2;
    const clampedLeft = Math.min(
      Math.max(centeredLeft, margin),
      viewportW - margin - tipRect.width,
    );
    setShift(clampedLeft - centeredLeft);
    // re-measure if the term sits near an edge and the viewport is resized
  }, [open]);

  // reset so the next open re-measures from a clean centered baseline
  const handleClose = () => {
    setOpen(false);
    setShift(0);
  };

  return (
    <span className={styles.termWrap} ref={wrapRef}>
      <span
        className={styles.termTrigger}
        tabIndex={0}
        aria-describedby={open ? tipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={handleClose}
        onFocus={() => setOpen(true)}
        onBlur={handleClose}
      >
        {term}
      </span>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className={styles.termTip}
          ref={tipRef}
          style={{ "--tt-shift": `${shift}px` } as CSSProperties}
        >
          <span className={styles.termTipBody}>{children}</span>
          {source ? <span className={styles.termTipSource}>{source}</span> : null}
        </span>
      )}
    </span>
  );
}
