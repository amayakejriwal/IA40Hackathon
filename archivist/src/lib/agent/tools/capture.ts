import { and, asc, desc, eq, lt, lte } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { defineTool } from "./define";

const NEIGHBOR_PAGES = 3;
const RECENT_NOTES = 5;

/**
 * Pages from the phone arrive one at a time, in capture order. Grouping them
 * into multi-page documents needs the surrounding pages and whatever the
 * operator said while scanning ("box 7, billing", "that was a duplicate").
 */
export const getCaptureContext = defineTool({
  name: "get_capture_context",
  description:
    "For a page captured by the phone app: its scanning session, page number, the previous few pages (type, group, title, OCR snippet) and recent operator voice notes. Returns null for web uploads.",
  parameters: z.object({ documentId: z.string() }),
  async execute({ documentId }) {
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, documentId));
    if (!doc?.batchId) return null;

    const [session] = await db
      .select()
      .from(schema.captureSessions)
      .where(eq(schema.captureSessions.id, doc.batchId));

    const previousPages = doc.capturedAt
      ? await db
          .select({
            id: schema.documents.id,
            pageNumber: schema.documents.pageNumber,
            status: schema.documents.status,
            title: schema.documents.title,
            documentTypeId: schema.documents.documentTypeId,
            groupId: schema.documents.groupId,
            ocrText: schema.documents.ocrText,
          })
          .from(schema.documents)
          .where(and(eq(schema.documents.batchId, doc.batchId), lt(schema.documents.capturedAt, doc.capturedAt)))
          .orderBy(desc(schema.documents.capturedAt))
          .limit(NEIGHBOR_PAGES)
      : [];

    const voiceNotes = await db
      .select({
        id: schema.voiceNotes.id,
        clipId: schema.voiceNotes.clipId,
        tStart: schema.voiceNotes.tStart,
        transcript: schema.voiceNotes.transcript,
        kind: schema.voiceNotes.kind,
      })
      .from(schema.voiceNotes)
      .where(
        and(
          eq(schema.voiceNotes.batchId, doc.batchId),
          doc.capturedAt ? lte(schema.voiceNotes.tStart, doc.capturedAt) : undefined,
        ),
      )
      .orderBy(desc(schema.voiceNotes.tStart))
      .limit(RECENT_NOTES);

    return {
      session: session && { id: session.id, status: session.status, expectedPages: session.expectedPages },
      pageNumber: doc.pageNumber,
      capturedAt: doc.capturedAt,
      previousPages: previousPages.reverse().map(({ ocrText, ...p }) => ({ ...p, ocrSnippet: ocrText?.slice(0, 300) ?? null })),
      voiceNotes: voiceNotes.reverse(),
    };
  },
});

/** All pages of a capture session in order (used when finalizing a session). */
export const listSessionPages = defineTool({
  name: "list_session_pages",
  description: "List every page of a phone capture session in capture order with status, type, group and title.",
  parameters: z.object({ batchId: z.string() }),
  async execute({ batchId }) {
    return db
      .select({
        id: schema.documents.id,
        pageNumber: schema.documents.pageNumber,
        status: schema.documents.status,
        title: schema.documents.title,
        documentTypeId: schema.documents.documentTypeId,
        groupId: schema.documents.groupId,
      })
      .from(schema.documents)
      .where(eq(schema.documents.batchId, batchId))
      .orderBy(asc(schema.documents.capturedAt));
  },
});

export const captureTools = [getCaptureContext, listSessionPages];
