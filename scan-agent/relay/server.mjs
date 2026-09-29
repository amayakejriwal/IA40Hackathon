// Capture relay. Receives pages and audio from the phone, stores them as immutable masters,
// and hands each one to the session's Codex agent. No model runs here: all judgment is the agent's.
//
//   POST /sessions                                  → {session}          (Start)
//   POST /sessions/:sid/pages?t=12.3[&id=p0001]     body: JPEG           (each captured page)
//   POST /sessions/:sid/audio?t=10.1&t_end=12.0[&ext=m4a]  body: audio   (each utterance)
//   POST /sessions/:sid/end                         → {pages, audio}     (Stop)
//   GET  /sessions/:sid/ledger                      → the agent's ledger.json
//   GET  /events                                    → SSE: arrivals, agent activity, ledger changes
//   GET  /files/<sid>/<path>                        → session files (images, PDFs)
//   GET  /                                          → dashboard
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { Codex } from './codex.mjs';
import { createPhoneUpload } from './phone-upload.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SESSIONS = path.join(ROOT, 'sessions');
const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.SCAN_MODEL ?? 'gpt-6-sol'; // beat gpt-6-luna 41/45 vs 37/45 docs on the 9 phone batches
// native: the agent gets only images and transcripts and uses its own capabilities (no helper tools or OCR hints).
const NATIVE = process.env.SCAN_MODE === 'native';
const EFFORT = process.env.SCAN_EFFORT ?? 'low';              // live scanning: keep up with the operator
const FINAL_EFFORT = process.env.SCAN_FINAL_EFFORT ?? 'medium'; // finalization: schema normalization needs more thought

const sessions = new Map();
const STALL_MS = Number(process.env.SCAN_STALL_MS ?? 90_000); // a turn silent this long is treated as hung

// Mechanical preprocessing, done here so the agent spends its turns on judgment only.
const run = (cmd, args, cwd) => new Promise(res => execFile(cmd, args, { cwd, maxBuffer: 1 << 22 }, (err, out) => res(err ? `(${cmd} failed: ${err.message.split('\n')[0]})` : out.trim())));
const clients = new Set();
let codex;

// ---------- event fan-out ----------
function broadcast(ev) {
  ev.at = Date.now();
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of clients) res.write(line);
  const s = ev.sid && sessions.get(ev.sid);
  if (s) try { fs.appendFileSync(path.join(s.dir, 'activity.jsonl'), JSON.stringify(ev) + '\n'); } catch (e) { console.error('activity log write failed:', e.code); }
  const tag = ev.sid ? ev.sid.slice(-4) : '----';
  const text = ev.text ?? ev.msg ?? ev.id ?? '';
  console.log(`[${tag}] ${ev.kind.padEnd(8)} ${String(text).replace(/\s+/g, ' ').slice(0, 160)}`);
}

// ---------- sessions ----------
async function startSession(meta = {}) {
  const sid = 's-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14) + '-' + crypto.randomBytes(2).toString('hex');
  const dir = path.join(SESSIONS, sid);
  for (const d of ['capture/pages', 'capture/audio', 'work/ocr', 'work/transcripts', 'archive']) fs.mkdirSync(path.join(dir, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, NATIVE ? 'agent/AGENTS.native.md' : 'agent/AGENTS.md'), path.join(dir, 'AGENTS.md'));
  if (!NATIVE) fs.symlinkSync(path.join(ROOT, 'agent/bin'), path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'ledger.json'), JSON.stringify({
    session: sid, status: 'scanning', context: {}, pages: {}, notes: {}, documents: {}, entities: {}, schema: {}, folders: {},
  }, null, 1));

  const { thread } = await codex.request('thread/start', {
    model: MODEL, cwd: dir, sandbox: 'workspace-write', approvalPolicy: 'never', ephemeral: false,
    serviceName: 'scan-relay',
  });
  fs.writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ model: MODEL, effort: EFFORT, final_effort: FINAL_EFFORT, mode: NATIVE ? 'native' : 'tools', note: meta.note ?? '' }, null, 1));
  const s = { sid, dir, threadId: thread.id, turnId: null, chain: Promise.resolve(), pages: 0, audio: 0, ended: false, nudges: 0, started: Date.now() };
  sessions.set(sid, s);
  watchLedger(s);
  broadcast({ kind: 'session', sid, text: `started · ${NATIVE ? 'native · ' : ''}${MODEL}/${EFFORT} · thread ${thread.id}` });
  // Sent along with the first real event, so the agent never idles out of a start-only turn
  // while the first page is being steered into it.
  s.preamble = { type: 'text', text: `SESSION START ${sid} at ${new Date().toISOString()}. ${meta.note ?? ''} The ledger is initialized.` };
  return s;
}

