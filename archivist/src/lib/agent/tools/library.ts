import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { searchLibrary } from "@/lib/search";
import { defineTool } from "./define";

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
  description:
    "Search the library's documents by any words: name, type, folder, field values (vendor, patient, amounts) or text. Returns each document's name, folder breadcrumb, date, page count and why it matched.",
  parameters: z.object({ query: z.string(), limit: z.number().int().min(1).max(100) }),
  async execute({ query, limit }) {
    return searchLibrary(query, limit);
  },
});

export const libraryTools = [getDocument, searchDocuments];
