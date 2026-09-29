// Replays a FieldCapture receiver batch (real phone session) into the relay with its real timing.
//   node sim/import_batch.mjs <receiver/data/bYYYYMMDD-HHMMSS> [--relay http://localhost:8787] [--speed 1]
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const dir = args.find(a => !a.startsWith('--') && fs.existsSync(a));
const relay = opt('--relay', 'http://localhost:8787');
const speed = Number(opt('--speed', 1));
const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

const start = read('session_start.event.json');
const events = fs.readdirSync(dir).filter(f => /^[pa]\d{4}-[0-9a-f]+\.meta\.json$/.test(f)).map(f => read(f))
  .map(m => ({ ...m, at: m.type === 'page' ? m.timing.captured_at : m.t_end })) // audio is uploaded once the clip ends
  .sort((a, b) => a.at - b.at);

const post = async (p, body) => {
  const r = await fetch(relay + p, { method: 'POST', body });
  if (!r.ok) throw new Error(`${p}: ${r.status} ${await r.text()}`);
  return r.json();
};
const sleep = s => new Promise(r => setTimeout(r, Math.max(0, s * 1000 / speed)));

const { session } = await post('/sessions', JSON.stringify({ note: `Live phone batch ${start.batch} from ${start.device}.` }));
console.log('session', session, '←', start.batch);
let clock = start.t;
for (const e of events) {
  await sleep(e.at - clock);
  clock = e.at;
  if (e.type === 'page') {
    const meta = encodeURIComponent(JSON.stringify({ status: e.status, reasons: e.reasons, metrics: e.metrics, quad: e.quad }));
    await post(`/sessions/${session}/pages?id=${e.id}&t=${(e.timing.captured_at - start.t).toFixed(2)}&meta=${meta}`, fs.readFileSync(path.join(dir, `${e.id}.jpg`)));
    console.log(e.id);
  } else {
    await post(`/sessions/${session}/audio?id=${e.id}&t=${(e.t_start - start.t).toFixed(2)}&t_end=${(e.t_end - start.t).toFixed(2)}&ext=m4a`, fs.readFileSync(path.join(dir, `${e.id}.m4a`)));
    console.log(e.id);
  }
}
await post(`/sessions/${session}/end`, '');
console.log('SESSION', session);
