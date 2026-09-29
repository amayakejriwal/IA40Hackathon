import { desc, eq, like, or } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { defineTool } from "./define";

const summaryColumns = {
  id: schema.documents.id,
  filename: schema.documents.filename,
  title: schema.documents.title,
  summary: schema.documents.summary,
  documentTypeId: schema.documents.documentTypeId,
  groupId: schema.documents.groupId,
  folderId: schema.documents.folderId,
  status: schema.documents.status,
};

export const getDocument = defineTool({
  name: "get_document",
  description: "Get a document's metadata, OCR text, type, group, folder and extracted fields.",
  parameters: z.object({ documentId: z.string() }),
  async execute({ documentId }) {
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
    if (!doc) throw new Error(`Document ${documentId} not found`);
    return doc;
  },
});

export const searchDocuments = defineTool({
  name: "search_documents",
  description: "Search processed documents by text (title, summary, OCR). Empty query lists the most recent.",
  parameters: z.object({ query: z.string(), limit: z.number().int().min(1).max(100) }),
  async execute({ query, limit }) {
    const q = `%${query}%`;
    return db
      .select(summaryColumns)
      .from(schema.documents)
      .where(
        query
          ? or(like(schema.documents.title, q), like(schema.documents.summary, q), like(schema.documents.ocrText, q))
          : undefined,
      )
      .orderBy(desc(schema.documents.createdAt))
      .limit(limit);
  },
});

export const libraryTools = [getDocument, searchDocuments];
