// Adapter for the installed FieldCapture iPhone app. The phone's disk-backed
// outbox sends each batch in order: start, metadata, image or audio, then end.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SAFE_ID = /^[A-Za-z0-9_.-]{1,80}$/;
const KINDS = new Set(['event', 'meta', 'image', 'audio', 'ocr']);

function result(status, body) { return { status, body }; }
function digest(body) { return crypto.createHash('sha256').update(body).digest('hex'); }
function seconds(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function putOnce(file, body) {
  if (fs.existsSync(file)) {
    return digest(fs.readFileSync(file)) === digest(body) ? 'existing' : 'conflict';
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, { flag: 'wx' });
  return 'created';
}

export function createPhoneUpload({ startSession, addPage, addAudio, endSession, broadcast }) {
  const batches = new Map();

  return async function phoneUpload(parts, body) {
    if (parts.length !== 4 || parts[0] !== 'upload' || !SAFE_ID.test(parts[1]) ||
        !SAFE_ID.test(parts[2]) || !KINDS.has(parts[3])) {
      return result(404, { error: 'bad upload path' });
    }
    const [, batch, id, kind] = parts;
    if (body.length > 40 * 1024 * 1024) return result(413, { error: 'upload too large' });
    const sha256 = digest(body);
    let value;
    if (kind === 'event' || kind === 'meta' || kind === 'ocr') {
      try { value = JSON.parse(body.toString('utf8')); }
      catch { return result(400, { error: 'invalid JSON' }); }
    }

    if (kind === 'event' && id === 'session_start') {
      if (value.type !== 'session_start' || value.batch !== batch) return result(400, { error: 'start event mismatch' });
      if (batches.has(batch)) {
        const old = batches.get(batch);
        return old.startSha === sha256
          ? result(200, { ok: true, session: old.s.sid, sha256 })
          : result(409, { error: 'conflicting start event' });
      }
      const s = await startSession({ note: `Live phone batch ${batch} from ${value.device || 'FieldCapture'}.` });
      const state = { s, start: seconds(value.t, Date.now() / 1000), startSha: sha256,
        meta: new Map(), ended: false };
      batches.set(batch, state);
      s.phoneBatch = batch;
      broadcast({ kind: 'phone', sid: s.sid, text: `phone connected · ${batch}` });
      return result(200, { ok: true, session: s.sid, sha256 });
    }

    const state = batches.get(batch);
    if (!state) return result(409, { error: 'start event required for this batch' });
    const { s } = state;
    const phoneDir = path.join(s.dir, 'capture', 'phone');

    if (kind === 'event' && id === 'session_end') {
      if (value.type !== 'session_end' || value.batch !== batch) return result(400, { error: 'end event mismatch' });
      if (!state.ended) {
        state.ended = true;
        const expected = Number(value.page_count);
        const received = [...state.meta.values()].filter(m => m.type === 'page' && m.status !== 'rejected' &&
          fs.existsSync(path.join(s.dir, 'capture/pages', `${m.id}.jpg`))).length;
        broadcast({ kind: 'phone', sid: s.sid, text: `upload complete · ${received}/${Number.isFinite(expected) ? expected : '?'} accepted pages received` });
        await endSession(s);
      }
      return result(200, { ok: true, session: s.sid, sha256 });
    }
    if (kind === 'event') return result(400, { error: 'unknown event' });

    if (kind === 'meta') {
      if (value.batch !== batch || value.id !== id || !['page', 'audio'].includes(value.type)) {
        return result(400, { error: 'metadata mismatch' });
      }
      const saved = putOnce(path.join(phoneDir, `${id}.meta.json`), body);
      if (saved === 'conflict') return result(409, { error: 'conflicting metadata' });
      state.meta.set(id, value);
      if (saved === 'created') {
        const at = value.type === 'page' ? value.timing?.captured_at : value.t_start;
        broadcast({ kind: 'phone_meta', sid: s.sid, id, type: value.type,
          t: Math.max(0, seconds(at, state.start) - state.start),
          status: value.status || '', number: value.number || null,
          text: `${id} metadata received · ${value.type}` });
      }
      const pendingFile = path.join(phoneDir, `${id}.pending.${value.type === 'page' ? 'jpg' : 'm4a'}`);
      if (fs.existsSync(pendingFile)) {
        const pendingBody = fs.readFileSync(pendingFile);
        const answer = await phoneUpload(['upload', batch, id, value.type === 'page' ? 'image' : 'audio'], pendingBody);
        if (answer.status !== 200) return answer;
        fs.unlinkSync(pendingFile);
      }
      return result(200, { ok: true, sha256 });
    }

    if (kind === 'ocr') {
      const saved = putOnce(path.join(phoneDir, `${id}.ocr.json`), body);
      return saved === 'conflict' ? result(409, { error: 'conflicting OCR' }) : result(200, { ok: true, sha256 });
    }

    const meta = state.meta.get(id);
    if (!meta) {
      // The phone restores its outbox by filename after a restart. Files created
      // in one millisecond can sort before their metadata, so hold the media.
      const pendingFile = path.join(phoneDir, `${id}.pending.${kind === 'image' ? 'jpg' : 'm4a'}`);
      const saved = putOnce(pendingFile, body);
      return saved === 'conflict' ? result(409, { error: 'conflicting media upload' })
        : result(200, { ok: true, pending: true, sha256 });
    }
    if (meta.type !== (kind === 'image' ? 'page' : 'audio')) return result(409, { error: 'media type mismatch' });
    if (kind === 'image' && meta.image?.sha256 && meta.image.sha256 !== sha256) {
      return result(409, { error: 'image checksum mismatch' });
    }
    const file = path.join(s.dir, kind === 'image' ? `capture/pages/${id}.jpg` : `capture/audio/${id}.m4a`);
    if (fs.existsSync(file)) {
      return digest(fs.readFileSync(file)) === sha256
        ? result(200, { ok: true, session: s.sid, sha256 })
        : result(409, { error: 'conflicting media upload' });
    }
    if (kind === 'image') {
      const t = Math.max(0, seconds(meta.timing?.captured_at, state.start) - state.start);
      const q = new URLSearchParams({ id, t: String(t), meta: JSON.stringify(meta) });
      await addPage(s, body, q);
    } else {
      const t = Math.max(0, seconds(meta.t_start, state.start) - state.start);
      const tEnd = Math.max(t, seconds(meta.t_end, state.start + t) - state.start);
      const q = new URLSearchParams({ id, t: String(t), t_end: String(tEnd), ext: 'm4a' });
      await addAudio(s, body, q);
    }
    return result(200, { ok: true, session: s.sid, sha256 });
  };
}
