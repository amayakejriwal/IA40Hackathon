import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { humanDate, typeLabel } from "@/lib/filing";

export type LibraryDocument = {
  id: string; // group id
  name: string;
  type: string | null;
  date: string | null; // human, e.g. "Jul 27, 2026"
  isoDate: string | null;
  pageCount: number;
  firstPageId: string;
  status: "incomplete" | "complete";
  expectedCount: number | null;
};

export type FolderNode = {
  id: string;
  name: string;
  path: string;
  description: string | null;
  /** Documents anywhere below this folder. */
  total: number;
  children: FolderNode[];
  documents: LibraryDocument[];
};

/** The library as a tree of folders holding documents (groups of pages), for browsing. */
export async function getFolderTree(): Promise<FolderNode | null> {
  const folders = await db.select().from(schema.folders).orderBy(asc(schema.folders.name));
  return buildTree(folders);
}

async function buildTree(folders: (typeof schema.folders.$inferSelect)[]): Promise<FolderNode | null> {
  const groups = await db.select().from(schema.documentGroups);
  const types = new Map((await db.select().from(schema.documentTypes)).map((t) => [t.id, t.name]));
  const pages = await db
    .select({ id: schema.documents.id, groupId: schema.documents.groupId, folderId: schema.documents.folderId })
    .from(schema.documents)
    .orderBy(asc(schema.documents.pageNumber), asc(schema.documents.createdAt));
  const pagesByGroup = new Map<string, string[]>();
  // Documents filed before groups tracked their folder only have it on their pages.
  const pageFolder = new Map<string, string>();
  for (const p of pages) {
    if (!p.groupId) continue;
    pagesByGroup.set(p.groupId, [...(pagesByGroup.get(p.groupId) ?? []), p.id]);
    if (p.folderId && !pageFolder.has(p.groupId)) pageFolder.set(p.groupId, p.folderId);
  }

  const nodes = new Map<string, FolderNode>(
    folders.map((f) => [f.id, { id: f.id, name: f.name, path: f.path, description: f.description, total: 0, children: [], documents: [] }]),
  );
  let root: FolderNode | null = null;
  for (const f of folders) {
    const node = nodes.get(f.id)!;
    if (f.parentId && nodes.has(f.parentId)) nodes.get(f.parentId)!.children.push(node);
    else if (!f.parentId) root = node;
  }

  for (const g of groups) {
    const pageIds = pagesByGroup.get(g.id);
    const folderId = g.folderId ?? pageFolder.get(g.id);
    if (!folderId || !pageIds?.length) continue;
    const typeName = g.documentTypeId ? types.get(g.documentTypeId) : undefined;
    nodes.get(folderId)?.documents.push({
      id: g.id,
      name: g.displayName ?? g.title,
      type: typeName && typeName !== "other" ? typeLabel(typeName) : null,
      date: humanDate(g.documentDate),
      isoDate: g.documentDate,
      pageCount: pageIds.length,
      firstPageId: pageIds[0],
      status: g.status,
      expectedCount: g.expectedCount,
    });
  }

  // Newest documents first, then by name; totals roll up.
  const finish = (n: FolderNode): number => {
    n.documents.sort((a, b) => (b.isoDate ?? "").localeCompare(a.isoDate ?? "") || a.name.localeCompare(b.name));
    n.total = n.documents.length + n.children.reduce((sum, c) => sum + finish(c), 0);
    return n.total;
  };
  if (root) finish(root);
  return root;
}
