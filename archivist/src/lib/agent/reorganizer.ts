import { Agent, run } from "@openai/agents";
import { hasOpenAI, openaiModel } from "@/lib/config";
import { logEvent } from "@/lib/events";
import { REORGANIZER_INSTRUCTIONS } from "./prompts";
import type { AgentContext } from "./tools/define";
import { folderTools } from "./tools/folders";
import { libraryTools } from "./tools/library";

const AGENT_NAME = "Librarian";

export const librarian = new Agent<AgentContext>({
  name: AGENT_NAME,
  model: openaiModel,
  instructions: REORGANIZER_INSTRUCTIONS,
  tools: [...folderTools, ...libraryTools],
});

/** Periodically restructure the folder tree as the library grows. */
export async function runReorganizer(jobId: string) {
  const ctx: AgentContext = { jobId, agent: AGENT_NAME };
  if (!hasOpenAI()) {
    await logEvent({ kind: "message", ...ctx, message: "OPENAI_API_KEY not set — skipping reorganization" });
    return;
  }
  const result = await run(librarian, "Review and improve the library's folder structure.", {
    context: ctx,
    maxTurns: 40,
  });
  await logEvent({ kind: "message", ...ctx, message: String(result.finalOutput ?? "") });
}
