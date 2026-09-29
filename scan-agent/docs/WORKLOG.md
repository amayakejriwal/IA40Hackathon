# Scan agent: work log

What was built for the hackathon, why it looks the way it does, how well it works, and what
is still open. Written 2026-09-29. For run instructions see the [README](../README.md).

## 1. The goal

A conventional digitization bureau scans boxes of paper and then spends most of its money
after the scan, on prep, QC, separating documents, OCR, classification, indexing (keying
fields), validation, packaging, and loading into the customer's document system.

The hackathon idea is to replace that back office with an agent:

- **Phone:** the operator presses Start, feeds pages under the camera, talks while working,
  and presses Stop. Nothing else.
- **Laptop:** an autonomous Codex agent receives the stream of pages and audio in real time
  and does everything a bureau's back office does. It finishes shortly after Stop.

### Decisions made along the way

| Question | Decision | Why |
|---|---|---|
| Index spec up front? | No. Extract everything, infer the data model, finalize at the end | Schema-on-read. The agent proposes the model; a human approves it |
| Hierarchy (box/folder) | Operator speaks it ("box 7, police reports") | Replaces the separator sheets a bureau inserts during prep |
| Voice: realtime voice API or plain transcription? | Plain transcription, no voice replies | The agent only needs timestamped text |
| Where transcription runs | Laptop (whisper.cpp), from audio clips the phone uploads | The phone stays a simple sensor, and the laptop is faster |
| Clock | Phone timestamps (`t` = seconds since Start) on every page and clip | One clock, so ordering is exact even if uploads arrive out of order |
| Controls | Start and Stop only | Everything else is inferred from pages and speech |
| Orchestration | **No orchestrating agent.** A dumb relay passes events into one Codex thread | The Codex agent is the only decision-maker |
| Model | `gpt-6-sol`, low effort live and medium effort at finalization | Measured, see §6 |

## 2. Architecture

```
FieldCapture iOS app ──HTTP──▶ relay/server.mjs (no model) ──turn/start · turn/steer──▶ codex app-server
  pages (JPEG + metrics)          · stores masters + sha256                                one thread per session
  audio clips (m4a)               · OCR, blank, dup distance, Whisper                      cwd = sessions/<sid>/
                                  · watchdog for hung turns                                reads AGENTS.md
                                  · SSE feed ──▶ dashboard ◀── ledger.json ◀── bin/ledger, bin/file, bin/finalize
```

**How the relay talks to Codex.** The relay spawns `codex app-server` and speaks its
JSON-RPC protocol over stdio (`relay/codex.mjs`).
- Each session is a `thread/start` with `cwd` set to the session folder, sandbox
  `workspace-write`, and approvals off.
- Each event goes into the running turn with `turn/steer` if the agent is busy, or wakes it
  with `turn/start` if it is idle. Deliveries are serialized per session.
- Pages go in as `localImage` inputs, so the model sees every page natively.
- Every MCP server in the user's config is disabled for these threads, along with the
  turn-ended notifier and the `sleep_tool` feature (see §5).

### Directory map

| Path | What it is |
|---|---|
| `relay/server.mjs` | HTTP API for the phone, preprocessing, delivery to Codex, safety nets, SSE, static files |
| `relay/codex.mjs` | Minimal app-server client (spawn, JSON-RPC, notifications) |
| `relay/dashboard.html` | Three-pane live view: capture, agent activity, archive/data model/entities |
| `agent/AGENTS.md` | The agent's job description (copied into each session) |
| `agent/AGENTS.native.md` | Stripped-down brief for the native-capabilities comparison |
| `agent/bin/` | The agent's tools (§3) |
| `sim/` | Phone stand-ins, answer keys, scoring and benchmarks (§4) |
| `corpus/` | 50 hand-scanned FOIA/police PDFs, 235 page images (git-ignored, real PII) |
| `sessions/<sid>/` | One folder per scan session (git-ignored) |
| `.venv/` | Python env with pyobjc for Apple Vision OCR (git-ignored) |

### Phone API

