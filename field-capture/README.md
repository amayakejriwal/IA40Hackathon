# Field capture: iPhone paper digitization prototype

Built and tested on the night of 2026-09-28, the evening before the stealth hackathon (2h45 build
with Codex). It proves the whole loop on real paper:

```
iPhone 15 (FieldScan app)                     Laptop (receiver.py, :8765)                 Live board (/live/)
  auto-capture 48 MP pages                      saves + sha256 every upload                 pages appear as scanned
  quality gate: blur, glare, cut-off,           thumbnail + Apple Vision OCR (~0.5 s)       documents assemble, reorder
  hand-in-frame, weakest region                 "did it read?" check                        people / orgs resolve
  always-on mic -> speech clips                 Whisper (whisper.cpp) per clip (~0.3 s)     conflicts flagged
  Start / Stop, Next / Rescan         ──Wi-Fi──▶ event stream  ◀── agent decisions ─────────▶ (polls /api/events)
```

The agent step (filing pages into documents, extracting fields, resolving entities, flagging
issues) was run live by Claude in the chat session through `receiver/agent.py`. For the demo it
should be a direct per-page model call (~2–4 s instead of ~10–30 s). The board and event format
stay the same.

A parallel design for the laptop agent (Codex app-server relay, ground-truth sets, replay
harness) lives in `~/Documents/GitHub/stealth-hackathon`. Its `sim/import_batch.mjs` can replay
this receiver's batches, and `sim/truth/` holds ground truth for nine of tonight's sessions.

## Layout

| Path | What it is |
|---|---|
| `ios/` | SwiftUI app shown as "Demo". `project.yml` (XcodeGen) → `FieldCapture.xcodeproj` |
| `ios/build.sh` | Build, install and launch on the USB iPhone in one command (see Build notes) |
| `ios/FieldCapture/CaptureEngine.swift` | Camera, live page detection, auto-shutter state machine, hand-in-frame gate |
| `ios/FieldCapture/PageProcessor.swift` | Straighten, quality metrics (sharpness, weakest region, glare, ink), JPEG, optional on-phone OCR |
| `ios/FieldCapture/AudioRecorder.swift` | Always-on mic, level-gated speech clips (.m4a), noise-clip filter |
| `ios/FieldCapture/Uploader.swift` | Disk-backed outbox, serial retrying uploads, Bonjour discovery of the laptop |
| `ios/FieldCapture/AppModel.swift` / `ContentView.swift` | Session Start/Stop, Next/Rescan cue, minimal UI, settings sheet |
| `receiver/receiver.py` | Stdlib HTTP server: uploads, ledger, Bonjour advert, Whisper, OCR, live event stream |
| `receiver/agent.py` | `show` a page's OCR text; `post` agent decisions to the live board |
| `receiver/dashboard.html` | Operator dashboard (`http://localhost:8765`): every capture, latency, OCR verdicts |
| `receiver/tools/ocrfull.swift` | Apple Vision OCR (text + word boxes, upside-down check), used per page |
| `receiver/tools/ocrprobe.swift` | OCR readability probe (real-word rate; used for calibration) |
| `pipeline/live/index.html` | Live board. At `/live/` it follows the receiver; opened as a file it replays `events.js` |
| `pipeline/out/b20260929-001214/` | Static end-to-end pipeline page for one real batch (OCR boxes, documents, entities, review queue) |

Private data is git-ignored: `receiver/data/` holds real FOIA letters and medical statements, and
`pipeline/out/` also contains that content.

## Run

```sh
cd receiver && python3 -u receiver.py | tee -a receiver.log   # dashboard :8765, live board :8765/live/
cd ios && ./build.sh                                           # only after code changes; app stays installed 7 days
```

On the phone, open Demo and press **Start**. It finds the laptop over Bonjour
(`_fieldscan._tcp`), or you can long-press the page count and enter `10.0.0.148:8765`.
Only Wi-Fi is needed; the USB cable is only for installing builds.

Receiver prerequisites: `whisper-cli` (Homebrew whisper-cpp), `ffmpeg`,
`receiver/models/ggml-base.en.bin` (git-ignored, 148 MB, from huggingface ggerganov/whisper.cpp),
and the two compiled Swift tools (`swiftc -O tools/ocrfull.swift -o tools/ocrfull`).

