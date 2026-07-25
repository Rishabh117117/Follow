"use client";

import { useEffect, useMemo, useState } from "react";
import { fMember, type FEntry } from "@/lib/followSandbox";
import { fDayIndex, fFactsFor, type FChat } from "@/lib/followProduct";
import FactsFooter from "./FactsFooter";
import TranscriptBlocks from "./TranscriptBlocks";
import s from "./FollowSandbox.module.css";

/**
 * Conversations — master-detail: a day-grouped mini-list of captured
 * threads on the left, the full transcript (with the MCP tool loop on the
 * wire) on the right. ≤880px the list collapses above the transcript with a
 * "← all conversations" back button.
 */

export default function ConversationsView({
  chats,
  entries,
  selectedId,
  onSelect,
  onOpenFactTopic,
}: {
  chats: FChat[];
  entries: FEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenFactTopic: (topic: string) => void;
}) {
  const [mobileShowList, setMobileShowList] = useState(selectedId === null);

  const sorted = useMemo(
    () => [...chats].sort((a, b) => fDayIndex(b.when) - fDayIndex(a.when) || b.seq - a.seq),
    [chats],
  );

  const groups = useMemo(() => {
    const map = new Map<string, FChat[]>();
    for (const c of sorted) {
      const arr = map.get(c.when) ?? [];
      arr.push(c);
      map.set(c.when, arr);
    }
    return [...map.entries()];
  }, [sorted]);

  const active = useMemo(() => chats.find((c) => c.id === selectedId) ?? sorted[0] ?? null, [chats, selectedId, sorted]);

  useEffect(() => {
    if (!selectedId && active) onSelect(active.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, active]);

  if (chats.length === 0) {
    return <p className={s.empty}>No conversations captured yet.</p>;
  }

  const activeMember = active ? fMember(active.memberId) : null;
  const activeFacts = active ? fFactsFor(active.producedEntryIds, entries) : [];

  return (
    <div className={s.masterDetail}>
      <div className={`${s.mdList} ${mobileShowList ? s.mdListShowMobile : ""}`}>
        {groups.map(([when, items]) => (
          <div key={when} className={s.dayGroup}>
            <p className={s.dayHeader}>{when === "today" ? "Today" : when}</p>
            <div className={s.dayRows}>
              {items.map((c) => {
                const m = fMember(c.memberId);
                const isActive = active?.id === c.id;
                const factCount = c.producedEntryIds.length;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`${s.mdRow} ${isActive ? s.mdRowOn : ""}`}
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => {
                      onSelect(c.id);
                      setMobileShowList(false);
                    }}
                  >
                    <span className={`${s.avatar} ${s.avatarSm} ${s[`tool${m.tool}`]}`} aria-hidden="true">
                      {m.name[0]}
                    </span>
                    <span className={s.mdRowMain}>
                      <span className={s.mdRowTitle}>{c.title}</span>
                      <span className={s.mdRowSub}>
                        {m.name} · {m.tool} · {c.when}
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
        {active && activeMember && (
          <>
            <button type="button" className={s.mdBack} onClick={() => setMobileShowList(true)}>
              ← all conversations
            </button>
            <header className={s.transcriptHead}>
              <span className={`${s.avatar} ${s.avatarLg} ${s[`tool${activeMember.tool}`]}`} aria-hidden="true">
                {activeMember.name[0]}
              </span>
              <div className={s.transcriptHeadMain}>
                <h4 className={s.transcriptTitle}>{active.title}</h4>
                <p className={s.transcriptSub}>
                  {activeMember.name} · {activeMember.role} · {activeMember.tool} · {active.when} · captured
                  over MCP
                </p>
              </div>
              <span className={s.factCountChip}>
                {activeFacts.length} fact{activeFacts.length === 1 ? "" : "s"}
              </span>
            </header>
            <div className={s.transcriptScroll} aria-label={`Transcript: ${active.title}`}>
              <TranscriptBlocks blocks={active.blocks} toolLabel={activeMember.tool} />
            </div>
            <FactsFooter facts={activeFacts} onJump={onOpenFactTopic} />
          </>
        )}
      </div>
    </div>
  );
}
