"use client";

import { useMemo, useState } from "react";
import { fMember, type FEntry } from "@/lib/followSandbox";
import { fItemsFeed, fSourceForEntry, F_DOC_KIND_LABEL, type FChat, type FDoc, type FFeedItem } from "@/lib/followProduct";
import s from "./FollowSandbox.module.css";

/**
 * "All items" — the dashboard's landing feed: conversations, files, and
 * facts interleaved under day headers (today first), mirroring the shipped
 * ItemsView. Conversation/file rows jump straight to their detail view with
 * that item selected; fact rows expand inline.
 */

const KIND_LABEL: Record<FEntry["kind"], string> = {
  decision: "decision",
  finding: "finding",
  constraint: "constraint",
};

function dayLabel(when: string): string {
  return when === "today" ? "Today" : when;
}

export default function AllItemsView({
  entries,
  chats,
  docs,
  onOpenChat,
  onOpenDoc,
  onOpenFactTopic,
}: {
  entries: FEntry[];
  chats: FChat[];
  docs: FDoc[];
  onOpenChat: (id: string) => void;
  onOpenDoc: (id: string) => void;
  onOpenFactTopic: (topic: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const feed = useMemo(() => fItemsFeed(entries, chats, docs), [entries, chats, docs]);

  const groups = useMemo(() => {
    const map = new Map<string, FFeedItem[]>();
    for (const item of feed) {
      const arr = map.get(item.when) ?? [];
      arr.push(item);
      map.set(item.when, arr);
    }
    return [...map.entries()];
  }, [feed]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (feed.length === 0) {
    return <p className={s.empty}>Nothing captured yet.</p>;
  }

  return (
    <>
      {groups.map(([when, items]) => (
        <div key={when} className={s.dayGroup}>
          <p className={s.dayHeader}>{dayLabel(when)}</p>
          <div className={s.dayRows}>
            {items.map((item) => {
              if (item.type === "conversation") {
                return (
                  <button
                    key={`c-${item.chat.id}`}
                    type="button"
                    className={s.feedRow}
                    onClick={() => onOpenChat(item.chat.id)}
                  >
                    <span className={`${s.feedBadge} ${s.feedBadgeConvo}`} aria-hidden="true">
                      💬
                    </span>
                    <span className={s.feedMain}>
                      <span className={s.feedTitle}>{item.chat.title}</span>
                      <span className={s.feedSnippet}>{item.chat.summary}</span>
                    </span>
                    <span className={s.feedMeta}>
                      <span
                        className={`${s.avatar} ${s.avatarSm} ${s[`tool${item.member.tool}`]}`}
                        aria-hidden="true"
                      >
                        {item.member.name[0]}
                      </span>
                      <span className={s.feedWho}>{item.member.name}</span>
                    </span>
                  </button>
                );
              }
              if (item.type === "file") {
                return (
                  <button
                    key={`f-${item.doc.id}`}
                    type="button"
                    className={s.feedRow}
                    onClick={() => onOpenDoc(item.doc.id)}
                  >
                    <span className={`${s.feedBadge} ${s.feedBadgeFile}`} aria-hidden="true">
                      📄
                    </span>
                    <span className={s.feedMain}>
                      <span className={s.feedTitle}>{item.doc.title}</span>
                      <span className={s.feedSnippet}>
                        {F_DOC_KIND_LABEL[item.doc.kind]} · {item.doc.summary}
                      </span>
                    </span>
                    <span className={s.feedMeta}>
                      <span
                        className={`${s.avatar} ${s.avatarSm} ${s[`tool${item.member.tool}`]}`}
                        aria-hidden="true"
                      >
                        {item.member.name[0]}
                      </span>
                      <span className={s.feedWho}>{item.member.name}</span>
                    </span>
                  </button>
                );
              }
              // fact row — expands inline
              const isOpen = expanded.has(item.entry.id);
              const other = item.entry.contradicts
                ? entries.find((x) => x.id === item.entry.contradicts)
                : null;
              const otherM = other ? fMember(other.memberId) : null;
              const src = fSourceForEntry(item.entry, chats, docs);
              return (
                <div key={`e-${item.entry.id}`} className={s.feedFactWrap}>
                  <button
                    type="button"
                    className={s.feedRow}
                    aria-expanded={isOpen}
                    onClick={() => toggle(item.entry.id)}
                  >
                    <span className={`${s.feedBadge} ${s.feedBadgeFact}`} aria-hidden="true">
                      ◆
                    </span>
                    <span className={s.feedMain}>
                      <span className={s.feedTitle}>
                        {item.entry.claim.length > 90
                          ? `${item.entry.claim.slice(0, 90)}…`
                          : item.entry.claim}
                        {item.entry.contradicts && <span className={s.feedZap}> ⚡</span>}
                      </span>
                      <span className={s.feedSnippet}>
                        {KIND_LABEL[item.entry.kind]} · {item.entry.topic}
                      </span>
                    </span>
                    <span className={s.feedMeta}>
                      <span
                        className={`${s.avatar} ${s.avatarSm} ${s[`tool${item.member.tool}`]}`}
                        aria-hidden="true"
                      >
                        {item.member.name[0]}
                      </span>
                      <span className={s.feedWho}>{item.member.name}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <div className={s.feedFactBody}>
                      <p className={s.claim}>{item.entry.claim}</p>
                      <p className={s.prov}>
                        {item.member.name} · {item.member.tool} · &ldquo;{item.entry.chat}&rdquo; ·{" "}
                        {item.entry.when}
                      </p>
                      {other && otherM && (
                        <p className={s.conflict}>
                          <span className={s.conflictBadge}>⚡ contested</span>
                          disagrees with {otherM.name}&apos;s &ldquo;{other.chat}&rdquo; ({other.when})
                        </p>
                      )}
                      {src && (
                        <button
                          type="button"
                          className={s.openSource}
                          onClick={() =>
                            src.kind === "chat" ? onOpenChat(src.chat.id) : onOpenDoc(src.doc.id)
                          }
                        >
                          open source →
                        </button>
                      )}
                      <button
                        type="button"
                        className={s.openSource}
                        onClick={() => onOpenFactTopic(item.entry.topic)}
                      >
                        open in facts →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
