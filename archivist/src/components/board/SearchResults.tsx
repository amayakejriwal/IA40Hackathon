"use client";

import { useEffect, useState } from "react";
import type { SearchResult } from "@/lib/search";

/** Wraps each query word found in `text` in <mark>. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${terms.join("|")})`, "gi"));
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}

/** Library search results: what the document is, where it lives, and why it matched. */
export function SearchResults({ query, onOpen }: { query: string; onOpen: (pageId: string) => void }) {
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [answered, setAnswered] = useState("");

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let active = true;
    const timer = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((res) => res.json());
      if (!active) return;
      setResults(r.results);
      setAnswered(q);
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  if (!results) return null;
  if (results.length === 0) {
    return (
      <div className="empty">
        <b>No results for &ldquo;{answered}&rdquo;</b>
        Try a name, a company, an amount, or a kind of document.
      </div>
    );
  }

  return (
    <>
      <div className="count">
        {results.length} {results.length === 1 ? "document" : "documents"}
      </div>
      <div className="list results">
        {results.map((r) => (
          <div key={r.groupId} className="item doc-row" onClick={() => onOpen(r.firstPageId)}>
            <div className="main">
              <div className="name">
                <Highlight text={r.name} query={answered} />
              </div>
              <div className="sub">
                {[r.type, r.date, `${r.pageCount} ${r.pageCount === 1 ? "page" : "pages"}`].filter(Boolean).join(" · ")}
              </div>
              {r.match && (
                <div className="why">
                  <span className="label">{r.match.label}:</span> <Highlight text={r.match.text} query={answered} />
                </div>
              )}
            </div>
            <div className="where">{r.breadcrumb}</div>
          </div>
        ))}
      </div>
    </>
  );
}
