import { integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Set in JS (not SQL) for millisecond precision — event ordering depends on it.
const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
};

export const DOCUMENT_STATUSES = [
  "uploaded",
  "ocr",
  "classifying",
  "grouping",
  "extracting",
  "filing",
  "done",
  "error",
  /** Phone flagged the capture as unusable (blurry, cut off, ...); kept but not processed. */
  "rejected",
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** A JSON Schema (object) describing the typed fields for a document type. */
export type FieldSchema = {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required?: string[];
};

export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  parentId: text("parent_id"),
  name: text("name").notNull(),
  /** Materialized path, e.g. "/Finance/Invoices/2026". Recomputed on move/rename. */
  path: text("path").notNull(),
  description: text("description"),
  createdBy: text("created_by", { enum: ["seed", "agent", "user"] })
    .notNull()
    .default("agent"),
  ...timestamps,
});

export const documentTypes = sqliteTable("document_types", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  fieldSchema: text("field_schema", { mode: "json" }).$type<FieldSchema>().notNull(),
  /** How many docs make a "complete" group of this type (e.g. 2 for front/back ID). Null = open-ended. */
  expectedDocsPerGroup: integer("expected_docs_per_group"),
  createdBy: text("created_by", { enum: ["seed", "agent", "user"] })
    .notNull()
    .default("agent"),
  ...timestamps,
});

export const documentGroups = sqliteTable("document_groups", {
  id: text("id").primaryKey(),
  documentTypeId: text("document_type_id"),
  title: text("title").notNull(),
  /** What ties the group together, e.g. "patient:Jane Doe" or "account:1234". */
  groupingKey: text("grouping_key"),
  expectedCount: integer("expected_count"),
  receivedCount: integer("received_count").notNull().default(0),
  status: text("status", { enum: ["incomplete", "complete"] })
    .notNull()
    .default("incomplete"),
  ...timestamps,
});

/**
 * One scanning session from the field-capture iPhone app (its "batch").
 * Web uploads have no capture session.
 */
export const captureSessions = sqliteTable("capture_sessions", {
  id: text("id").primaryKey(), // phone batch id, e.g. "b20260929-001214"
  device: text("device"),
  status: text("status", { enum: ["live", "ended", "finalized"] }).notNull().default("live"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
  /** Accepted page count the phone reported at session_end, used to reconcile. */
  expectedPages: integer("expected_pages"),
  summary: text("summary", { mode: "json" }).$type<Record<string, unknown>>(),
  ...timestamps,
});

/**
 * Raw items received over the phone's upload protocol, one row per
 * (batch, item, kind). Gives the same idempotency as the phone's own receiver:
 * identical re-sends are 200, different bytes for the same key are 409.
 */
export const phoneUploads = sqliteTable(
  "phone_uploads",
  {
    batchId: text("batch_id").notNull(),
    itemId: text("item_id").notNull(),
    kind: text("kind", { enum: ["image", "meta", "ocr", "audio", "event"] }).notNull(),
    sha256: text("sha256").notNull(),
    bytes: integer("bytes").notNull(),
    storagePath: text("storage_path").notNull(),
    receivedAt: timestamps.createdAt,
  },
  (t) => [primaryKey({ columns: [t.batchId, t.itemId, t.kind] })],
);

/** Operator speech captured by the phone mic during a session (context for the agent). */
export const voiceNotes = sqliteTable(
  "voice_notes",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull(),
    /** Phone clip id, e.g. "a0003-1f2e3d"; only unique within a session. */
    clipId: text("clip_id").notNull(),
    tStart: integer("t_start", { mode: "timestamp_ms" }).notNull(),
    tEnd: integer("t_end", { mode: "timestamp_ms" }).notNull(),
    storagePath: text("storage_path").notNull(),
    transcript: text("transcript"),
    /** How the agent interpreted it: context ("box 7, billing"), instruction, correction, chatter. */
    kind: text("kind", { enum: ["context", "instruction", "correction", "chatter"] }),
    ...timestamps,
  },
  (t) => [uniqueIndex("voice_notes_batch_clip").on(t.batchId, t.clipId)],
);

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storagePath: text("storage_path").notNull(),
  source: text("source", { enum: ["web", "mobile"] }).notNull().default("web"),
  status: text("status", { enum: DOCUMENT_STATUSES }).notNull().default("uploaded"),
  title: text("title"),
  summary: text("summary"),
  ocrText: text("ocr_text"),
  documentTypeId: text("document_type_id"),
  groupId: text("group_id"),
  folderId: text("folder_id"),
  extractedFields: text("extracted_fields", { mode: "json" }).$type<Record<string, unknown>>(),
  // Set for pages captured by the phone app.
  batchId: text("batch_id"),
  captureId: text("capture_id"), // phone page id, e.g. "p0003-a1b2c3"
  pageNumber: integer("page_number"),
  capturedAt: integer("captured_at", { mode: "timestamp_ms" }),
  sha256: text("sha256"),
  captureMeta: text("capture_meta", { mode: "json" }).$type<Record<string, unknown>>(),
  confidence: real("confidence"),
  error: text("error"),
  ...timestamps,
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["process", "reorganize", "finalize_session"] }).notNull(),
  documentId: text("document_id"),
  batchId: text("batch_id"),
  status: text("status", { enum: ["pending", "running", "done", "error"] })
    .notNull()
    .default("pending"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  ...timestamps,
});

export const agentEvents = sqliteTable("agent_events", {
  id: text("id").primaryKey(),
  jobId: text("job_id"),
  documentId: text("document_id"),
  batchId: text("batch_id"),
  agent: text("agent"),
  kind: text("kind", { enum: ["tool_call", "tool_result", "status", "message", "error"] }).notNull(),
  toolName: text("tool_name"),
  data: text("data", { mode: "json" }).$type<unknown>(),
  message: text("message"),
  createdAt: timestamps.createdAt,
});

export type Document = typeof documents.$inferSelect;
export type DocumentType = typeof documentTypes.$inferSelect;
export type DocumentGroup = typeof documentGroups.$inferSelect;
export type Folder = typeof folders.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type AgentEvent = typeof agentEvents.$inferSelect;
export type CaptureSession = typeof captureSessions.$inferSelect;
export type VoiceNote = typeof voiceNotes.$inferSelect;
