// Plays a scripted scan session against the relay, standing in for the phone.
//   node sim/replay.mjs sim/scenarios/demo.json [--relay http://localhost:8787] [--speed 1]
//
// Scenario: {"note": "...", "steps": [
//   {"page": "corpus/pages/x/p0001.jpg"},       send a page (path relative to repo root)
//   {"say": "box 13, Smith parcel"},            speak it (macOS `say`), send as an audio clip
//   {"wait": 2}                                 seconds
// ]}
// Pages are spaced by `page_gap` seconds (default 2) unless a wait says otherwise.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const relay = opt('--relay', 'http://localhost:8787');
const speed = Number(opt('--speed', 1));
const scenario = JSON.parse(fs.readFileSync(args.find(a => a.endsWith('.json')), 'utf8'));
const gap = scenario.page_gap ?? 2;
const sleep = s => new Promise(r => setTimeout(r, (s * 1000) / speed));

const post = async (p, body) => {
  const r = await fetch(relay + p, { method: 'POST', body });
  if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
  return r.json();
};

function speak(text) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'say-'));
  execFileSync('say', ['-o', path.join(tmp, 'x.aiff'), text]);
  execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', path.join(tmp, 'x.aiff'), '-c:a', 'aac', '-b:a', '64k', path.join(tmp, 'x.m4a')]);
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(tmp, 'x.m4a')]).toString());
  return { buf: fs.readFileSync(path.join(tmp, 'x.m4a')), dur };
}

const { session } = await post('/sessions', JSON.stringify({ note: scenario.note ?? '' }));
console.log('session', session);
const t0 = Date.now();
const now = () => ((Date.now() - t0) / 1000) * speed;

for (const step of scenario.steps) {
  if (step.wait) { await sleep(step.wait); continue; }
  if (step.say) {
    const { buf, dur } = speak(step.say);
    const t = now();
    await sleep(dur); // the clip is uploaded once the operator stops talking
    const r = await post(`/sessions/${session}/audio?t=${t.toFixed(2)}&t_end=${(t + dur).toFixed(2)}&ext=m4a`, buf);
    console.log(`${r.id}  "${step.say}"`);
  }
  if (step.page) {
    const r = await post(`/sessions/${session}/pages?t=${now().toFixed(2)}`, fs.readFileSync(path.resolve(ROOT, step.page)));
    console.log(`${r.id}  ${step.page}`);
    await sleep(gap);
  }
}
console.log(await post(`/sessions/${session}/end`, ''));
console.log(`watch: ${relay}/  ·  ledger: ${relay}/sessions/${session}/ledger`);
