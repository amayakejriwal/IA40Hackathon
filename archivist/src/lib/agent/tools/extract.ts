import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { defineTool } from "./define";

// TODO(step 4): run an Extractor sub-agent with the type's fieldSchema as its
// structured output, over the OCR text (and the image for low-confidence fields).
export const extractFields = defineTool({
  name: "extract_fields",
  description:
    "Extract the typed fields defined by the document's type from its OCR text. Returns a field-name → value map.",
  parameters: z.object({ documentId: z.string() }),
  step: "extracting",
  async execute() {
    return { fields: {} as Record<string, unknown> };
  },
});

export const saveFields = defineTool({
  name: "save_fields",
  description: "Save extracted field values plus a short human-readable title and summary for the document.",
  parameters: z.object({
    documentId: z.string(),
    title: z.string(),
    summary: z.string(),
    fieldsJson: z.string().describe("JSON object of field name → value"),
  }),
  async execute({ documentId, title, summary, fieldsJson }) {
    const extractedFields = JSON.parse(fieldsJson) as Record<string, unknown>;
    await db
      .update(schema.documents)
      .set({ title, summary, extractedFields })
      .where(eq(schema.documents.id, documentId));
    return { ok: true };
  },
});

export const extractTools = [extractFields, saveFields];