// Put input in front of the agent: steer the running turn if there is one, otherwise wake it
// with a new turn. Serialized per session so we never start two turns at once.
function deliver(s, input, effort = EFFORT) {
  if (s.preamble) { input = [s.preamble, ...input]; s.preamble = null; }
  s.chain = s.chain.then(async () => {
    if (s.turnId) {
      try { await codex.request('turn/steer', { threadId: s.threadId, expectedTurnId: s.turnId, input }); return; }
      catch { /* turn just ended: fall through and start a new one */ }
    }
    const { turn } = await codex.request('turn/start', { threadId: s.threadId, input, effort: s.ended ? FINAL_EFFORT : effort, summary: 'concise' });
    s.turnId = turn.id;
  }).catch(e => broadcast({ kind: 'error', sid: s.sid, text: e.message }));
  return s.chain;
}

function waitIdle(s) {
  // Bounded: if the agent is still busy after a minute, steer the finalize request in anyway.
  return s.turnId ? new Promise(res => { (s.idleWaiters ??= []).push(res); setTimeout(res, 60_000); }) : Promise.resolve();
}

function ledgerOf(s) {
  try { return JSON.parse(fs.readFileSync(path.join(s.dir, 'ledger.json'), 'utf8')); } catch { return null; }
}

// Safety net: when the agent goes idle, make sure every arrival was actually handled.
function checkHandled(s) {
  const l = ledgerOf(s);
  if (!l) return;
  const events = fs.readFileSync(path.join(s.dir, 'capture/events.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const missing = events.filter(e => (e.type === 'page' && !l.pages?.[e.id]) || (e.type === 'audio' && !l.notes?.[e.id])).map(e => e.id);
  const unfinished = s.ended && l.status !== 'done';
  if ((missing.length || unfinished) && s.nudges < 3) {
    s.nudges++;
    const text = [missing.length && `Not yet in the ledger: ${missing.join(', ')}. Handle them.`, unfinished && `SESSION END was received but status is "${l.status}". Finish finalizing.`].filter(Boolean).join(' ');
    broadcast({ kind: 'nudge', sid: s.sid, text });
    deliver(s, [{ type: 'text', text }]);
  } else if (!missing.length) s.nudges = 0;
}

function watchLedger(s) {
  const log = path.join(s.dir, 'ledger.log.jsonl');
  let offset = 0;
  const poll = () => {
    if (!fs.existsSync(log)) return;
    const size = fs.statSync(log).size;
    if (size <= offset) return;
    const fd = fs.openSync(log, 'r');
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    offset = size;
    for (const line of buf.toString().split('\n').filter(Boolean)) {
      try { const e = JSON.parse(line); broadcast({ kind: 'ledger', sid: s.sid, msg: e.msg, patch: e.patch }); } catch {}
    }
  };
  s.ledgerTimer = setInterval(poll, 300);
}

function record(s, ev) {
  fs.appendFileSync(path.join(s.dir, 'capture/events.jsonl'), JSON.stringify(ev) + '\n');
}

async function addPage(s, body, q) {
  const id = q.get('id') ?? `p${String(++s.pages).padStart(4, '0')}`;
  if (q.get('id')) s.pages++;
  const t = Number(q.get('t') ?? (Date.now() - s.started) / 1000);
  const file = `capture/pages/${id}.jpg`;
  fs.writeFileSync(path.join(s.dir, file), body, { flag: 'wx' });
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  record(s, { type: 'page', id, t, file, sha256, bytes: body.length, received: Date.now() });
  broadcast({ kind: 'page', sid: s.sid, id, t, file, text: `${id} t=${t.toFixed(1)}s ${(body.length / 1024) | 0}KB` });
  const intake = NATIVE ? '' : await run('bin/intake', [id], s.dir);
  // Optional phone-side capture metrics (sharpness, glare, ink, crop quad) from the FieldCapture app.
  let phone = '';
  try {
    const m = JSON.parse(q.get('meta') ?? 'null');
    if (m) {
      fs.writeFileSync(path.join(s.dir, `capture/pages/${id}.meta.json`), JSON.stringify(m, null, 1));
      phone = `\nphone: ${JSON.stringify({ status: m.status, reasons: m.reasons, ...m.metrics })}`;
    }
  } catch {}
  await deliver(s, [
    { type: 'text', text: `PAGE ${id} t=${t.toFixed(1)} sha256=${sha256.slice(0, 16)} file=${file}${phone}\n${intake}` },
    { type: 'localImage', path: path.join(s.dir, file) },
  ]);
  return { id, sha256 };
}

async function addAudio(s, body, q) {
  const id = q.get('id') ?? `a${String(++s.audio).padStart(4, '0')}`;
  if (q.get('id')) s.audio++;
  const t = Number(q.get('t') ?? (Date.now() - s.started) / 1000);
  const tEnd = Number(q.get('t_end') ?? t);
  const file = `capture/audio/${id}.${(q.get('ext') ?? 'm4a').replace(/[^a-z0-9]/gi, '')}`;
  fs.writeFileSync(path.join(s.dir, file), body, { flag: 'wx' });
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  record(s, { type: 'audio', id, t, t_end: tEnd, file, sha256, bytes: body.length, received: Date.now() });
  broadcast({ kind: 'audio', sid: s.sid, id, t, file, text: `${id} t=${t.toFixed(1)}-${tEnd.toFixed(1)}s` });
  // Transcription stays in the relay in both modes: the model has no audio input.
  const text = await run(path.join(ROOT, 'agent/bin/transcribe'), [file, `work/transcripts/${id}.txt`], s.dir);
  broadcast({ kind: 'heard', sid: s.sid, id, text: `${id} “${text}”` });
  await deliver(s, [{ type: 'text', text: `AUDIO ${id} t=${t.toFixed(1)}-${tEnd.toFixed(1)} file=${file}\ntranscript: ${text || '(no speech detected)'}` }]);
  return { id, sha256 };
}

async function endSession(s) {
  s.ended = true;
  record(s, { type: 'end', pages: s.pages, audio: s.audio, received: Date.now() });
  broadcast({ kind: 'session', sid: s.sid, text: `stop · ${s.pages} pages · ${s.audio} clips` });
  // Finalize in its own turn (at FINAL_EFFORT) once the agent has caught up on the live stream.
  s.chain = s.chain.then(() => waitIdle(s));
  deliver(s, [{ type: 'text', text: `SESSION END pages=${s.pages} audio=${s.audio}. Finalize the session.` }]);
  return { pages: s.pages, audio: s.audio };
}

// ---------- codex notifications → activity feed ----------
function onNotification(method, p) {
  const s = [...sessions.values()].find(x => x.threadId === p.threadId);
  if (!s) return;
  s.lastActivity = Date.now();
  const sid = s.sid;
  if (method === 'turn/started') { s.turnId = p.turn.id; broadcast({ kind: 'turn', sid, text: 'agent working' }); }
  if (method === 'turn/completed') {
    if (s.turnId === p.turn.id) s.turnId = null;
    for (const res of s.idleWaiters?.splice(0) ?? []) res();
    broadcast({ kind: 'turn', sid, text: `agent idle (${p.turn.status})` });
    setTimeout(() => { if (!s.turnId) checkHandled(s); }, 500);
  }
  if (method === 'item/started' && p.item.type === 'commandExecution') {
    broadcast({ kind: 'cmd', sid, id: p.item.id, text: unwrap(p.item.command) });
  }
  if (method === 'item/completed') {
    const it = p.item;
    if (it.type === 'commandExecution') broadcast({ kind: 'cmd_done', sid, id: it.id, text: unwrap(it.command), exit: it.exitCode, output: (it.aggregatedOutput ?? '').slice(-1500) });
    if (it.type === 'agentMessage' && it.text) broadcast({ kind: 'say', sid, text: it.text });
    if (it.type === 'reasoning') {
      const text = (it.summary ?? []).map(x => typeof x === 'string' ? x : x.text).join(' ').trim();
      if (text) broadcast({ kind: 'think', sid, text });
    }
    if (it.type === 'fileChange') broadcast({ kind: 'edit', sid, text: (it.changes ?? []).map(c => c.path?.replace(s.dir + '/', '')).join(', ') });
  }
  if (method === 'error') broadcast({ kind: 'error', sid, text: JSON.stringify(p).slice(0, 300) });
}

const unwrap = cmd => String(cmd ?? '').replace(/^\/bin\/(z|ba)?sh -lc '([\s\S]*)'$/, '$2').replace(/^\/bin\/(z|ba)?sh -lc "([\s\S]*)"$/, '$2');

// ---------- http ----------
const readBody = req => new Promise((res, rej) => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => res(Buffer.concat(c))); req.on('error', rej); });
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };
const TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf', '.json': 'application/json', '.csv': 'text/csv', '.html': 'text/html', '.txt': 'text/plain', '.m4a': 'audio/mp4' };
const phoneUpload = createPhoneUpload({ startSession, addPage, addAudio, endSession, broadcast });