### Phone → laptop contract

| Call | Body |
|---|---|
| `POST /upload/<batch>/<id>/meta` | JSON. Pages: `type:"page"`, number, status, reasons, metrics, quad, image dims + sha256, timing (`captured_at` = phone wall clock). Clips: `type:"audio"`, `t_start`, `t_end`, `peak_db` |
| `POST /upload/<batch>/<id>/image` | Straightened page JPEG |
| `POST /upload/<batch>/<id>/audio` | Speech clip .m4a |
| `POST /upload/<batch>/<id>/ocr` | Optional on-phone OCR (off by default) |
| `POST /upload/<batch>/session_start\|session_end/event` | `session_end` carries `page_count`, `captures`, `rejected`, `audio_clips` for page accounting |

### Live board event stream (`GET /api/events?since=N`, `POST /api/agent`)

`session {state}` · `page {n, img, state: reading|read, words, snippet, verdict}` · `voice {text, action}`
and, from the agent: `doc {id, box, boxkey, title, doctype, date, pages[] (reading order), status: open|complete, fields{}, note}` ·
`entity {name, etype: person|org|agency|address, doc, seen}` · `issue {sev: high|med|low|info, doc, text}` · `narration {text}`.
Re-posting a `doc` with the same id updates it, which is how reordering and reuniting pages show on the board.

## Tuned values (from measurements on tonight's pages)

| Setting | Value | Evidence |
|---|---|---|
| Resolution | 48 MP stills (`highRes`) | 12 MP gave ~190 dpi at typical framing; 48 MP gives ~350–550 dpi |
| Auto-shutter | still 0.25 s, corner jitter ≤ 3 %, motion ≤ 4, page ≥ 8 % of frame | 0.35 s felt slow; 0.2 s / motion 6 fired mid-flip |
| Hand gate | never fire while Vision detects a hand | Removed every double-shot and mid-flip capture (3 → 0 hands in shot) |
| Blur (whole page) | mean of top-2000 \|Laplacian\| ≥ 105 | Blurry 20–93, sharp 120–358 (sparse signature pages included) |
| Blur (weakest region) | 3×3 grid, text regions only, ≥ 60, applied when ≥ 4 text regions | Handheld tilt leaves one corner soft: bad 6–53, good ≥ 92 |
| Glare | pixels ≥ max(paper+35, 245) > 1 % | First rule (paper+18) rejected clean cream paper; clean pages score ≤ 0.11 % |
| Cut-off | a detected corner within 0.6 % of the frame edge | Correctly rejected a book detected as a page |
| Mic | open a clip at −30 dBFS, keep only if its peak ≥ −22 dBFS | All real speech peaked ≥ −19.7 dB; all empty/noise clips ≤ −20.7 dB |
| Laptop "did it read" | ≥ 30 words and < 60 % dictionary words → rescan | Good pages 71–84 %; blurry 0–11 %; soft-corner 20–34 % |
| Duplicates (laptop) | ORB features + RANSAC inliers; > 250 = duplicate, 200–300 = review | Duplicates 294–828; different pages ≤ 220 (same-template forms are the closest) |

## What we learned

1. **The phone should guarantee only what can't be fixed later**: blur, glare, cut-off, a hand
   over text, and resolution. Crooked pages, rotation, lighting, cropping, order and duplicates can
   all be fixed on the laptop. Never let AI "sharpen" or re-create content: that invents plausible
   wrong digits (compare the Xerox JBIG2 digit-swapping case).
2. **OCR readability is a better check than pixel sharpness.** One page that scored 57 on blur
   was 76 % readable, and a skewed crop that passed the blur check read at 8 %. The weak spot is
   tables and forms: they have few dictionary words, so they fall back to the blur checks. The
   Optum account-detail table was a false "didn't read".
3. **Handheld has a ceiling.** Tilt puts one corner out of focus at 20–30 cm. The fix is a rig:
   an overhead stand, or better, a 16" LED photo light box (diffuse light from the sides, a camera
   hole on top, and it blocks room light). Avoid the phone flash and ring lights: light next to the
   lens causes glare in the centre of the page. Rig mode still to build: lock focus, exposure and
   white balance after page 1, and require the page to fill at least ~40 % of the frame.
