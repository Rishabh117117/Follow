import type { ReactNode } from "react";
import s from "./FollowSandbox.module.css";

/**
 * A tiny markdown-SUBSET renderer for uploaded-file bodies — builds React
 * elements directly (no dangerouslySetInnerHTML). Supports exactly what
 * lib/followDocs.ts bodies use: "## " / "### " headings, "- " bullet runs,
 * "**bold**" inline spans, "> " pull-quote lines, and blank-line-separated
 * paragraphs. Anything else renders as a plain paragraph.
 */

function renderInline(text: string, keyBase: string): ReactNode[] {
  // split on **bold** runs, keep the delimiters out, alternate plain/bold
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p.length > 0);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    return <span key={`${keyBase}-${i}`}>{part}</span>;
  });
}

export function renderDocBody(body: string): ReactNode[] {
  const lines = body.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    if (trimmed.startsWith("### ")) {
      blocks.push(
        <h4 key={key++} className={s.docH3}>
          {renderInline(trimmed.slice(4), `h3-${key}`)}
        </h4>,
      );
      i++;
      continue;
    }

    if (trimmed.startsWith("## ")) {
      blocks.push(
        <h3 key={key++} className={s.docH2}>
          {renderInline(trimmed.slice(3), `h2-${key}`)}
        </h3>,
      );
      i++;
      continue;
    }

    if (trimmed.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("- ")) {
        items.push(lines[i].trim().slice(2));
        i++;
      }
      blocks.push(
        <ul key={key++} className={s.docList}>
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `li-${key}-${idx}`)}</li>
          ))}
        </ul>,
      );
      continue;
    }

    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className={s.docQuote}>
          {quoteLines.map((ql, idx) => (
            <p key={idx}>{renderInline(ql, `bq-${key}-${idx}`)}</p>
          ))}
        </blockquote>,
      );
      continue;
    }

    // paragraph: collect contiguous non-blank, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].trim().startsWith("## ") &&
      !lines[i].trim().startsWith("### ") &&
      !lines[i].trim().startsWith("- ") &&
      !lines[i].trim().startsWith("> ")
    ) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push(
      <p key={key++} className={s.docPara}>
        {renderInline(paraLines.join(" "), `p-${key}`)}
      </p>,
    );
  }

  return blocks;
}
