import { Agent, run } from "@openai/agents";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hasOpenAI, openaiModel } from "@/lib/config";
import { logEvent, setDocumentStatus } from "@/lib/events";
import { ARCHIVIST_INSTRUCTIONS } from "./prompts";
import type { AgentContext } from "./tools/define";
import { ocrDocument, ocrTools } from "./tools/ocr";
import { classifyTools, setDocumentType } from "./tools/classify";
import { listDocumentTypes, typeTools } from "./tools/types";
import { addToGroup, createGroup, findCandidateGroups, groupTools } from "./tools/groups";
import { extractTools, saveFields } from "./tools/extract";
import { fileDocument, folderTools } from "./tools/folders";
import { getDocument, libraryTools } from "./tools/library";
import { captureTools, getCaptureContext } from "./tools/capture";

const AGENT_NAME = "Archivist";

export const archivist = new Agent<AgentContext>({
  name: AGENT_NAME,
  model: openaiModel,
  instructions: ARCHIVIST_INSTRUCTIONS,
  tools: [...ocrTools, ...typeTools, ...classifyTools, ...groupTools, ...extractTools, ...folderTools, ...libraryTools, ...captureTools],
});

/** Process one uploaded document end to end: OCR → classify → group → extract → file. */
export async function runDocumentPipeline(documentId: string, jobId: string) {
  const ctx: AgentContext = { jobId, documentId, agent: AGENT_NAME };

  if (hasOpenAI()) {
    const result = await run(archivist, `Process document id: ${documentId}`, {
      context: ctx,
      maxTurns: 30,
    });
    await logEvent({ kind: "message", jobId, documentId, agent: AGENT_NAME, message: String(result.finalOutput ?? "") });
  } else {
    await runStubPipeline(ctx, documentId);
  }

  // Safety net: a grouped page the agent forgot to file still lands in the library.
  const [page] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
  if (page?.groupId && !page.folderId) await fileDocument.invoke({ documentId }, ctx);

  await setDocumentStatus(documentId, "done", jobId);
}

/**
 * Deterministic pipeline that calls the same tools in order without an LLM.
 * Lets the whole system run end-to-end locally before an API key is set.
 */
async function runStubPipeline(ctx: AgentContext, documentId: string) {
  await logEvent({ kind: "message", ...ctx, message: "OPENAI_API_KEY not set — running stub pipeline" });
  const doc = await getDocument.invoke({ documentId }, ctx);
  await ocrDocument.invoke({ documentId }, ctx);

  const types = await listDocumentTypes.invoke({}, ctx);
  const documentTypeId = types.find((t) => t.name === "other")?.id ?? null;
  if (documentTypeId) {
    await setDocumentType.invoke({ documentId, documentTypeId, confidence: 0, reasoning: "stub pipeline" }, ctx);
  }

  await getCaptureContext.invoke({ documentId }, ctx);
  const [candidate] = await findCandidateGroups.invoke({ documentTypeId, entities: [] }, ctx);
  const group =
    candidate ??
    (await createGroup.invoke(
      { title: `Group for ${doc.filename}`, documentTypeId, groupingKey: null, expectedCount: null },
      ctx,
    ));
  await addToGroup.invoke({ documentId, groupId: group.id }, ctx);

  await saveFields.invoke(
    { documentId, title: doc.filename, summary: "Stub summary", fieldsJson: "{}", confidenceJson: "{}" },
    ctx,
  );

  await fileDocument.invoke({ documentId }, ctx);
}
