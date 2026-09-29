import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { logEvent } from "@/lib/events";

/**
 * Runs when the phone reports session_end: reconcile what arrived against what
 * the phone says it captured, then close the session.
 *
 * TODO(step 3): add a Finalizer agent pass over the whole batch to fix
 * document splits/merges (e.g. "Page 2 of 3" markers, sign-off pages) and
 * catch re-shot duplicates, like scan-agent's finalize step.
 */
export async function runSessionFinalizer(batchId: string, jobId: string) {
  const [session] = await db.select().from(schema.captureSessions).where(eq(schema.captureSessions.id, batchId));
  if (!session) throw new Error(`Capture session ${batchId} not found`);

  const accepted = await db
    .select({ id: schema.documents.id, status: schema.documents.status })
    .from(schema.documents)
    .where(and(eq(schema.documents.batchId, batchId), ne(schema.documents.status, "rejected")));
  const pending = accepted.filter((d) => d.status !== "done" && d.status !== "error");
  if (pending.length > 0) {
    // Pages are still being processed; the queue retries this job.
    throw new Error(`${pending.length} pages still processing`);
  }

  const expected = session.expectedPages;
  const received = accepted.length;
  const message =
    expected == null || expected === received
      ? `session finalized: ${received} pages`
      : `session finalized with mismatch: phone reported ${expected} pages, received ${received}`;
  await db.update(schema.captureSessions).set({ status: "finalized" }).where(eq(schema.captureSessions.id, batchId));
  await logEvent({ kind: expected == null || expected === received ? "message" : "error", jobId, batchId, message });
}
