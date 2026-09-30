import { and, eq } from "drizzle-orm";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { hasOpenAI, openaiModel } from "@/lib/config";
import { db, schema } from "@/lib/db";
import type { Document, PageAnalysis } from "@/lib/db/schema";
import { storage } from "@/lib/storage";
import { defineTool } from "./define";

const PageReading = z.object({
  text: z.string().describe("All text on the page in reading order, keeping line breaks and table rows"),
  pageRole: z.enum(["single", "first", "continuation", "last"]),
  pageMarker: z.string().nullable(),
  documentKind: z.string(),
  entities: z.array(
    z.object({
      kind: z.enum(["person", "org", "account", "case", "date", "amount", "address", "other"]),
      value: z.string(),
    }),
  ),
  language: z.string(),
  hasHandwriting: z.boolean(),
  issues: z.array(z.string()),
});

const OCR_PROMPT = `
Read this scanned page. Transcribe every word exactly as written (do not correct or
summarize); mark illegible words as [illegible]. Then describe the page:
- pageRole: "single" if it is a complete one-page document; "first" if a multi-page
  document starts here; "continuation" if it carries on from a previous page (no
  letterhead, text runs on, "Page 2 of 3"); "last" if it ends a multi-page document
  (signature, "Page 3 of 3").
- pageMarker: a printed page marker like "Page 2 of 3", else null.
- documentKind: what kind of document this is in a few words ("electric bill", "W-2").
- entities: names, organizations, account/case/invoice/policy numbers, key dates and
  amounts, addresses — anything that would tie this document to related ones.
- issues: unreadable, cut-off or damaged regions, else empty.
`.trim();

let client: OpenAI | undefined;

/** The phone's on-device Apple Vision text, if it sent one; a useful cross-check for the model. */
async function phoneOcrText(doc: Document) {
  if (!doc.batchId || !doc.captureId) return null;
  const [upload] = await db
    .select()
    .from(schema.phoneUploads)
    .where(
      and(
        eq(schema.phoneUploads.batchId, doc.batchId),
        eq(schema.phoneUploads.itemId, doc.captureId),
        eq(schema.phoneUploads.kind, "ocr"),
      ),
    );
  if (!upload) return null;
  const ocr = JSON.parse((await storage.get(upload.storagePath)).toString("utf8")) as { lines?: { text: string }[] };
  return ocr.lines?.map((l) => l.text).join("\n") || null;
}

async function readPage(doc: Document) {
  const data = (await storage.get(doc.storagePath)).toString("base64");
  const file =
    doc.mimeType === "application/pdf"
      ? ({ type: "input_file", filename: doc.filename, file_data: `data:application/pdf;base64,${data}` } as const)
      : ({ type: "input_image", image_url: `data:${doc.mimeType};base64,${data}`, detail: "high" } as const);
  const hint = await phoneOcrText(doc);

  client ??= new OpenAI();
  const response = await client.responses.parse({
    model: openaiModel,
    input: [
      {
        role: "user",
        content: [
          { type: "input_text", text: OCR_PROMPT },
          ...(hint
            ? [{ type: "input_text" as const, text: `On-device OCR of the same page (may contain errors):\n${hint}` }]
            : []),
          file,
        ],
      },
    ],
    text: { format: zodTextFormat(PageReading, "page_reading") },
  });
  if (!response.output_parsed) throw new Error("OCR returned no parsed output");
  return response.output_parsed;
}

export const ocrDocument = defineTool({
  name: "ocr_document",
  description:
    "Read the document's image: returns its full text plus pageRole (single/first/continuation/last), any page marker, a guess at the document kind, and key entities (names, account/case numbers, dates, amounts) for classification and grouping.",
  parameters: z.object({ documentId: z.string() }),
  step: "ocr",
  async execute({ documentId }) {
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
    if (!doc) throw new Error(`Document ${documentId} not found`);

    let text: string;
    let pageAnalysis: PageAnalysis;
    if (hasOpenAI()) {
      const { text: pageText, ...rest } = await readPage(doc);
      text = pageText;
      pageAnalysis = { ...rest, engine: openaiModel };
    } else {
      text = (await phoneOcrText(doc)) ?? `[stub OCR] Contents of ${doc.filename}`;
      pageAnalysis = {
        pageRole: "single",
        pageMarker: null,
        documentKind: "unknown",
        entities: [],
        language: "en",
        hasHandwriting: false,
        issues: [],
        engine: "stub",
      };
    }

    await db.update(schema.documents).set({ ocrText: text, pageAnalysis }).where(eq(schema.documents.id, documentId));
    return { text, ...pageAnalysis };
  },
});

export const ocrTools = [ocrDocument];
