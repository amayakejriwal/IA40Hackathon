import type { BoardPage } from "@/lib/board";

export const pageLabel = (p: BoardPage) => (p.pageNumber != null ? `Page ${p.pageNumber}` : p.filename);

const WORKING = new Set(["uploaded", "ocr", "classifying", "grouping", "extracting", "filing"]);

/** One word for where a page stands. */
export function pageState(p: BoardPage): { text: string; dot: "ok" | "working" | "bad" | "warn" } {
  if (p.status === "rejected") return { text: "Retake", dot: "warn" };
  if (p.status === "error") return { text: "Failed", dot: "bad" };
  if (WORKING.has(p.status)) return { text: p.status === "uploaded" ? "Queued" : "Processing", dot: "working" };
  return { text: "Filed", dot: "ok" };
}

export const fileUrl = (id: string) => `/api/files/${id}`;
