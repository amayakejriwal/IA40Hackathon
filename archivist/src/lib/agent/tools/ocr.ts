import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { defineTool } from "./define";

// TODO(step 2): real OCR via an OpenAI vision model (image + PDF input).
export const ocrDocument = defineTool({
  name: "ocr_document",
  description: "Run OCR on the document's file and store the extracted text. Returns the text.",
  parameters: z.object({ documentId: z.string() }),
  step: "ocr",
  async execute({ documentId }) {
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
    if (!doc) throw new Error(`Document ${documentId} not found`);
    const text = `[stub OCR] Contents of ${doc.filename}`;
    await db.update(schema.documents).set({ ocrText: text }).where(eq(schema.documents.id, documentId));
    return { text };
  },
});

export const ocrTools = [ocrDocument];
