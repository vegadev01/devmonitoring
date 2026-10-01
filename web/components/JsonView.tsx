"use client";
import { useMemo } from "react";

const TOKEN = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
const HIGHLIGHT_LIMIT = 400_000;

/** Pretty JSON with syntax colouring, rendered as React nodes (never as HTML). */
export function JsonView({ text, pretty }: { text: string; pretty: boolean }) {
  const { out, isJson } = useMemo(() => {
    if (!pretty) return { out: text, isJson: false };
    try {
      return { out: JSON.stringify(JSON.parse(text), null, 2), isJson: true };
    } catch {
      return { out: text, isJson: false };
    }
  }, [text, pretty]);

  const nodes = useMemo(() => {
    if (!isJson || out.length > HIGHLIGHT_LIMIT) return out;
    const parts: React.ReactNode[] = [];
    let last = 0;
    let n = 0;
    for (const m of out.matchAll(TOKEN)) {
      const i = m.index ?? 0;
      if (i > last) parts.push(out.slice(last, i));
      const t = m[0];
      const cls = t.startsWith('"') ? (t.trimEnd().endsWith(":") ? "j-key" : "j-str") : /true|false/.test(t) ? "j-bool" : t === "null" ? "j-null" : "j-num";
      parts.push(<span key={n++} className={cls}>{t}</span>);
      last = i + t.length;
    }
    parts.push(out.slice(last));
    return parts;
  }, [out, isJson]);

  return <pre className="code-view">{nodes}</pre>;
}