4. **Stop the shutter while a hand is in the frame.** This fixed the double-shots. Comparing ink
   layouts on the phone did not work (duplicates 0.48 vs different pages 0.39–0.57), so it is
   switched off and duplicate detection happens on the laptop.
5. **A minimal operator screen made scanning faster.** With only the page count, a Next/Rescan
   pill and Start/Stop, the gap between pages fell to ~3.3 s (pages 1–9) from 4–6 s. Confirmed by
   the user.
6. **Voice gives structure a separator sheet can't**: document boundaries, "back to Byron",
   "these are all single pages", corrections ("no, that was the second page"). The agent should
   join clips split mid-sentence and drop filler. Treat voice as a hint, not ground truth.
7. **Reconciliation is the demo.** On live runs the board caught: page 2 arriving before page 1
   (reordered from "Page 2" headers); an orphan signature page reunited 8–11 pages later; a
   6-page packet scanned in reverse (put back in order by "Page N of 6"); duplicate and
   unreadable re-shots set aside; a letter missing its page 2; two sheets in one shot; a
   deposit of $69.54 vs $61.21 in one letter; a form date of 7.2.2026 vs July 27; a procedure
   scheduled 6/24 but billed 7/8; and protected health information flagged for restricted access.

## Measured performance

| Stage | Time |
|---|---|
| Shutter → laptop (12 MP / 48 MP) | ~0.9 s / ~1.8 s |
| Laptop OCR (M3 Pro, Apple Vision accurate) | 0.25–0.65 s per page |
| Whisper base.en per voice clip | 0.3–0.5 s |
| Agent decision (Claude in chat, tonight) | ~10–30 s; target with a direct API call: 2–4 s |
| Operator pace (minimal UI, handheld) | ~3.3 s per page |

## Known issues and next steps

- **Laptop → phone feedback:** the laptop's "didn't read" and "two sheets in one shot" results
  should turn the phone's pill to **Rescan page N**.
- **Agent speed:** replace chat-driven decisions with one model call per page that emits the
  event types above.
- **Preservation master:** the phone uploads only the straightened crop. It should also send the
  original 48 MP photo so the laptop can re-crop and keep an untouched master.
- **Rig mode** (see above); the per-region check stays as a safety net.
- **Page numbers** can skip when a rejected page's result arrives after the next shot. Final
  page order is decided on the laptop anyway.
- The phone passes some pages the laptop later rejects (Pope Flynn #9 soft scan, #12 two sheets).
- The personal-team signing certificate expires 7 days after install; rebuild with `ios/build.sh`.

## Build notes (Xcode 26 on this MacBook)

- `ios/build.sh` builds with `-sdk iphoneos` and no `-destination`. Xcode 26 otherwise refuses to
  build for a device unless its ~8.4 GB "iOS platform" (simulator runtime) is installed, and it is
  deliberately not installed here because disk space is tight.
- Signing: personal team `A698ST8F6D` (Samuel Crombie). The `sam@actionbase.co` account's
  session in Xcode had expired.
- The phone must be paired (`xcrun devicectl manage pair --device <id>`) and in Developer Mode.
  USB data needed "Allow accessories to connect" approval and a data-capable cable.

## Housekeeping done tonight

- Freed disk space for Xcode:
  - deleted ~8.5 GB of rebuildable caches and `node_modules`
  - removed old simulator runtimes and Xcode device-support copies
  - moved ~17 GB of cold files to the private bucket
    `s3://bluedoor-cold-archive-590183727216-us-east-1/laptop-2026-09-28/`
- **About the cold-file move:**
  - each file was checksummed and size-verified in S3 before its local copy was deleted
  - Codex sessions older than 30 days, archived sessions and `~/Backups/disclosure-law-m4-checkpoints-20260907` were uploaded as tarballs
  - individual large files keep their home-relative paths
  - it was resumed at wrap-up, and the restore manifest lands in `bluedoor-ai/COLD_ARCHIVE_2026-09-28.tsv` (and `MANIFEST.tsv` in the bucket) when it finishes
- About 8.5 GB of an old iOS 18.4 simulator asset may remain under SIP-protected
  `/System/Library/AssetsV2/`; macOS normally clears it on its own.
