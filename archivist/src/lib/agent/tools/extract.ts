import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { defineTool } from "./define";

/**
 * Field extraction is done by the agent itself from the OCR text against the
 * type's fieldSchema (returned by set_document_type); this tool saves the result.
 */
export const saveFields = defineTool({
  name: "save_fields",
  description:
    "Save the typed field values for the document's type (keys from its fieldSchema; use null when a value is not on the page), plus a short human-readable title and one-sentence summary.",
  parameters: z.object({
    documentId: z.string(),
    title: z.string(),
    summary: z.string(),
    fieldsJson: z.string().describe("JSON object of field name → value"),
    confidenceJson: z
      .string()
      .describe("JSON object of field name → confidence 0-1 (1 = printed and clearly legible, <0.8 = guessed, smudged or handwritten)"),
  }),
  step: "extracting",
  async execute({ documentId, title, summary, fieldsJson, confidenceJson }) {
    const extractedFields = JSON.parse(fieldsJson) as Record<string, unknown>;
    const fieldConfidence = JSON.parse(confidenceJson) as Record<string, number>;
    await db
      .update(schema.documents)
      .set({ title, summary, extractedFields, fieldConfidence })
      .where(eq(schema.documents.id, documentId));
    const lowConfidence = Object.entries(fieldConfidence).filter(([, c]) => c < 0.8).map(([k]) => k);
    return { ok: true, lowConfidence };
  },
});

export const extractTools = [saveFields];
