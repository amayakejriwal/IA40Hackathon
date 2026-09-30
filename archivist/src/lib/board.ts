import { and, desc, eq, inArray, isNull, max, type SQL } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { breadcrumb, humanDate } from "@/lib/filing";

/**
 * Everything the operator board shows for one scope: a phone capture session,
 * the web uploads, or all documents. Modeled on field-capture's receiver
 * dashboard (/api/pages), extended with what the agent has done to each page.
 */

export type BoardScope = "all" | "web" | string; // string = capture session (phone batch) id

export type BoardSession = {
  id: string;
  status: "live" | "ended" | "finalized";
  device: string | null;
  startedAt: number | null;
  endedAt: number | null;
  expectedPages: number | null;
};

export type BoardPage = {
  id: string;
  captureId: string | null;
  batchId: string | null;
  pageNumber: number | null;
  filename: string;
  mimeType: string;
  status: string;
  error: string | null;
  title: string | null;
  typeName: string | null;
  confidence: number | null;
  groupId: string | null;
  folderPath: string | null;
  /** Phone-side capture checks, when the page came from the phone. */
  capture: {
    status: string;
    reasons: string[];
    sharpness: number | null;
    glare: number | null;
    width: number | null;
    height: number | null;
  } | null;
  capturedAt: number | null;
  receivedAt: number;
  processedAt: number | null;
};

export type BoardVoiceNote = {
  id: string;
  clipId: string;
  batchId: string;
  tStart: number;
  tEnd: number;
  transcript: string | null;
  kind: string | null;
};

export type BoardGroup = {
  id: string;
  /** Human-readable name, e.g. "Invoice 4471". */
  title: string;
  /** "Jul 27, 2026", from the type's date field. */
  date: string | null;
  /** "Finance › Invoices › Acme Supply Co". */
  breadcrumb: string | null;
  typeName: string | null;
  expectedCount: number | null;
  receivedCount: number;
  status: "incomplete" | "complete";
  pageIds: string[];
  fields: Record<string, unknown>;
  folderPath: string | null;
};

export type Board = {
  scope: BoardScope;
  sessions: BoardSession[];
  session: BoardSession | null;
  webUploads: number;
  pages: BoardPage[];
  voiceNotes: BoardVoiceNote[];
  groups: BoardGroup[];
};

const ms = (d: Date | null | undefined) => (d ? d.getTime() : null);

