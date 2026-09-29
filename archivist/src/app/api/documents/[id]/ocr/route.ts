import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { storage } from "@/lib/storage";

/**
 * Word-level OCR for a page, for the word-box overlay. Today this is the phone's
 * Apple Vision OCR when it was sent ({engine, lines:[{text, box, words:[{text, box}]}]},
 * boxes normalized [x, y, w, h], top-left origin). Our own OCR tool should emit
 * the same shape once it is implemented.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]/ocr">) {
  const { id } = await ctx.params;
  const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
  if (!doc?.batchId || !doc.captureId) return Response.json({ ocr: null });
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
  if (!upload) return Response.json({ ocr: null });
  return Response.json({ ocr: JSON.parse((await storage.get(upload.storagePath)).toString("utf8")) });
}
