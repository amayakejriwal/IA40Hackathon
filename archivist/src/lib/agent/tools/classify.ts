import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { defineTool } from "./define";

/**
 * Classification is the agent's own judgment over the OCR result and the known
 * types (list_document_types); this tool records the decision and its reasoning,
 * which the activity timeline shows.
 */
export const setDocumentType = defineTool({
  name: "set_document_type",
  description:
    "Record the document's type after comparing its OCR text against list_document_types (or after create_document_type). Continuation pages take the type of the document they continue.",
  parameters: z.object({
    documentId: z.string(),
    documentTypeId: z.string(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().describe("One sentence: why this type, and the runner-up if it was close"),
  }),
  step: "classifying",
  async execute({ documentId, documentTypeId, confidence }) {
    const [type] = await db.select().from(schema.documentTypes).where(eq(schema.documentTypes.id, documentTypeId));
    if (!type) throw new Error(`Document type ${documentTypeId} not found; call list_document_types`);
    await db
      .update(schema.documents)
      .set({ documentTypeId, confidence })
      .where(eq(schema.documents.id, documentId));
    return { ok: true, type: type.name, fieldSchema: type.fieldSchema };
  },
});

export const classifyTools = [setDocumentType];
