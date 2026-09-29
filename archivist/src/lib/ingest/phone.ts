import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, newId, schema } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { enqueueJob } from "@/lib/jobs/queue";
import { storage } from "@/lib/storage";

/**
 * Receives the field-capture iPhone app's upload protocol
 * (see field-capture/README.md, "Phone -> laptop contract"):
 *
 *   POST /upload/<batch>/<id>/<kind>   raw body, kind in image|meta|ocr|audio|event
 *
 * Each page arrives as `meta` then `image`; each voice clip as `meta` then
 * `audio`; the session is bracketed by `event` items with id `session_start` /
 * `session_end`. Items are stored as received, and once a page or clip has both
 * halves it is turned into a document (queued for the agent) or a voice note.
 */

export const PHONE_KINDS = ["image", "meta", "ocr", "audio", "event"] as const;
export type PhoneKind = (typeof PHONE_KINDS)[number];

const EXT: Record<PhoneKind, string> = {
  image: "jpg",
  meta: "meta.json",
  ocr: "ocr.json",
  audio: "m4a",
  event: "event.json",
};

export const SAFE_ID = /^[A-Za-z0-9_.-]{1,80}$/;

type PageMeta = {
  type: "page";
  id: string;
  batch: string;
  number: number;
  status: "accepted" | "rejected" | "processing";
  reasons?: string[];
  image?: { sha256?: string };
  timing?: { captured_at?: number };
  device?: string;
};

type AudioMeta = { type: "audio"; id: string; batch: string; t_start: number; t_end: number };

type SessionEvent = {
  type: "session_start" | "session_end";
  batch: string;
  t: number;
  device?: string;
  page_count?: number;
  captures?: number;
  rejected?: number;
  audio_clips?: number;
};

export type ReceiveResult = { status: 200 | 409; sha256: string };

export async function receivePhoneItem(
  batchId: string,
  itemId: string,
  kind: PhoneKind,
  body: Buffer,
): Promise<ReceiveResult> {
  const sha256 = createHash("sha256").update(body).digest("hex");

  const [existing] = await db
    .select()
    .from(schema.phoneUploads)
    .where(
      and(
        eq(schema.phoneUploads.batchId, batchId),
        eq(schema.phoneUploads.itemId, itemId),
        eq(schema.phoneUploads.kind, kind),
      ),
    );
  // The phone retries until it gets a 200, so identical re-sends must succeed.
  if (existing) return { status: existing.sha256 === sha256 ? 200 : 409, sha256 };

  const storagePath = await storage.put(`phone/${batchId}/${itemId}.${EXT[kind]}`, body, "");
  await db
    .insert(schema.phoneUploads)
    .values({ batchId, itemId, kind, sha256, bytes: body.length, storagePath })
    .onConflictDoNothing();

  if (kind === "event") await handleSessionEvent(batchId, JSON.parse(body.toString("utf8")) as SessionEvent);
  else if (kind !== "ocr") await assembleItem(batchId, itemId);
  // Phone-side OCR (optional) is stored only; our own OCR tool is the source of truth.

  return { status: 200, sha256 };
}

async function ensureSession(batchId: string, device?: string) {
  await db
    .insert(schema.captureSessions)
    .values({ id: batchId, device, startedAt: new Date() })
    .onConflictDoNothing();
}

async function handleSessionEvent(batchId: string, event: SessionEvent) {
  const at = new Date(event.t * 1000);
  if (event.type === "session_start") {
    await db
      .insert(schema.captureSessions)
      .values({ id: batchId, device: event.device, startedAt: at, status: "live" })
      .onConflictDoUpdate({ target: schema.captureSessions.id, set: { startedAt: at, device: event.device } });
    await logEvent({ kind: "message", batchId, message: `capture session started (${event.device ?? "phone"})` });
  } else if (event.type === "session_end") {
    await ensureSession(batchId, event.device);
    const summary = { page_count: event.page_count, captures: event.captures, rejected: event.rejected, audio_clips: event.audio_clips };
    await db
      .update(schema.captureSessions)
      .set({ status: "ended", endedAt: at, expectedPages: event.page_count ?? null, summary })
      .where(eq(schema.captureSessions.id, batchId));
    await logEvent({ kind: "message", batchId, message: `capture session ended: ${event.page_count ?? "?"} pages` });
    await enqueueJob("finalize_session", { batchId });
  }
}

/** Once both the meta and the media for an item have arrived, materialize it. */
async function assembleItem(batchId: string, itemId: string) {
  const parts = await db
    .select()
    .from(schema.phoneUploads)
    .where(and(eq(schema.phoneUploads.batchId, batchId), eq(schema.phoneUploads.itemId, itemId)));
  const meta = parts.find((p) => p.kind === "meta");
  const media = parts.find((p) => p.kind === "image" || p.kind === "audio");
  if (!meta || !media) return;

  const metaJson = JSON.parse((await storage.get(meta.storagePath)).toString("utf8")) as PageMeta | AudioMeta;
  if (metaJson.type === "page" && media.kind === "image") await createPageDocument(batchId, itemId, metaJson, media);
  if (metaJson.type === "audio" && media.kind === "audio") await createVoiceNote(batchId, itemId, metaJson, media.storagePath);
}

async function createPageDocument(
  batchId: string,
  itemId: string,
  meta: PageMeta,
  image: typeof schema.phoneUploads.$inferSelect,
) {
  const [already] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(and(eq(schema.documents.batchId, batchId), eq(schema.documents.captureId, itemId)));
  if (already) return;

  await ensureSession(batchId, meta.device);
  const rejected = meta.status === "rejected";
  const id = newId();
  await db.insert(schema.documents).values({
    id,
    filename: `Page ${meta.number}`,
    mimeType: "image/jpeg",
    sizeBytes: image.bytes,
    storagePath: image.storagePath,
    source: "mobile",
    status: rejected ? "rejected" : "uploaded",
    error: rejected ? `rejected on phone: ${(meta.reasons ?? []).join(", ")}` : null,
    batchId,
    captureId: itemId,
    pageNumber: meta.number,
    capturedAt: meta.timing?.captured_at ? new Date(meta.timing.captured_at * 1000) : null,
    sha256: image.sha256,
    captureMeta: meta as unknown as Record<string, unknown>,
  });

  if (meta.image?.sha256 && meta.image.sha256 !== image.sha256) {
    await logEvent({ kind: "error", documentId: id, batchId, message: "image sha256 does not match phone meta" });
  }
  if (!rejected) await enqueueJob("process", { documentId: id });
}

async function createVoiceNote(batchId: string, itemId: string, meta: AudioMeta, storagePath: string) {
  await ensureSession(batchId);
  await db
    .insert(schema.voiceNotes)
    .values({
      id: newId(),
      batchId,
      clipId: itemId,
      tStart: new Date(meta.t_start * 1000),
      tEnd: new Date(meta.t_end * 1000),
      storagePath,
    })
    .onConflictDoNothing();
  // TODO(step 2+): transcribe (OpenAI speech-to-text) so the agent can use spoken
  // context like "box 7, billing folder" or "that last page was a duplicate".
  await logEvent({ kind: "message", batchId, message: `voice note ${itemId} received` });
}
