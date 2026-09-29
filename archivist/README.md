# Archivist — AI document digitization

Scanned documents come in from the field-capture iPhone app (`../field-capture/`) or the web upload button. An agent built on the OpenAI Agents SDK processes each one:

**OCR → classify → group with related docs → extract typed fields → file into an AI-organized library**

A second agent (the Librarian) periodically reorganizes the folder tree as the library grows.

Stack: Next.js 16 (App Router) · `@openai/agents` · Drizzle + SQLite (libsql) · local file storage · plain CSS. The storage layer is designed to be swapped for Vercel Blob + Postgres.

## Quick start

```bash
npm install
cp .env.example .env.local   # add OPENAI_API_KEY (optional; see below)
npm run db:setup             # migrate + seed root folder and starter document types
npm run dev
```

Open http://localhost:3000. The UI is deliberately minimal, in an Apple style:

- **Header:** the title, one line of counts, a session picker and Upload. You can also drop files anywhere on the page.
- **Pages:** thumbnails with a one-word status: Queued, Processing, Filed, Retake or Failed.
- **Documents:** a page stack, title and type for each document.
- **Library:** folders with the documents filed in them.
- **Page detail:** the scan, its type, folder and document, and a few key fields. Everything else (all fields, recognized text, word boxes, agent activity, source) sits under **Details**.

**Stub mode:** without `OPENAI_API_KEY`, the pipeline calls the same tools in a fixed order with no LLM calls, so the whole system runs end to end locally.

## Scanning with the iPhone app

```bash
npm run dev:phone   # binds 0.0.0.0:3000 and advertises _fieldscan._tcp over Bonjour
```

On hotel or conference Wi-Fi, which often blocks device-to-device traffic, plug the iPhone in and use the USB cable's link-local network instead:

```bash
npm run dev:usb     # advertises the cable's 169.254.x.x address
```

Clear any host typed into the app first, because a typed host overrides Bonjour.

Open the field-capture app on the same Wi-Fi (or plugged in, for `dev:usb`). It finds the laptop automatically. If it doesn't, long-press the page count and type the `ip:3000` that the script prints. Stop the field-capture receiver and the scan-agent relay first, because they advertise the same service.

The phone speaks its own raw-body protocol, `POST /upload/<batch>/<id>/<kind>` (see `field-capture/README.md`). Archivist implements that protocol in `src/lib/ingest/phone.ts`:

| Phone sends | Archivist does |
|---|---|
| `event` `session_start` | creates a `capture_sessions` row (id = phone batch id) |
| page `meta` + `image` (either order) | creates a `documents` row (batch, page number, capture time, sha256, phone metrics) and queues the Archivist agent. Pages the phone rejected (blurry, cut off, ...) are stored with status `rejected` and not processed |
| audio `meta` + `audio` | creates a `voice_notes` row (transcription is a TODO) |
| `ocr` | stored only |
| `event` `session_end` | records the phone's page count and queues `finalize_session`, which reconciles received pages against expected |

Re-sending identical bytes returns 200. Sending different bytes for the same id and kind returns 409, the same as the phone's own receiver. The phone retries anything that isn't a 200.

For phone pages, the agent's `get_capture_context` tool returns the previous pages and recent voice notes. That lets it continue a multi-page document across consecutive captures.

## API (web UI; `POST /api/documents` also works for other clients)

| Method | Path | |
|---|---|---|
| `POST` | `/api/documents` | multipart `file` (repeatable), optional `source=mobile` |
| `GET` | `/api/documents` | recent documents with status |
| `GET` | `/api/documents/:id` | document + type, group, folder |
| `POST` | `/api/documents/:id` | reprocess |
| `GET` | `/api/documents/:id/events` | agent activity timeline |
| `GET` | `/api/folders` | library tree with filed documents |
| `GET` | `/api/files/:id` | original file |
| `POST` | `/upload/:batch/:id/:kind` | field-capture phone protocol (above) |
| `GET` | `/ping` | liveness check |
| `GET` | `/api/board?scope=` | operator board data (`all`, `web`, or a session id) |
| `GET` | `/api/documents/:id/ocr` | word-level OCR for the box overlay |
| `GET` | `/api/voice/:id` | voice note audio |

```bash
curl -F file=@scan.jpg -F source=mobile localhost:3000/api/documents
```

## Layout

```
src/lib/
  db/schema.ts          documents, document_types (dynamic JSON-schema models), document_groups,
                        folders (materialized paths), capture_sessions, phone_uploads,
                        voice_notes, jobs, agent_events
  storage/              FileStorage interface (LocalFileStorage today)
  ingest/phone.ts       field-capture upload protocol -> capture sessions, page documents, voice notes
  jobs/queue.ts         DB-backed job queue + in-process worker (kicked via after() on upload)
  agent/
    orchestrator.ts     Archivist agent + runDocumentPipeline (+ stub pipeline)
    reorganizer.ts      Librarian agent (runs every REORGANIZE_EVERY processed docs)
    finalizer.ts        end-of-session reconciliation for phone batches
    prompts.ts
    tools/              defineTool() wrapper logs every call to agent_events
      ocr · types · classify · groups · extract · folders · library · capture
  board.ts              one query behind the operator board
src/components/board/   operator board (captures, documents, library, page detail)
src/app/                page + API routes (styles in globals.css, ported from field-capture)
```

## Roadmap

1. (done) Scaffolding: data model, upload API, queue, agents, and all tools. Stubs for OCR, classify, and extract; the other tools do real DB work.
2. OCR + classification with OpenAI vision, including creating new document types.
3. Grouping: entity-aware matching and expected counts.
4. Field extraction against each type's schema (structured outputs).
5. Filing + Librarian reorganization.
6. UI polish.
7. Voice-note transcription, reusing ideas that proved out in `../scan-agent`: Apple Vision OCR, dHash duplicate detection, blank-page checks, and end-of-session split/merge review. Then Vercel Blob/Postgres and a Vercel deploy.
