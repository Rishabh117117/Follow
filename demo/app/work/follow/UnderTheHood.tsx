"use client";

import { useState } from "react";
import styles from "./follow.module.css";

/* "Under the hood" as a disclosure: the kicker heading is the trigger and
   the tech notes unfold below it (the FollowSystem slab's 0fr→1fr recipe).
   Copy stays in page.tsx — this only provides the fold. */
export default function UnderTheHood({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={open ? styles.hoodOpen : undefined}>
      <h2 className={`mono ${styles.kicker} ${styles.hoodH}`}>
        <button
          type="button"
          className={styles.hoodBtn}
          aria-expanded={open}
          aria-controls="under-the-hood"
          onClick={() => setOpen((o) => !o)}
        >
          Under the hood
          <span className={styles.hoodChev} aria-hidden="true">
            ▾
          </span>
        </button>
      </h2>
      <div
        className={styles.hoodPanel}
        id="under-the-hood"
        aria-hidden={!open}
      >
        <div className={styles.hoodClip}>
          <div className={styles.hoodGlass}>{children}</div>
        </div>
      </div>
    </div>
  );
}