export async function getBoard(requested?: string | null): Promise<Board> {
  const sessionRows = await db
    .select()
    .from(schema.captureSessions)
    .orderBy(desc(schema.captureSessions.startedAt));
  const sessions: BoardSession[] = sessionRows.map((s) => ({
    id: s.id,
    status: s.status,
    device: s.device,
    startedAt: ms(s.startedAt),
    endedAt: ms(s.endedAt),
    expectedPages: s.expectedPages,
  }));

  const scope: BoardScope = requested || sessions[0]?.id || "all";
  const session = sessions.find((s) => s.id === scope) ?? null;

  const where: SQL | undefined =
    scope === "all" ? undefined : scope === "web" ? isNull(schema.documents.batchId) : eq(schema.documents.batchId, scope);

  const docs = await db
    .select({
      doc: schema.documents,
      typeName: schema.documentTypes.name,
      folderPath: schema.folders.path,
    })
    .from(schema.documents)
    .leftJoin(schema.documentTypes, eq(schema.documentTypes.id, schema.documents.documentTypeId))
    .leftJoin(schema.folders, eq(schema.folders.id, schema.documents.folderId))
    .where(where)
    .orderBy(desc(schema.documents.createdAt))
    .limit(500);

  const ids = docs.map((d) => d.doc.id);
  const doneRows = ids.length
    ? await db
        .select({ documentId: schema.agentEvents.documentId, at: max(schema.agentEvents.createdAt) })
        .from(schema.agentEvents)
        .where(
          and(
            inArray(schema.agentEvents.documentId, ids),
            eq(schema.agentEvents.kind, "status"),
            eq(schema.agentEvents.message, "done"),
          ),
        )
        .groupBy(schema.agentEvents.documentId)
    : [];
  const doneAt = new Map(doneRows.map((r) => [r.documentId, r.at ? new Date(r.at).getTime() : null]));

  const pages: BoardPage[] = docs.map(({ doc, typeName, folderPath }) => {
    const meta = doc.captureMeta as
      | { status?: string; reasons?: string[]; metrics?: { sharpness?: number; glare?: number }; image?: { width?: number; height?: number } }
      | null;
    return {
      id: doc.id,
      captureId: doc.captureId,
      batchId: doc.batchId,
      pageNumber: doc.pageNumber,
      filename: doc.filename,
      mimeType: doc.mimeType,
      status: doc.status,
      error: doc.error,
      title: doc.title,
      typeName: typeName ?? null,
      confidence: doc.confidence,
      groupId: doc.groupId,
      folderPath: folderPath ?? null,
      capture: meta
        ? {
            status: meta.status ?? "accepted",
            reasons: meta.reasons ?? [],
            sharpness: meta.metrics?.sharpness ?? null,
            glare: meta.metrics?.glare ?? null,
            width: meta.image?.width ?? null,
            height: meta.image?.height ?? null,
          }
        : null,
      capturedAt: ms(doc.capturedAt),
      receivedAt: doc.createdAt.getTime(),
      processedAt: doneAt.get(doc.id) ?? null,
    };
  });

  const voiceNotes: BoardVoiceNote[] =
    scope === "web"
      ? []
      : (
          await db
            .select()
            .from(schema.voiceNotes)
            .where(scope === "all" ? undefined : eq(schema.voiceNotes.batchId, scope))
            .orderBy(desc(schema.voiceNotes.tStart))
        ).map((n) => ({
          id: n.id,
          clipId: n.clipId,
          batchId: n.batchId,
          tStart: n.tStart.getTime(),
          tEnd: n.tEnd.getTime(),
          transcript: n.transcript,
          kind: n.kind,
        }));

  const groupIds = [...new Set(pages.map((p) => p.groupId).filter((g): g is string => !!g))];
  const groupRows = groupIds.length
    ? await db
        .select({ group: schema.documentGroups, typeName: schema.documentTypes.name })
        .from(schema.documentGroups)
        .leftJoin(schema.documentTypes, eq(schema.documentTypes.id, schema.documentGroups.documentTypeId))
        .where(inArray(schema.documentGroups.id, groupIds))
    : [];
  // Fields and folder come from the group's pages (each page carries its own extraction).
  const pageById = new Map(pages.map((p) => [p.id, p]));
  const byGroup = new Map<string, { pages: BoardPage[]; fields: Record<string, unknown> }>();
  for (const { doc } of [...docs].reverse()) {
    if (!doc.groupId) continue;
    const entry = byGroup.get(doc.groupId) ?? { pages: [], fields: {} };
    entry.pages.push(pageById.get(doc.id)!);
    for (const [k, v] of Object.entries(doc.extractedFields ?? {})) if (v != null && v !== "" && !(k in entry.fields)) entry.fields[k] = v;
    byGroup.set(doc.groupId, entry);
  }
  const folderPaths = new Map(
    (await db.select({ id: schema.folders.id, path: schema.folders.path }).from(schema.folders)).map((f) => [f.id, f.path]),
  );
  const groups: BoardGroup[] = groupRows.map(({ group, typeName }) => {
    const entry = byGroup.get(group.id);
    return {
      id: group.id,
      title: group.displayName ?? group.title,
      date: humanDate(group.documentDate),
      breadcrumb: group.folderId ? breadcrumb(folderPaths.get(group.folderId)) : null,
      typeName: typeName ?? null,
      expectedCount: group.expectedCount,
      receivedCount: group.receivedCount,
      status: group.status,
      pageIds: entry?.pages.map((p) => p.id) ?? [],
      fields: entry?.fields ?? {},
      folderPath: entry?.pages.find((p) => p.folderPath)?.folderPath ?? null,
    };
  });

  const webUploads = await db.$count(schema.documents, isNull(schema.documents.batchId));

  return { scope, sessions, session, webUploads, pages, voiceNotes, groups };
}