| Call | Body | Notes |
|---|---|---|
| `POST /sessions` | optional `{"note": "..."}` | Start. Returns `{session, thread}` |
| `POST /sessions/:sid/pages?t=&id=&meta=` | JPEG | `meta` = URL-encoded phone metrics (status, reasons, sharpness, glare, ink, quad) |
| `POST /sessions/:sid/audio?t=&t_end=&id=&ext=m4a` | audio | One clip per utterance |
| `POST /sessions/:sid/end` | | Stop |
| `GET /sessions`, `/sessions/:sid/ledger`, `/sessions/:sid/log`, `/events`, `/files/...`, `/` | | Dashboard support |

The FieldCapture app (`bluedoor-ai/document-digitization/field-capture`) currently posts to
its own Python receiver. `sim/import_batch.mjs` replays those receiver batches into the relay
with their original timing. Pointing the app at the relay directly, or adding a forwarder to
the receiver, has not been done yet.

### Session folder

| File | Contents |
|---|---|
| `capture/` | Immutable masters, `events.jsonl` (every arrival with sha256), phone metrics |
| `work/` | OCR (`.txt`, `.tsv`, `.vision.json`, per-page searchable `.pdf`), transcripts, temp files |
| `ledger.json` | The live system of record (pages, notes, documents, folders, entities, schema, status) |
| `ledger.log.jsonl` | Every ledger change with its human-readable message, which feeds the activity pane |
| `activity.jsonl` | Everything the relay broadcast, so a reloaded dashboard can rebuild its feed |
| `archive/Box n/<Folder>/*.pdf` + `.json` | Searchable PDF per document plus a sidecar with its index data |
| `index.csv` | Load file: one row per document with every schema field |
| `schema.json` | Inferred data model |
| `review.json` | Exception queue (low confidence, conflicts, missing pages, quality) |
| `manifest.json` | sha256 of every master and output, plus page reconciliation |
| `run.json` | Model, effort and mode used |

## 3. The agent

### Responsibilities (`agent/AGENTS.md`)

- **Page accounting and quality:** duplicate, blank, retake, and quality flags.
- **Unitization:** which pages form one document. Cues are page markers, letterhead, dates,
  reference numbers, and sign-offs ("a letter has exactly one sign-off").
- **Classification** into reusable snake_case types.
- **Indexing:** 4–8 searchable fields per document, each with a confidence. Anything under
  0.8 goes to review.
- **Entity resolution** ("SMITH, JOHN" = "John Smith" = "J. Smith").
- **Schema inference,** which grows live and is normalized at the end.
- **Audio:** classified as context, instruction, correction or chatter, then acted on.
  "That was" refers to the last page. Specific instructions override inference; vague ones
  only name the organization.
- **Filing** into `Box n/<Folder>`. Folders come from speech, or are inferred from content,
  never "Unknown".
- **Finalization at Stop:** a whole-session review pass (`bin/review`), reconciliation,
  schema normalization, then `bin/finalize`.

### Tools (`agent/bin/`)

| Tool | Purpose | Who runs it |
|---|---|---|
| `intake <id>` | Ink coverage, near-duplicate distances to the last 4 pages, OCR text | Relay, before delivery; its output is included in the page message |
| `ocr <img> <base>` | Apple Vision text (`vision_ocr.py` via pyobjc), Tesseract searchable-PDF layer, sparse-mode fallback | `intake`, `file` |
| `transcribe <clip> <out>` | ffmpeg to 16 kHz WAV, then whisper.cpp; CPU fallback inside the sandbox | Relay |
| `ledger` | RFC 7396 merge patch on `ledger.json` from a quoted heredoc, plus feed messages. Refuses `status: done` until `manifest.json` exists | Agent: its only way to change state |
| `file <doc>...` | Joins page PDFs into the document PDF at its ledger path, writes the sidecar, removes stale copies, marks it `filed` | Agent |
| `finalize` | Files everything, writes `schema.json`, `index.csv`, `review.json`, `manifest.json`, prints reconciliation | Agent at Stop |
| `review` | Whole-session view: each page's top and bottom lines, sign-off and page-number cues, duplicate distances, notes in order, and per-document "ends with sign-off" | Agent at Stop |
| `similar`, `blank` | Perceptual-hash distance and ink coverage | `intake`, `review` |

The dividing line: the model makes every judgment call, including what a page is, where
documents split, and what a spoken sentence means. The tools cover three things. First,
what the model can't do: it has no audio input, and it can't produce checksums or exact PDF
text layers. Second, what it did slowly or unreliably when doing it natively: writing files
and final outputs. Third, cheap text for it to reason over.

