import type { BoardPage, BoardVoiceNote } from "@/lib/board";
import { pageLabel, pageState } from "./format";
import { PageImage } from "./PageImage";

type Item = { t: number; page?: BoardPage; note?: BoardVoiceNote };

/** Pages as they arrive, newest first; spoken notes sit between them in time order. */
export function CaptureGrid({
  pages,
  notes,
  known,
  onOpen,
}: {
  pages: BoardPage[];
  notes: BoardVoiceNote[];
  /** Ids already shown on a previous refresh; anything else animates in. Null on first load. */
  known: Set<string> | null;
  onOpen: (id: string) => void;
}) {
  const items: Item[] = [
    ...pages.map((page) => ({ t: page.capturedAt ?? page.receivedAt, page })),
    ...notes.filter((n) => n.transcript).map((note) => ({ t: note.tStart, note })),
  ].sort((a, b) => b.t - a.t);

  if (items.length === 0) {
    return (
      <div className="pages">
        <div className="empty">
          <b>No pages yet</b>
          Press Start on the phone, or drop files here.
        </div>
      </div>
    );
  }

  return (
    <div className="pages">
      {items.map(({ page, note }) => {
        const id = (page?.id ?? note?.id)!;
        const fresh = known !== null && !known.has(id) ? " fresh" : "";
        if (note) {
          return (
            <div key={id} className={"voice" + fresh}>
              &ldquo;{note.transcript}&rdquo;
            </div>
          );
        }
        const p = page!;
        const state = pageState(p);
        return (
          <div key={id} className={`page${p.status === "rejected" ? " dim" : ""}${fresh}`} onClick={() => onOpen(p.id)}>
            <div className="sheet">
              {p.mimeType.startsWith("image/") ? (
                <PageImage id={p.id} alt={pageLabel(p)} lazy />
              ) : (
                <span className="state">{p.mimeType === "application/pdf" ? "PDF" : "File"}</span>
              )}
            </div>
            <div className="cap">{p.title && p.title !== p.filename ? p.title : pageLabel(p)}</div>
            <div className="state">
              <span className={`dot ${state.dot}`} />
              {state.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}
