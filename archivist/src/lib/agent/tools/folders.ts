import { eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, newId, schema } from "@/lib/db";
import type { Folder } from "@/lib/db/schema";
import { defineTool } from "./define";

async function getFolder(id: string) {
  const [folder] = await db.select().from(schema.folders).where(eq(schema.folders.id, id));
  if (!folder) throw new Error(`Folder ${id} not found`);
  return folder;
}

function childPath(parentPath: string, name: string) {
  return `${parentPath === "/" ? "" : parentPath}/${name}`;
}

/** Re-point a folder and all its descendants from oldPath to newPath. */
async function rewritePaths(oldPath: string, newPath: string) {
  await db
    .update(schema.folders)
    .set({ path: sql`${newPath} || substr(${schema.folders.path}, ${oldPath.length + 1})` })
    .where(sql`${schema.folders.path} = ${oldPath} OR ${schema.folders.path} LIKE ${oldPath + "/%"}`);
}

export const getFolderTree = defineTool({
  name: "get_folder_tree",
  description: "Get the full folder tree (id, parentId, path, description, document count).",
  parameters: z.object({}),
  async execute() {
    const rows = await db
      .select({
        id: schema.folders.id,
        parentId: schema.folders.parentId,
        path: schema.folders.path,
        description: schema.folders.description,
        documentCount: sql<number>`(select count(*) from documents d where d.folder_id = ${schema.folders.id})`,
      })
      .from(schema.folders)
      .orderBy(schema.folders.path);
    return rows;
  },
});

export const createFolder = defineTool({
  name: "create_folder",
  description: "Create a new folder under a parent folder.",
  parameters: z.object({
    parentId: z.string().describe("Parent folder id (use the root folder id for top level)"),
    name: z.string(),
    description: z.string().describe("What belongs in this folder — used for future filing decisions"),
  }),
  async execute({ parentId, name, description }) {
    const parent = await getFolder(parentId);
    const [folder] = await db
      .insert(schema.folders)
      .values({ id: newId(), parentId, name, description, path: childPath(parent.path, name) })
      .returning();
    return folder;
  },
});

export const renameFolder = defineTool({
  name: "rename_folder",
  description: "Rename a folder (updates paths of all nested folders).",
  parameters: z.object({ folderId: z.string(), name: z.string() }),
  async execute({ folderId, name }) {
    const folder = await getFolder(folderId);
    if (!folder.parentId) throw new Error("Cannot rename the root folder");
    const parent = await getFolder(folder.parentId);
    const newPath = childPath(parent.path, name);
    await db.update(schema.folders).set({ name }).where(eq(schema.folders.id, folderId));
    await rewritePaths(folder.path, newPath);
    return { ...folder, name, path: newPath };
  },
});

export const moveFolder = defineTool({
  name: "move_folder",
  description: "Move a folder (and everything in it) under a new parent folder.",
  parameters: z.object({ folderId: z.string(), newParentId: z.string() }),
  async execute({ folderId, newParentId }) {
    const folder = await getFolder(folderId);
    const parent = await getFolder(newParentId);
    if (parent.path === folder.path || parent.path.startsWith(folder.path + "/")) {
      throw new Error("Cannot move a folder into itself");
    }
    const newPath = childPath(parent.path, folder.name);
    await db.update(schema.folders).set({ parentId: newParentId }).where(eq(schema.folders.id, folderId));
    await rewritePaths(folder.path, newPath);
    return { ...folder, parentId: newParentId, path: newPath } satisfies Folder;
  },
});

export const moveDocument = defineTool({
  name: "move_document",
  description: "File a document into a folder.",
  parameters: z.object({ documentId: z.string(), folderId: z.string() }),
  step: "filing",
  async execute({ documentId, folderId }) {
    const folder = await getFolder(folderId);
    await db.update(schema.documents).set({ folderId }).where(eq(schema.documents.id, documentId));
    return { documentId, path: folder.path };
  },
});

export async function getRootFolder() {
  const [root] = await db.select().from(schema.folders).where(isNull(schema.folders.parentId)).limit(1);
  if (!root) throw new Error("Root folder missing — run `npm run db:seed`");
  return root;
}

export const folderTools = [getFolderTree, createFolder, renameFolder, moveFolder, moveDocument];
