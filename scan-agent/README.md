# Scan agent

The phone captures pages and audio. A Codex agent on the laptop turns that stream into an
organized, searchable archive while the operator is still scanning.

**Full write-up:** [docs/WORKLOG.md](docs/WORKLOG.md) covers the decisions, architecture,
every experiment, and the benchmark results (Sol 41/45 documents exact on 9 real phone batches).

```
phone ──HTTP──▶ relay (no model) ──turn/start · turn/steer──▶ Codex agent (codex app-server)
                  │ saves masters, sha256                       │ AGENTS.md = its job
                  │ runs OCR / blank / dup check / Whisper      │ bin/ledger = its state
                  └──SSE──▶ dashboard  ◀──ledger.json───────────┘ bin/file, bin/finalize = its outputs
```

- **relay/**: plain HTTP server. It stores each upload, runs the mechanical checks, and hands
  each event to the session's Codex thread. If the agent is mid-turn, the event is steered
  into that turn; otherwise a new turn wakes it. It makes no decisions.
- **agent/AGENTS.md**: everything the agent is responsible for: dedupe, blank pages,
  unitization, classification, indexing, entity resolution, schema inference, voice
  instructions and corrections, filing, and finalization.
- **agent/bin/**: the agent's tools (`ledger`, `file`, `finalize`, `review`, `intake`,
  `ocr` with Apple Vision, `transcribe`, `similar`, `blank`).
- **sim/**: stands in for the phone. `replay.mjs` plays a scripted session (corpus pages plus
  spoken lines through `say`). `import_batch.mjs` replays a real FieldCapture receiver batch
  with its original timing. `eval.sh` runs a session end to end and scores it against
  `sim/truth/*.json` (`score.py`: exact documents, pairwise grouping, duplicates) and for
  latency (`lag.py`).
- **corpus/**: 50 real hand-scanned FOIA and police PDFs, 235 page images. Contains real
  personal information: local only, and git-ignored.

## Run

```sh
python3 -m venv .venv && .venv/bin/pip install pyobjc-framework-Vision pyobjc-framework-Quartz  # Apple Vision OCR
node relay/server.mjs                             # http://localhost:8787 (dashboard)
sim/eval.sh ~/Documents/GitHub/bluedoor-ai/document-digitization/field-capture/receiver/data/b20260929-000427
node sim/replay.mjs sim/scenarios/demo.json       # in another terminal
python3 sim/lag.py sessions/<sid>                 # per-event latency report
```

Env vars: `SCAN_MODE=native` (the ablation: images and transcripts only, no helper tools),
`SCAN_MODEL` (default `gpt-6-sol`), `SCAN_EFFORT` (default `low`, for live scanning),
`SCAN_FINAL_EFFORT` (default `medium`, for finalization), `SCAN_STALL_MS` (default 90000,
the watchdog for hung turns), `PORT`, `WHISPER_MODEL`.

Needs `codex` (logged in), `tesseract`, `whisper-cli` and a ggml model, `ffmpeg`, `pdfunite`
(poppler), Python 3 with Pillow, and `.venv` with pyobjc Vision (for OCR; falls back to Tesseract).

## Phone contract

| Call | Body | Notes |
|---|---|---|
| `POST /sessions` | optional `{"note": "..."}` | Start. Returns `{session}` |
| `POST /sessions/:sid/pages?t=12.3` | JPEG bytes | `t` = seconds since Start, phone clock |
| `POST /sessions/:sid/audio?t=10.1&t_end=12.0&ext=m4a` | audio bytes | one clip per utterance |
| `POST /sessions/:sid/end` |  | Stop. The agent finalizes |

## Session output (`sessions/<sid>/`)

`capture/` holds the untouched masters and `events.jsonl`. `ledger.json` is the live system of
record. `archive/Box n/<Folder>/*.pdf` holds searchable PDFs, each with a `.json` sidecar.
`index.csv` is the load file, `schema.json` the inferred data model, `review.json` the
exception queue, and `manifest.json` the checksums and page reconciliation.
