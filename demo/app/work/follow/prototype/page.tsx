import type { Metadata } from "next";
import Link from "next/link";
import FollowSandbox from "../FollowSandbox";
import { FOLLOW_ROOT_STYLE } from "../theme";
import styles from "./prototype.module.css";

export const metadata: Metadata = {
  title: "Follow · product replica",
  description:
    "The live Follow product replica on a pre-loaded team workspace: captured transcripts with the MCP tool loop on the wire, uploaded files, per-entry provenance, and contested pairs flagged instead of resolved. Ask Follow answers from the shared memory over a live model. Sample data.",
};

export default function FollowPrototypePage() {
  return (
    <div style={FOLLOW_ROOT_STYLE} className={styles.page}>
      <header className={styles.head}>
        <div>
          <p className={`mono ${styles.kicker}`}>product replica · pre-loaded sample workspace</p>
          <h1 className={styles.title}>
            Follow<span className={styles.dot}>.</span>
          </h1>
          <p className={styles.story}>
            The story: <strong>Aurora</strong>, a fictional checkout-redesign team (Maya in
            Claude, Alex in ChatGPT, Sam in Gemini) spent a week working with the Follow
            connector attached. Their 16 conversations, 7 files, and 32 extracted facts are
            below; three questions are still contested. Ask Follow answers from this memory by
            running the real tools, live.
          </p>
        </div>
        <Link className={`mono ${styles.back}`} href="/work/follow">
          ← Back to the case study
        </Link>
      </header>
      <div className={styles.mount}>
        <FollowSandbox />
      </div>
    </div>
  );
}
