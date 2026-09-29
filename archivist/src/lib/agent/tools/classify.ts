import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { defineTool } from "./define";

// TODO(step 2): run a Classifier sub-agent over the OCR text + known types with
// structured output ({ documentTypeId | proposedNewType, confidence, reasoning }).
export const classifyDocument = defineTool({
  name: "classify_document",
  description:
    "Classify the document against known document types using its OCR text. Returns the best matching type id (or null if none fit) with a confidence score.",
  parameters: z.object({ documentId: z.string() }),
  step: "classifying",
  async execute() {
    const [other] = await db.select().from(schema.documentTypes).where(eq(schema.documentTypes.name, "other"));
    return { documentTypeId: other?.id ?? null, confidence: 0, reasoning: "stub classifier" };
  },
});

export const setDocumentType = defineTool({
  name: "set_document_type",
  description: "Record the document's type (after classifying or creating a new type).",
  parameters: z.object({
    documentId: z.string(),
    documentTypeId: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  async execute({ documentId, documentTypeId, confidence }) {
    await db
      .update(schema.documents)
      .set({ documentTypeId, confidence })
      .where(eq(schema.documents.id, documentId));
    return { ok: true };
  },
});

export const classifyTools = [classifyDocument, setDocumentType];
