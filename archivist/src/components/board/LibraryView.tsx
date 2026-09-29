import type { FolderNode } from "@/lib/folders";

/** The organized library as one clean list: folders, and the documents filed in them. */
export function LibraryView({ tree, onOpen }: { tree: FolderNode | null; onOpen: (id: string) => void }) {
  if (!tree || count(tree) === 0) {
    return (
      <div className="empty">
        <b>The library is empty</b>
        Filed documents appear here, organized into folders.
      </div>
    );
  }
  return <div className="list">{rows(tree, 0, onOpen)}</div>;
}

function count(node: FolderNode): number {
  return node.documents.length + node.children.reduce((n, c) => n + count(c), 0);
}

function rows(node: FolderNode, depth: number, onOpen: (id: string) => void): React.ReactNode[] {
  const indent = { paddingLeft: 18 + depth * 20 };
  const out: React.ReactNode[] = [];
  if (depth > 0) {
    out.push(
      <div key={node.id} className="item folder" style={{ paddingLeft: 18 + (depth - 1) * 20 }}>
        <span className="chev">›</span>
        {node.name}
        <span className="n">{count(node)}</span>
      </div>,
    );
  }
  for (const child of node.children) out.push(...rows(child, depth + 1, onOpen));
  for (const doc of node.documents) {
    out.push(
      <div key={doc.id} className="item" style={indent} onClick={() => onOpen(doc.id)}>
        <span className="chev" />
        {doc.title ?? doc.filename}
      </div>,
    );
  }
  return out;
}
