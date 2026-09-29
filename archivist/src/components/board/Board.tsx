"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Board as BoardData } from "@/lib/board";
import type { FolderNode } from "@/lib/folders";
import { CaptureGrid } from "./CaptureGrid";
import { DocumentsView } from "./DocumentsView";
import { LibraryView } from "./LibraryView";
import { PageDialog } from "./PageDialog";

type Tab = "pages" | "documents" | "library";

const TABS: { id: Tab; label: string }[] = [
  { id: "pages", label: "Pages" },
  { id: "documents", label: "Documents" },
  { id: "library", label: "Library" },
];

/** The whole app: incoming pages, assembled documents, and the organized library. */
export function Board() {
  const [scope, setScope] = useState<string | null>(null);
  const [data, setData] = useState<BoardData | null>(null);
  const [known, setKnown] = useState<Set<string> | null>(null);
  const [tree, setTree] = useState<FolderNode | null>(null);
  const [tab, setTab] = useState<Tab>("pages");
  const [openId, setOpenId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const last = useRef({ board: "", tree: "" });
  const shown = useRef<BoardData | null>(null);

  const refresh = useCallback(async () => {
    const [board, folders] = await Promise.all([
      fetch("/api/board" + (scope ? `?scope=${encodeURIComponent(scope)}` : ""), { cache: "no-store" }).then((r) => r.text()),
      fetch("/api/folders", { cache: "no-store" }).then((r) => r.text()),
    ]);
    if (board !== last.current.board) {
      last.current.board = board;
      const next = JSON.parse(board) as BoardData;
      // Items present before this change are "known"; new ones animate in.
      const prev = shown.current;
      setKnown(prev ? new Set([...prev.pages.map((p) => p.id), ...prev.voiceNotes.map((n) => n.id)]) : null);
      shown.current = next;
      setData(next);
    }
    if (folders !== last.current.tree) {
      last.current.tree = folders;
      setTree(JSON.parse(folders).tree);
    }
  }, [scope]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        await refresh();
      } catch {}
      if (active) timer = setTimeout(tick, 800);
    };
    tick();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [refresh]);

  function changeScope(next: string) {
    last.current.board = "";
    shown.current = null;
    setKnown(null);
    setScope(next);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    const form = new FormData();
    for (const f of Array.from(files)) form.append("file", f);
    await fetch("/api/documents", { method: "POST", body: form });
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    if (data?.scope !== "web" && data?.scope !== "all") changeScope("web");
    else refresh();
  }

  const pages = data?.pages ?? [];
  const accepted = pages.filter((p) => p.status !== "rejected");
  const session = data?.session;

  return (
    <div
      className={"shell" + (dragging ? " dropping" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files);
      }}
    >
      <div className="top">
        <h1>Archivist</h1>
        <div className="actions">
          <select className="picker" value={data?.scope ?? ""} onChange={(e) => changeScope(e.target.value)}>
            {data?.sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {sessionName(s.startedAt, s.id)}
              </option>
            ))}
            <option value="web">Uploads</option>
            <option value="all">Everything</option>
          </select>
          <button className="pill" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? "Uploading…" : "Upload"}
          </button>
          <input ref={fileInput} type="file" multiple accept="image/*,application/pdf" hidden onChange={(e) => upload(e.target.files)} />
        </div>
      </div>

      <div className="summary">
        {session?.status === "live" && <span className="live">Scanning · </span>}
        {accepted.length} {accepted.length === 1 ? "page" : "pages"} · {data?.groups.length ?? 0}{" "}
        {data?.groups.length === 1 ? "document" : "documents"}
      </div>

      <div className="segmented">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "pages" && <CaptureGrid pages={pages} notes={data?.voiceNotes ?? []} known={known} onOpen={setOpenId} />}
      {tab === "documents" && <DocumentsView groups={data?.groups ?? []} pages={pages} onOpen={setOpenId} />}
      {tab === "library" && <LibraryView tree={tree} onOpen={setOpenId} />}

      <PageDialog id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

/** "Today, 3:00 PM" style name for a scanning session. */
function sessionName(startedAt: number | null, id: string) {
  if (!startedAt) return id;
  const d = new Date(startedAt);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return today ? `Today, ${time}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}
