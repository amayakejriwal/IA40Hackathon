import type { BoardGroup, BoardPage } from "@/lib/board";
import { fileUrl } from "./format";

/** Documents the agent assembled from pages: a page stack, a title, a type. */
export function DocumentsView({
  groups,
  pages,
  onOpen,
}: {
  groups: BoardGroup[];
  pages: BoardPage[];
  onOpen: (id: string) => void;
}) {
  if (groups.length === 0) {
    return (
      <div className="docs">
        <div className="empty">
          <b>No documents yet</b>
          Pages are assembled into documents as they are read.
        </div>
      </div>
    );
  }
  const byId = new Map(pages.map((p) => [p.id, p]));

  return (
    <div className="docs">
      {groups.map((g) => {
        const shown = g.pageIds.slice(0, 4);
        const count = g.expectedCount ? `${g.receivedCount} of ${g.expectedCount} pages` : `${g.receivedCount} ${g.receivedCount === 1 ? "page" : "pages"}`;
        return (
          <div key={g.id} className="doc" onClick={() => g.pageIds[0] && onOpen(g.pageIds[0])}>
            <div className="stack">
              {shown.map((id, i) =>
                byId.get(id)?.mimeType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={id} src={fileUrl(id)} alt="" style={{ left: i * 22, zIndex: shown.length - i }} />
                ) : (
                  <div key={id} className="blank" style={{ left: i * 22, zIndex: shown.length - i }} />
                ),
              )}
            </div>
            <h3>{g.title}</h3>
            <div className="sub">
              {g.typeName ? `${g.typeName.replace(/_/g, " ")} · ` : ""}
              {count}
            </div>
          </div>
        );
      })}
    </div>
  );
}