### Relay safety nets

- **Unhandled-event check:** when a turn ends, every page and clip must be in the ledger.
  If not, the agent is nudged (max 3).
- **Start notice:** `SESSION START` travels with the first real event, not in its own
  turn. This fixed a race where the first page was steered into a turn that was already
  ending.
- **Finalization in its own turn:** Stop is held until the agent is idle (max 60 s), then
  sent as a new turn at `SCAN_FINAL_EFFORT` (medium).
- **Watchdog:** a turn with no events for `SCAN_STALL_MS` (90 s) is interrupted with
  `turn/interrupt` and resumed from the ledger.
- **Non-fatal logging:** a full disk no longer crashes the relay.

## 4. Test data and evaluation

### Data

- **`corpus/`:** 50 real hand-scanned PDFs, 235 pages, found by scanning about 15k local PDFs
  for image-only files (records-requests FOIA attachments, bodycam agency releases and
  others). The Records V2 R2 store was not touched. The corpus contains real personal data:
  keep it local.
- **Scripted scenarios:** `sim/scenarios/demo.json` has 15 corpus pages and 6 spoken lines
  (spoken with macOS `say`), including a duplicate, an invoice to refile, a missing-pages
  flag, and a folder correction. `smoke.json` uses synthetic pages.
- **Real phone batches:** 12 FieldCapture sessions in the receiver's `data/`. Nine have
  answer keys (91 pages, 37 voice clips, 45 documents). They are mostly the same stack of
  PLCB, Byron Center, Pope Flynn and City of Holland records, re-shot with shuffles,
  reshoots and back-side shots.

### Answer keys (`sim/truth/*.json`)

`b…000427` was checked by hand. The other 8 were written by three helper agents from the page
images and Vision OCR. They record documents in reading order, duplicates (mapped to the
earliest capture), blanks, confidence, and uncertain calls. All nine are marked high
confidence. The one recurring ambiguity is whether the Byron Center 3-page fee form is its
own document or an enclosure of the Aug 12 letter. The keys treat it as separate.

### Scoring (`sim/score.py`)

- **Physical-sheet level:** a sheet photographed twice counts once, whichever capture the
  agent kept, since keeping the sharper reshoot is correct behavior.
- **Metrics:** exact documents (same set of sheets), pairwise precision and recall, duplicates
  caught (exactly one capture kept), blanks caught (any exclusion status), false duplicates,
  and pages missing from the ledger.
- **Latency** (`sim/lag.py`): arrival until first ledger mention per event, and finish time
  after Stop.

### Commands

```sh
sim/eval.sh <batch-dir | scenario.json>      # one session end to end, then score
sim/bench.sh <port> <batch-dir>...           # many sessions through one relay → sim/bench-<port>.jsonl
python3 sim/bench_report.py [files]          # per-batch and total table per model
```

## 5. What we tried, what broke, what fixed it

In chronological order, with the measured effect.

