import { after } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { enqueueJob, kickWorker } from "@/lib/jobs/queue";

export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  const [document] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
  if (!document) return Response.json({ error: "Not found" }, { status: 404 });

  const [type] = document.documentTypeId
    ? await db.select().from(schema.documentTypes).where(eq(schema.documentTypes.id, document.documentTypeId))
    : [];
  const [group] = document.groupId
    ? await db.select().from(schema.documentGroups).where(eq(schema.documentGroups.id, document.groupId))
    : [];
  const [folder] = document.folderId
    ? await db.select().from(schema.folders).where(eq(schema.folders.id, document.folderId))
    : [];

  return Response.json({ document, type: type ?? null, group: group ?? null, folder: folder ?? null });
}

/** Re-run the processing pipeline for a document. */
export async function POST(_req: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  const [document] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
  if (!document) return Response.json({ error: "Not found" }, { status: 404 });
  await db.update(schema.documents).set({ status: "uploaded", error: null }).where(eq(schema.documents.id, id));
  const jobId = await enqueueJob("process", { documentId: id });
  after(kickWorker);
  return Response.json({ jobId }, { status: 202 });
}
