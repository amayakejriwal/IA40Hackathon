"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEvent, Document, DocumentGroup, DocumentType, Folder } from "@/lib/db/schema";
import { breadcrumb, humanDate, typeLabel } from "@/lib/format";
import { fileUrl } from "./format";
import { PageImage } from "./PageImage";

type Detail = { document: Document; type: DocumentType | null; group: DocumentGroup | null; folder: Folder | null };
type PhoneOcr = { lines: { text: string; words?: { text: string; box: number[] }[] }[] };

const FINAL = new Set(["done", "error", "rejected"]);

/** A page up close: the scan, what it is, where it was filed. Everything else is under Details. */
export function PageDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [ocr, setOcr] = useState<PhoneOcr | null>(null);
  const [showBoxes, setShowBoxes] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (id && !dlg.open) dlg.showModal();
    if (!id && dlg.open) dlg.close();
  }, [id]);

  // Keep the page live while the agent is still working on it.
  useEffect(() => {
    if (!id) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    fetch(`/api/documents/${id}/ocr`)
      .then((r) => r.json())
      .then((r) => active && setOcr(r.ocr));
    const load = async () => {
      const [d, e] = await Promise.all([
        fetch(`/api/documents/${id}`).then((r) => (r.ok ? r.json() : null)),
        fetch(`/api/documents/${id}/events`).then((r) => r.json()),
      ]);
      if (!active) return;
      setDetail(d);
      setEvents(e.events);
      if (d && !FINAL.has(d.document.status)) timer = setTimeout(load, 1000);
    };
    load();
    return () => {
      active = false;
      clearTimeout(timer);
      setDetail(null);
      setEvents([]);
      setOcr(null);
      setShowBoxes(false);
    };
  }, [id, busy]);

  async function reprocess() {
    if (!id) return;
    setBusy(true);
    await fetch(`/api/documents/${id}`, { method: "POST" });
    setBusy(false);
  }

  const doc = detail?.document;
  const words = ocr?.lines.flatMap((l) => l.words ?? []) ?? [];
  const fields = Object.entries(doc?.extractedFields ?? {}).filter(([, v]) => v != null && v !== "");
  const title = doc && (doc.title ?? (doc.pageNumber != null ? `Page ${doc.pageNumber}` : doc.filename));
  const working = doc && !FINAL.has(doc.status);

  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      {doc && (
        <div className="detail">
          <div className="stage">
            {doc.mimeType === "application/pdf" ? (
              <iframe src={fileUrl(doc.id)} title={doc.filename} />
            ) : doc.mimeType.startsWith("image/") ? (
              <>
                <PageImage id={doc.id} alt={doc.filename} className="page-full" />
                {showBoxes && (
                  <svg viewBox="0 0 1 1" preserveAspectRatio="none">
                    {words.map((w, i) => (
                      <rect key={i} x={w.box[0]} y={w.box[1]} width={w.box[2]} height={w.box[3]} />
                    ))}
                  </svg>
                )}
              </>
            ) : null}
          </div>

          <div className="side">
            <div>
              <h2>{title}</h2>
              <div className="sub">
                {working
                  ? "Processing…"
                  : doc.status === "rejected"
                    ? "Marked for retake on the phone"
                    : doc.status === "error"
                      ? "Could not be processed"
                      : detail.type && detail.type.name !== "other"
                        ? typeLabel(detail.type.name)
                        : "Unclassified"}
              </div>
            </div>

            {doc.summary && doc.summary !== "Stub summary" && <div>{doc.summary}</div>}

            <dl className="facts">
              {detail.folder && (
                <>
                  <dt>Folder</dt>
                  <dd>{breadcrumb(detail.folder.path)}</dd>
                </>
              )}
              {detail.group && (
                <>
                  <dt>Document</dt>
                  <dd>
                    {detail.group.displayName ?? detail.group.title}
                    {detail.group.documentDate ? `, ${humanDate(detail.group.documentDate)}` : ""}
                    {detail.group.expectedCount ? `, ${detail.group.receivedCount} of ${detail.group.expectedCount} pages` : ""}
                  </dd>
                </>
              )}
              {fields.slice(0, 4).map(([k, v]) => (
                <div key={k} style={{ display: "contents" }}>
                  <dt>{k.replace(/_/g, " ")}</dt>
                  <dd>{String(v)}</dd>
                </div>
              ))}
            </dl>

            {doc.status === "error" && doc.error && <div className="error-text">{doc.error}</div>}

            {!working && (
              <div className="buttons">
                <button className="pill quiet" onClick={reprocess} disabled={busy}>
                  {doc.status === "rejected" ? "Process anyway" : "Reprocess"}
                </button>
              </div>
            )}

            <details className="more">
              <summary>Details</summary>
              {fields.length > 4 && (
                <>
                  <h4>All fields</h4>
                  <dl className="facts">
                    {fields.map(([k, v]) => (
                      <div key={k} style={{ display: "contents" }}>
                        <dt>{k.replace(/_/g, " ")}</dt>
                        <dd>{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
              {words.length > 0 && (
                <label style={{ fontSize: 13 }}>
                  <input type="checkbox" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} /> Show
                  recognized words
                </label>
              )}
              <h4>Text</h4>
              <pre>{doc.ocrText ?? (ocr ? ocr.lines.map((l) => l.text).join("\n") : "Not read yet")}</pre>
              <h4>Activity</h4>
              <ol className="activity">
                {events
                  .filter((e) => e.kind !== "tool_result")
                  .map((e) => (
                    <li key={e.id} className={e.kind === "error" ? "err" : undefined}>
                      {new Date(e.createdAt).toLocaleTimeString()}{" "}
                      {e.kind === "tool_call" ? e.toolName?.replace(/_/g, " ") : e.message}
                    </li>
                  ))}
              </ol>
              <h4>Source</h4>
              <pre>
                {doc.batchId ? `Phone session ${doc.batchId}, capture ${doc.captureId}` : `Uploaded file ${doc.filename}`}
                {doc.sha256 ? `\nsha256 ${doc.sha256}` : ""}
              </pre>
            </details>
          </div>
        </div>
      )}
    </dialog>
  );
}
