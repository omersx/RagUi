"use client";

import type { ReactNode } from "react";

/**
 * Lightweight, dependency-free markdown renderer.
 * Supports: headings, bold/italic/inline-code/links, fenced code blocks,
 * unordered + ordered lists, paragraphs. Output is React nodes (XSS-safe,
 * no dangerouslySetInnerHTML).
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;

    if (tok.startsWith("**") || tok.startsWith("__")) {
      nodes.push(
        <strong key={key} className="font-semibold text-zinc-50">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.85em] text-amber-200/90">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("[")) {
      const match = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(tok);
      nodes.push(
        <a
          key={key}
          href={match?.[2] ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-300"
        >
          {match?.[1] ?? tok}
        </a>
      );
    } else {
      nodes.push(
        <em key={key} className="italic text-zinc-300">
          {tok.slice(1, -1)}
        </em>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function Markdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push(
        <div key={key++} className="my-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
          {lang && (
            <div className="border-b border-zinc-800 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              {lang}
            </div>
          )}
          <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-zinc-300">
            <code>{codeLines.join("\n")}</code>
          </pre>
        </div>
      );
      continue;
    }

    // Headings
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const sizes = ["text-lg", "text-base", "text-sm", "text-sm"];
      blocks.push(
        <p
          key={key++}
          className={`mt-4 mb-2 first:mt-0 font-semibold text-zinc-50 ${sizes[level - 1]}`}
        >
          {renderInline(heading[2], `h${key}`)}
        </p>
      );
      i++;
      continue;
    }

    // Unordered list
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={key++} className="my-2 space-y-1.5 pl-5">
          {items.map((item, j) => (
            <li key={j} className="list-disc marker:text-zinc-600 leading-relaxed">
              {renderInline(item, `ul${key}-${j}`)}
            </li>
          ))}
        </ul>
      );
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push(
        <ol key={key++} className="my-2 space-y-1.5 pl-5">
          {items.map((item, j) => (
            <li key={j} className="list-decimal marker:text-zinc-600 leading-relaxed">
              {renderInline(item, `ol${key}-${j}`)}
            </li>
          ))}
        </ol>
      );
      continue;
    }

    // Blank line → paragraph break
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph (merge consecutive non-empty plain lines)
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^#{1,4}\s/.test(lines[i]) &&
      !lines[i].trimStart().startsWith("```")
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="leading-relaxed whitespace-pre-wrap">
        {renderInline(para.join("\n"), `p${key}`)}
      </p>
    );
  }

  return <div className="text-[13.5px] text-zinc-200">{blocks}</div>;
}