| # | Change | Problem it addressed | Effect |
|---|---|---|---|
| 1 | Codex app-server with `turn/steer` | Real-time input into a running agent | Proven in a smoke test: an instruction steered mid-turn was carried out |
| 2 | Whisper temp files in the session folder, CPU fallback | Sandbox blocks the system temp folder and Metal, so every transcript was empty | Transcripts work inside the sandbox (about 3 s per clip) |
| 3 | First real run (15 corpus pages, 6 clips), medium effort | Baseline | All 6 voice instructions applied correctly. Finished 280 s after Stop, one PDF missing |
| 4 | Relay pre-runs intake and transcription; one call per event | Two model round trips per page | Only 7 commands, but huge batched writes. Finished 210 s after Stop |
| 5 | Deterministic `bin/file` and `bin/finalize`; per-page PDFs made at intake | PDFs missing, and slow hand-written finalize code | Filing always complete, finalize takes seconds |
| 6 | Heredoc JSON for `ledger`; lean-patch guidance; `done` guard; low effort | Shell quoting ate "$4.61" and killed a write; finalize skipped; slow output | Finished **35 s after Stop**, all deliverables present |
| 7 | Finalization in its own medium-effort turn | Low effort skipped schema normalization | Better finalization |
| 8 | `sleep_tool` disabled; finalize wait capped at 60 s | The agent called `clock.sleep` for 12 h to "wait for session end", a deadlock | No more sleeps |
| 9 | Blank-page rule: visibly empty *and* no OCR words | A faint carbon page was marked blank on ink % alone | Faint pages kept as `quality: faint` |
| 10 | Dashboard hides raw `bin/ledger` commands | The feed was cluttered with escaped JSON | Clean feed |
| 11 | `import_batch.mjs` plus phone metrics passthrough | Needed to test on real phone sessions | First real batch (9 pages): 3/5 documents |
| 12 | Narration guidance, sign-off rule, folder inference, start-notice fix | "That was the first page of…" classed as chatter; "Box unknown/Unknown"; startup race | Narration counts as context; folders named by agency |
| 13 | Answer key and scorer for that batch | No objective measure | Scores: 2/5 → 3/5 across tries |
| 14 | `bin/review` whole-session pass; sign-off, vague-instruction and duplicate rules | Page-by-page decisions were myopic | 4/5 |
| 15 | **Apple Vision OCR** via pyobjc | Tesseract returned 0 words on sign-off pages and missed "Sincerely" | **5/5** on the batch |
| 16 | Native-mode comparison (`SCAN_MODE=native`) | "Shouldn't Codex use its native capabilities?" | Native: 2/5, generic types, only 3 state updates during a scan. Tools kept |
| 17 | 9-batch Luna vs Sol benchmark | Model choice | Sol 41/45 vs Luna 37/45, final numbers in §6 |
| 18 | Physical-sheet scoring | Kept reshoots were counted as errors | Fairer comparison |
| 19 | Cap of 3 events per ledger write | Sol saved up 14 pages for one write, finishing 633 s after Stop | Steadier progress |
| 20 | Stall watchdog (`turn/interrupt` and resume) | Sol streams hung mid-turn for 20+ minutes (service side, not quota) | Every session finishes |

Other environment issues:
- **Xcode license:** not accepted, which blocks `swiftc`. Worked around with pyobjc for
  Vision.
- **Disk space:** the data volume is at 98%, and one relay crash came from a full disk.
- **Leftover sessions:** 60+ session folders in `sessions/`, which are safe to delete.

## 6. Current results

Nine real phone batches (91 pages, 45 true documents). Both models used the same settings:
low effort live, medium at finalization, capped writes, watchdog on.

| Model | Documents exact | Pair precision / recall | Median lag while scanning | Median finish after Stop | Stalls recovered |
|---|---|---|---|---|---|
| **gpt-6-sol** (default) | **41/45 (91%)** | 0.89 / **1.00** | 45 s | 115 s | 6 |
| gpt-6-luna | 37/45 (82%) | 0.87 / 0.91 | 42 s | 118 s | 1 |

- **Sol's 4 misses** are all the fee form merged into the Aug 12 letter, in two batches. If
  enclosures should stay with their cover letter, Sol got every batch right.
- **Luna's misses** are real errors: letters shot page 2 first were split, unrelated pages
  were merged, and some reshoots were missed.
- **Outliers:** stalls produced some sessions that finished 5–18 minutes after Stop, in
  both models.
- **Earlier scripted demo** (15 corpus pages, Luna): finished 35–90 s after Stop with all
  instructions applied.

Raw data: `sim/bench-8787.jsonl` (Luna) and `sim/bench-8788.jsonl` (Sol). Earlier runs are
in `sim/bench-archive/`.

## 7. Open items

1. **Enclosure policy** (needs a decision): is an enclosure part of its cover letter or its
   own document? Encode the answer in `AGENTS.md` and the answer keys.
2. **Stall recovery for the demo:** lower `SCAN_STALL_MS` to about 45 s, or keep Luna ready
   as a fallback.
3. **Live phone link:** point FieldCapture at the relay, or forward from its receiver.
   Today batches are replayed afterwards.
4. **Answer keys** for the three new batches (`…004131`, `…010157`, `…010654`), and a spot
   check of the helper-written keys.
5. **Drop the hand-coded sign-off hints** in `bin/review` now that OCR is good, and measure
   with the benchmark whether Sol still gets them right.
6. **Disk space and cleanup** of `sessions/`.
7. **Not built:** redaction and sensitive-data flagging, validation against reference data
   (for example parcel or case lookups), and loading into a target document system.
