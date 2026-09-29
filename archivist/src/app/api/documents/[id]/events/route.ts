import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

/** Agent activity for a document (polled by the UI; could become SSE later). */
export async function GET(_req: Request, ctx: RouteContext<"/api/documents/[id]/events">) {
  const { id } = await ctx.params;
  const events = await db
    .select()
    .from(schema.agentEvents)
    .where(eq(schema.agentEvents.documentId, id))
    .orderBy(asc(schema.agentEvents.createdAt));
  return Response.json({ events });
}
