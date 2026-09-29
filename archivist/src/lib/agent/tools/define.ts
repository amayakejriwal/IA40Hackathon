import { tool, type RunContext } from "@openai/agents";
import type { z } from "zod";
import { logEvent, setDocumentStatus } from "@/lib/events";
import type { DocumentStatus } from "@/lib/db/schema";

/** Per-run context passed to every tool via `run(agent, input, { context })`. */
export type AgentContext = {
  jobId: string;
  agent: string;
  documentId?: string;
};

type ToolDef<P extends z.ZodObject, R> = {
  name: string;
  description: string;
  parameters: P;
  /** If set, the document's status moves to this step when the tool is called. */
  step?: DocumentStatus;
  execute: (input: z.infer<P>, ctx: AgentContext) => Promise<R>;
};

/**
 * Wraps an Agents SDK function tool so every call is logged to `agent_events`
 * (drives the UI activity feed) and can also be invoked directly — which the
 * stub pipeline uses when no OpenAI key is configured.
 */
export function defineTool<P extends z.ZodObject, R>(def: ToolDef<P, R>) {
  const invoke = async (input: z.infer<P>, ctx: AgentContext): Promise<R> => {
    const documentId = ctx.documentId ?? null;
    if (def.step && ctx.documentId) await setDocumentStatus(ctx.documentId, def.step, ctx.jobId);
    await logEvent({ kind: "tool_call", jobId: ctx.jobId, documentId, agent: ctx.agent, toolName: def.name, data: input });
    const result = await def.execute(input, ctx);
    await logEvent({ kind: "tool_result", jobId: ctx.jobId, documentId, agent: ctx.agent, toolName: def.name, data: result });
    return result;
  };

  const sdkTool = tool<z.ZodObject, AgentContext>({
    name: def.name,
    description: def.description,
    parameters: def.parameters as z.ZodObject,
    execute: async (input, runContext?: RunContext<AgentContext>) => {
      if (!runContext) throw new Error(`${def.name}: missing run context`);
      const result = await invoke(input as z.infer<P>, runContext.context);
      return JSON.stringify(result ?? null);
    },
  });

  return Object.assign(sdkTool, { invoke });
}
