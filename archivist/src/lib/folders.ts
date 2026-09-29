import { asc, desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type FolderNode = {
  id: string;
  name: string;
  path: string;
  description: string | null;
  children: FolderNode[];
  documents: { id: string; filename: string; title: string | null; status: string }[];
};

/** The library as a nested tree of folders with their filed documents. */
export async function getFolderTree(): Promise<FolderNode | null> {
  const folders = await db.select().from(schema.folders).orderBy(asc(schema.folders.path));
  const docs = await db
    .select({
      id: schema.documents.id,
      filename: schema.documents.filename,
      title: schema.documents.title,
      status: schema.documents.status,
      folderId: schema.documents.folderId,
    })
    .from(schema.documents)
    .orderBy(desc(schema.documents.createdAt));

  const nodes = new Map<string, FolderNode>(
    folders.map((f) => [f.id, { id: f.id, name: f.name, path: f.path, description: f.description, children: [], documents: [] }]),
  );
  let root: FolderNode | null = null;
  for (const f of folders) {
    const node = nodes.get(f.id)!;
    if (f.parentId && nodes.has(f.parentId)) nodes.get(f.parentId)!.children.push(node);
    else if (!f.parentId) root = node;
  }
  for (const { folderId, ...doc } of docs) {
    if (folderId) nodes.get(folderId)?.documents.push(doc);
  }
  return root;
}
