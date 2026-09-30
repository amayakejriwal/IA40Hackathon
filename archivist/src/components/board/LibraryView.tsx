"use client";

import { useState } from "react";
import type { FolderNode } from "@/lib/folders";

/**
 * The library as a Finder-style browser: one folder at a time, with a
 * breadcrumb back up. Folders show what belongs in them; documents show what
 * they are, their date and length.
 */
export function LibraryView({ tree, onOpen }: { tree: FolderNode | null; onOpen: (pageId: string) => void }) {
  const [trail, setTrail] = useState<string[]>([]);

  if (!tree || tree.total === 0) {
    return (
      <div className="empty">
        <b>The library is empty</b>
        Documents are filed here into folders as they are read.
      </div>
    );
  }

  // Resolve the trail against the current tree; folders can be renamed or moved by the Librarian.
  const path: FolderNode[] = [tree];
  for (const id of trail) {
    const next = path[path.length - 1].children.find((c) => c.id === id);
    if (!next) break;
    path.push(next);
  }
  const here = path[path.length - 1];
  const open = (id: string) => setTrail([...path.slice(1).map((f) => f.id), id]);
  const children = here.children.filter((c) => c.total > 0);

  return (
    <>
      <nav className="crumbs">
        {path.map((f, i) => (
          <span key={f.id}>
            {i > 0 && <span className="sep">›</span>}
            {i === path.length - 1 ? (
              <b>{i === 0 ? "Library" : f.name}</b>
            ) : (
              <button onClick={() => setTrail(path.slice(1, i + 1).map((p) => p.id))}>{i === 0 ? "Library" : f.name}</button>
            )}
          </span>
        ))}
      </nav>
      {here !== tree && here.description && <p className="folder-desc">{here.description}</p>}

      <div className="list">
        {children.map((c) => (
          <div key={c.id} className="item doc-row" onClick={() => open(c.id)}>
            <div className="folder-icon" aria-hidden />
            <div className="main">
              <div className="name">{c.name}</div>
              {c.description && <div className="sub">{c.description}</div>}
            </div>
            <div className="where">
              {c.total} <span className="chev">›</span>
            </div>
          </div>
        ))}
        {here.documents.map((d) => (
          <div key={d.id} className="item doc-row" onClick={() => onOpen(d.firstPageId)}>
            <div className="doc-icon" aria-hidden />
            <div className="main">
              <div className="name">{d.name}</div>
              <div className="sub">
                {[
                  d.type,
                  d.date,
                  d.expectedCount && d.pageCount < d.expectedCount
                    ? `${d.pageCount} of ${d.expectedCount} pages`
                    : `${d.pageCount} ${d.pageCount === 1 ? "page" : "pages"}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
