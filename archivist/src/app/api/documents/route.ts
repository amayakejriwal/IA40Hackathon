import { after } from "next/server";
import { desc } from "drizzle-orm";
import { db, newId, schema } from "@/lib/db";
import { sanitizeFilename, storage } from "@/lib/storage";
import { enqueueJob, kickWorker } from "@/lib/jobs/queue";

export const maxDuration = 300;

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Upload one or more documents (multipart field "file", repeatable).
 * Used by the web UI and, later, the mobile scanner app (send `source=mobile`).
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  const source = form.get("source") === "mobile" ? "mobile" : "web";
  if (files.length === 0) return Response.json({ error: "No file provided" }, { status: 400 });

  const created = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) return Response.json({ error: `${file.name} exceeds 25MB` }, { status: 413 });
    const id = newId();
    const mimeType = file.type || "application/octet-stream";
    const storagePath = await storage.put(
      `${id}/${sanitizeFilename(file.name)}`,
      Buffer.from(await file.arrayBuffer()),
      mimeType,
    );
    const [doc] = await db
      .insert(schema.documents)
      .values({ id, filename: file.name, mimeType, sizeBytes: file.size, storagePath, source })
      .returning();
    await enqueueJob("process", { documentId: id });
    created.push(doc);
  }

  after(kickWorker);
  return Response.json({ documents: created }, { status: 201 });
}

export async function GET() {
  const documents = await db
    .select({
      id: schema.documents.id,
      filename: schema.documents.filename,
      title: schema.documents.title,
      status: schema.documents.status,
      source: schema.documents.source,
      batchId: schema.documents.batchId,
      pageNumber: schema.documents.pageNumber,
      mimeType: schema.documents.mimeType,
      documentTypeId: schema.documents.documentTypeId,
      groupId: schema.documents.groupId,
      folderId: schema.documents.folderId,
      error: schema.documents.error,
      createdAt: schema.documents.createdAt,
    })
    .from(schema.documents)
    .orderBy(desc(schema.documents.createdAt))
    .limit(200);
  return Response.json({ documents });
}
