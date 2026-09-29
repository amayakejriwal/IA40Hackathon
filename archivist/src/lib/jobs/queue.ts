import { and, asc, count, eq } from "drizzle-orm";
import { db, newId, schema } from "@/lib/db";
import type { Job } from "@/lib/db/schema";
import { reorganizeEvery } from "@/lib/config";
import { logEvent } from "@/lib/events";
import { runDocumentPipeline } from "@/lib/agent/orchestrator";
import { runReorganizer } from "@/lib/agent/reorganizer";
import { runSessionFinalizer } from "@/lib/agent/finalizer";

const MAX_ATTEMPTS = 2;

/**
 * Minimal DB-backed job queue with an in-process worker. Good enough for a
 * single local server; swap for Vercel Queues / Workflow when deploying.
 */
export async function enqueueJob(kind: Job["kind"], target: { documentId?: string; batchId?: string } = {}) {
  const id = newId();
  await db.insert(schema.jobs).values({ id, kind, ...target });
  return id;
}

const worker = globalThis as unknown as { __workerRunning?: boolean; __workerBooted?: boolean };

/** Start draining the queue if a worker isn't already running. Safe to call often. */
export async function kickWorker() {
  if (worker.__workerRunning) return;
  worker.__workerRunning = true;
  try {
    if (!worker.__workerBooted) {
      // Jobs left "running" by a previous server process never finished; retry them.
      await db.update(schema.jobs).set({ status: "pending" }).where(eq(schema.jobs.status, "running"));
      worker.__workerBooted = true;
    }
    let job: Job | undefined;
    while ((job = await claimNextJob())) {
      await runJob(job);
    }
  } finally {
    worker.__workerRunning = false;
  }
}

async function claimNextJob(): Promise<Job | undefined> {
  const [next] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.status, "pending"))
    .orderBy(asc(schema.jobs.createdAt))
    .limit(1);
  if (!next) return undefined;
  const claimed = await db
    .update(schema.jobs)
    .set({ status: "running", attempts: next.attempts + 1 })
    .where(and(eq(schema.jobs.id, next.id), eq(schema.jobs.status, "pending")))
    .returning();
  return claimed[0] ?? claimNextJob();
}

async function runJob(job: Job) {
  try {
    if (job.kind === "process" && job.documentId) {
      await runDocumentPipeline(job.documentId, job.id);
      await maybeEnqueueReorganize();
    } else if (job.kind === "reorganize") {
      await runReorganizer(job.id);
    } else if (job.kind === "finalize_session" && job.batchId) {
      await runSessionFinalizer(job.batchId, job.id);
    }
    await db.update(schema.jobs).set({ status: "done" }).where(eq(schema.jobs.id, job.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retry = job.attempts < MAX_ATTEMPTS;
    await db
      .update(schema.jobs)
      .set({ status: retry ? "pending" : "error", lastError: message })
      .where(eq(schema.jobs.id, job.id));
    await logEvent({ kind: "error", jobId: job.id, documentId: job.documentId, batchId: job.batchId, message });
    if (!retry && job.documentId) {
      await db
        .update(schema.documents)
        .set({ status: "error", error: message })
        .where(eq(schema.documents.id, job.documentId));
    }
  }
}

async function maybeEnqueueReorganize() {
  if (reorganizeEvery <= 0) return;
  const [{ n }] = await db
    .select({ n: count() })
    .from(schema.documents)
    .where(eq(schema.documents.status, "done"));
  if (n > 0 && n % reorganizeEvery === 0) await enqueueJob("reorganize");
}
