# IA40Hackathon

Phone-to-archive paper scanning. An iPhone auto-captures pages and voice notes; a laptop agent
turns the stream into an organized, searchable archive while the operator is still scanning.

| Folder | What it is |
|---|---|
| [`field-capture/`](field-capture/) | iPhone app (SwiftUI, auto-shutter, page detection, flashlight while scanning, always-on mic), the Wi-Fi receiver, and the live board. |
| [`scan-agent/`](scan-agent/) | The laptop side: a plain HTTP relay that hands each page and utterance to a Codex agent, the agent's tools and instructions, and a replay/scoring harness. |

Real scans, audio, and session output contain personal information and are not in this repo
(`corpus/`, `sessions/`, `receiver/data/`, `pipeline/out/`, `pipeline/live/events.js`).
