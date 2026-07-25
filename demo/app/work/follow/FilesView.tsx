"use client";

import { useEffect, useMemo, useState } from "react";
import { fMember, type FEntry } from "@/lib/followSandbox";
import { fDayIndex, fFactsFor, F_DOC_KIND_LABEL, type FDoc } from "@/lib/followProduct";
import FactsFooter from "./FactsFooter";
import { renderDocBody } from "./markdownLite";
import s from "./FollowSandbox.module.css";

/**
 * Files — same master-detail shell as Conversations. Reader renders the
 * doc body through the markdown-subset renderer (no dangerouslySetInnerHTML),
 * then the same extracted-facts footer.
 */

export default function FilesView({
  docs,
  entries,
  selectedId,
  onSelect,
  onOpenFactTopic,
}: {
  docs: FDoc[];
  entries: FEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenFactTopic: (topic: string) => void;
}) {
  const [mobileShowList, setMobileShowList] = useState(selectedId === null);

  const sorted = useMemo(
    () => [...docs].sort((a, b) => fDayIndex(b.when) - fDayIndex(a.when) || b.seq - a.seq),
    [docs],
  );

  const groups = useMemo(() => {
    const map = new Map<string, FDoc[]>();
    for (const d of sorted) {
      const arr = map.get(d.when) ?? [];
      arr.push(d);
      map.set(d.when, arr);
    }
    return [...map.entries()];
  }, [sorted]);

  const active = useMemo(() => docs.find((d) => d.id === selectedId) ?? sorted[0] ?? null, [docs, selectedId, sorted]);

  useEffect(() => {
    if (!selectedId && active) onSelect(active.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, active]);

  if (docs.length === 0) {
    return <p className={s.empty}>No files uploaded yet.</p>;
  }

  const activeUploader = active ? fMember(active.uploaderId) : null;
  const activeFacts = active ? fFactsFor(active.producedEntryIds, entries) : [];

  return (
    <div className={s.masterDetail}>
      <div className={`${s.mdList} ${mobileShowList ? s.mdListShowMobile : ""}`}>
        {groups.map(([when, items]) => (
          <div key={when} className={s.dayGroup}>
            <p className={s.dayHeader}>{when === "today" ? "Today" : when}</p>
            <div className={s.dayRows}>
              {items.map((d) => {
                const m = fMember(d.uploaderId);
                const isActive = active?.id === d.id;
                const factCount = d.producedEntryIds.length;
                return (
                  <button
                    key={d.id}
                    type="button"
                    className={`${s.mdRow} ${isActive ? s.mdRowOn : ""}`}
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => {
                      onSelect(d.id);
                      setMobileShowList(false);
                    }}
                  >
                    <span className={s.docKindBadge} aria-hidden="true">
                      {F_DOC_KIND_LABEL[d.kind]}
                    </span>
                    <span className={s.mdRowMain}>
                      <span className={s.mdRowTitle}>{d.title}</span>
                      <span className={s.mdRowSub}>
                        {m.name} · {d.when}
                      </span>
                    </span>
                    <span className={s.factCountChip}>{factCount} fact{factCount === 1 ? "" : "s"}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className={`${s.mdDetail} ${mobileShowList ? s.mdDetailHideMobile : ""}`}>
        {active && activeUploader && (
          <>
            <button type="button" className={s.mdBack} onClick={() => setMobileShowList(true)}>
              ← all files
            </button>
            <header className={s.transcriptHead}>
              <span className={s.docKindBadgeLg} aria-hidden="true">
                {F_DOC_KIND_LABEL[active.kind]}
              </span>
              <div className={s.transcriptHeadMain}>
                <h4 className={s.transcriptTitle}>{active.title}</h4>
                <p className={s.transcriptSub}>
                  {active.filename} · {active.sizeKb}KB ·{" "}
                  <span className={`${s.avatar} ${s.avatarSm} ${s[`tool${activeUploader.tool}`]}`} aria-hidden="true">
                    {activeUploader.name[0]}
                  </span>{" "}
                  {activeUploader.name} · {active.when}
                </p>
              </div>
              <span className={s.factCountChip}>
                {activeFacts.length} fact{activeFacts.length === 1 ? "" : "s"}
              </span>
            </header>
            <div className={s.docReader} aria-label={`File: ${active.title}`}>
              {renderDocBody(active.body)}
            </div>
            <FactsFooter facts={activeFacts} onJump={onOpenFactTopic} />
          </>
        )}
      </div>
    </div>
  );
}
