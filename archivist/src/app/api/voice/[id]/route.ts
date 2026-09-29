import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { storage } from "@/lib/storage";

/** Stream a voice note's audio (AAC .m4a from the phone). */
export async function GET(_req: Request, ctx: RouteContext<"/api/voice/[id]">) {
  const { id } = await ctx.params;
  const [note] = await db.select().from(schema.voiceNotes).where(eq(schema.voiceNotes.id, id));
  if (!note) return new Response("Not found", { status: 404 });
  const data = await storage.get(note.storagePath);
  return new Response(new Uint8Array(data), { headers: { "Content-Type": "audio/mp4" } });
}