function lanIp() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return '127.0.0.1';
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST', 'access-control-allow-headers': '*' }); return res.end(); }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      return fs.createReadStream(path.join(ROOT, 'relay/dashboard.html')).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/ping') {
      return json(res, 200, { ok: true, host: os.hostname(), service: 'scan-relay' });
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'access-control-allow-origin': '*' });
      res.write(`data: ${JSON.stringify({ kind: 'hello', sessions: [...sessions.keys()] })}\n\n`);
      clients.add(res);
      return req.on('close', () => clients.delete(res));
    }
    if (req.method === 'GET' && parts[0] === 'files') {
      const file = path.join(SESSIONS, ...parts.slice(1).map(decodeURIComponent));
      if (!file.startsWith(SESSIONS) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'access-control-allow-origin': '*' });
      return fs.createReadStream(file).pipe(res);
    }
    if (req.method === 'POST' && parts[0] === 'upload') {
      const answer = await phoneUpload(parts, await readBody(req));
      return json(res, answer.status, answer.body);
    }
    if (parts[0] !== 'sessions') return json(res, 404, { error: 'not found' });
    if (req.method === 'GET' && parts.length === 1) {
      const list = fs.readdirSync(SESSIONS).filter(d => d.startsWith('s-')).sort().reverse();
      return json(res, 200, list.map(sid => ({ sid, live: sessions.has(sid) })));
    }
    if (req.method === 'GET' && parts[2] === 'ledger') {
      const s = sessions.get(parts[1]) ?? { dir: path.join(SESSIONS, path.basename(parts[1])) };
      return json(res, 200, ledgerOf(s));
    }
    if (req.method === 'GET' && parts[2] === 'log') {
      // Past activity for a session, so a reloaded dashboard can rebuild its feed.
      const file = path.join(SESSIONS, path.basename(parts[1]), 'activity.jsonl');
      const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
      return json(res, 200, lines);
    }
    if (req.method === 'POST' && parts.length === 1) {
      const body = (await readBody(req)).toString();
      const s = await startSession(body ? JSON.parse(body) : {});
      return json(res, 200, { session: s.sid, thread: s.threadId });
    }
    const s = sessions.get(parts[1]);
    if (!s) return json(res, 404, { error: 'unknown session' });
    if (req.method === 'POST' && parts[2] === 'pages') return json(res, 200, await addPage(s, await readBody(req), url.searchParams));
    if (req.method === 'POST' && parts[2] === 'audio') return json(res, 200, await addAudio(s, await readBody(req), url.searchParams));
    if (req.method === 'POST' && parts[2] === 'end') return json(res, 200, await endSession(s));
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}).listen(PORT, '0.0.0.0', async () => {
  const ip = process.env.FIELD_CAPTURE_ADVERTISE_IP || lanIp();
  let advertiser;
  if (process.platform === 'darwin' && process.env.SCAN_BONJOUR !== '0') {
    advertiser = spawn('dns-sd', ['-R', `FieldScan ${os.hostname().split('.')[0]}`,
      '_fieldscan._tcp', 'local', String(PORT), `ip=${ip}`, `port=${PORT}`], { stdio: 'ignore' });
    advertiser.on('error', error => console.error(`Bonjour advertisement failed: ${error.message}`));
    process.on('exit', () => advertiser.kill());
  }
  // Watchdog: a model stream occasionally hangs mid-turn. Interrupt it and resume from the ledger.
  setInterval(async () => {
    for (const s of sessions.values()) {
      if (!s.turnId || Date.now() - (s.lastActivity ?? Date.now()) < STALL_MS) continue;
      const turnId = s.turnId;
      s.lastActivity = Date.now();
      broadcast({ kind: 'nudge', sid: s.sid, text: `turn silent for ${STALL_MS / 1000}s: interrupting and resuming` });
      try { await codex.request('turn/interrupt', { threadId: s.threadId, turnId }); } catch {}
      if (s.turnId === turnId) s.turnId = null;
      deliver(s, [{ type: 'text', text: 'Your previous turn stalled and was interrupted. Everything you already wrote is in ledger.json. Continue with every event that is not in the ledger yet.' + (s.ended ? ' SESSION END was already received: finalize after catching up.' : '') }]);
    }
  }, 15_000);
  codex = await new Codex().init();
  codex.on('notification', onNotification);
  codex.on('exit', code => { console.error(`codex app-server exited (${code})`); process.exit(1); });
  console.log(`scan relay on http://${ip}:${PORT} · dashboard http://localhost:${PORT} · model ${MODEL} · effort ${EFFORT}`);
});
