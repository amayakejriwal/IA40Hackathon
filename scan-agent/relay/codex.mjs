// Minimal client for `codex app-server` (JSON-RPC over stdio, one JSON object per line).
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';

// The agent only needs a shell. Turn off every MCP server in the user's config and the
// turn-ended notifier so sessions start fast and quietly.
function quietConfigArgs() {
  let toml = '';
  try { toml = readFileSync(`${homedir()}/.codex/config.toml`, 'utf8'); } catch {}
  const names = [...toml.matchAll(/^\[mcp_servers\.([A-Za-z0-9_-]+)\]\s*$/gm)].map(m => m[1]);
  // sleep_tool is off because an agent that sleeps to "wait for more pages" never ends its turn;
  // the relay wakes it instead.
  return [...names.flatMap(n => ['-c', `mcp_servers.${n}.enabled=false`]), '-c', 'notify=[]', '--disable', 'sleep_tool'];
}

export class Codex extends EventEmitter {
  constructor() {
    super();
    this.id = 0;
    this.pending = new Map();
    this.proc = spawn('codex', ['app-server', ...quietConfigArgs()], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stderr.on('data', d => process.env.CODEX_DEBUG && process.stderr.write(d));
    this.proc.on('exit', code => this.emit('exit', code));
    readline.createInterface({ input: this.proc.stdout }).on('line', line => this.#onLine(line));
  }

  #onLine(line) {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.id != null && this.pending.has(m.id) && !m.method) {
      const { res, rej } = this.pending.get(m.id);
      this.pending.delete(m.id);
      return m.error ? rej(Object.assign(new Error(m.error.message), m.error)) : res(m.result);
    }
    if (m.id != null && m.method) {
      // Server-initiated request (approvals, user input). Sessions run with approvals off,
      // so anything that lands here is unexpected: decline rather than hang the turn.
      this.#send({ id: m.id, error: { code: -32601, message: `scan relay does not handle ${m.method}` } });
      return;
    }
    if (m.method) this.emit('notification', m.method, m.params ?? {});
  }

  #send(obj) { this.proc.stdin.write(JSON.stringify(obj) + '\n'); }

  request(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.#send({ id, method, params });
    });
  }

  async init() {
    await this.request('initialize', { clientInfo: { name: 'scan-relay', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.#send({ method: 'initialized' });
    return this;
  }
}
