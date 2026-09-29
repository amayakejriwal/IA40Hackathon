import { eq } from "drizzle-orm";
import { db, newId, schema } from "@/lib/db";
import type { AgentEvent, DocumentStatus } from "@/lib/db/schema";

type NewEvent = Omit<AgentEvent, "id" | "createdAt">;

export async function logEvent(event: Partial<NewEvent> & Pick<NewEvent, "kind">) {
  await db.insert(schema.agentEvents).values({ id: newId(), ...event });
}

export async function setDocumentStatus(
  documentId: string,
  status: DocumentStatus,
  jobId?: string | null,
) {
  await db.update(schema.documents).set({ status }).where(eq(schema.documents.id, documentId));
  await logEvent({ kind: "status", documentId, jobId, message: status });
}
