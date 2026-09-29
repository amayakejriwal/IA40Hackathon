import path from "node:path";

export const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");
export const openaiModel = process.env.OPENAI_MODEL ?? "gpt-5.5";
export const reorganizeEvery = Number(process.env.REORGANIZE_EVERY ?? 5);

/** Without an API key the pipeline runs deterministic stubs instead of the LLM agent. */
export const hasOpenAI = () => Boolean(process.env.OPENAI_API_KEY);
