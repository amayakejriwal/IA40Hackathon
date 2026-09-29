# IA40Hackathon

Phone-to-archive paper scanning. An iPhone auto-captures pages and voice notes; a laptop agent
turns the stream into an organized, searchable archive while the operator is still scanning.

| Folder | What it is |
|---|---|
| [`field-capture/`](field-capture/) | iPhone app (SwiftUI, auto-shutter, page detection, flashlight while scanning, always-on mic), the Wi-Fi receiver, and the live board. |
| [`scan-agent/`](scan-agent/) | The laptop side: a plain HTTP relay that hands each page and utterance to a Codex agent, the agent's tools and instructions, and a replay/scoring harness. |
| [`archivist/`](archivist/) | Web app and document agent (Next.js + OpenAI Agents SDK): receives the phone's uploads (same `/upload` contract, advertised over Bonjour), runs OCR, classification, grouping, field extraction and filing into a self-organizing library, and shows it all in a web UI. |

All three laptop-side servers speak the phone's upload contract and advertise `_fieldscan._tcp`,
so run only one of them at a time (the phone connects to the first one it finds).

Real scans, audio, and session output contain personal information and are not in this repo
(`corpus/`, `sessions/`, `receiver/data/`, `pipeline/out/`, `pipeline/live/events.js`).
