import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { storage } from "@/lib/storage";

/** Stream a document's original file (for previews). */
export async function GET(_req: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, id));
  if (!doc) return new Response("Not found", { status: 404 });
  let data: Buffer;
  try {
    data = await storage.get(doc.storagePath);
  } catch {
    return new Response("File missing", { status: 404 });
  }
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(doc.filename)}"`,
      // Uploaded files are untrusted (an SVG can carry script): never let one run as a page.
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
