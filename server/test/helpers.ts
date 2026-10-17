import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, copyFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export class LspClient {
  process: ChildProcessWithoutNullStreams;
  pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  sequence = 0;
  buffer = Buffer.alloc(0);
  stderr = '';
  constructor() {
    const entry = process.env.SHERLOCK_TEST_ENTRY ?? fileURLToPath(new URL('../src/main.ts', import.meta.url));
    this.process = spawn(process.execPath, [entry, '--stdio']);
    this.process.stderr.on('data', b => { this.stderr += b.toString(); });
    this.process.stdout.on('data', b => { this.buffer = Buffer.concat([this.buffer, b]); this.parse(); });
    this.process.on('exit', code => {
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error(`LSP exited ${code}: ${this.stderr}`)); }
      this.pending.clear();
    });
  }
  parse() {
    while (true) {
      const headEnd = this.buffer.indexOf('\r\n\r\n');
      if (headEnd < 0) return;
      const match = /Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, headEnd).toString());
      if (!match) throw new Error(`Invalid LSP stdout: ${this.buffer}`);
      const length = Number(match[1]);
      if (this.buffer.length < headEnd + 4 + length) return;
      const message = JSON.parse(this.buffer.subarray(headEnd + 4, headEnd + 4 + length).toString());
      this.buffer = this.buffer.subarray(headEnd + 4 + length);
      const item = this.pending.get(message.id);
      if (item) {
        clearTimeout(item.timer); this.pending.delete(message.id);
        if (message.error) item.reject(new Error(message.error.message)); else item.resolve(message.result);
      }
    }
  }
  send(message: any) {
    const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
    this.process.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.process.stdin.write(body);
  }
  request(method: string, params: any): Promise<any> {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`LSP timed out: ${method}\n${this.stderr}`)); }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ id, method, params });
    });
  }
  notify(method: string, params: any) { this.send({ method, params }); }
  async close() {
    if (this.process.exitCode !== null) return;
    try { await this.request('shutdown', null); this.notify('exit', null); }
    finally { this.process.kill(); await once(this.process, 'exit'); }
  }
}

export function exampleRoot(name: string): string {
  const local = fileURLToPath(new URL(`../../examples-apps/${name}/`, import.meta.url));
  return process.env.SHERLOCK_TEST_FIXTURES_ONLY === '1' || !existsSync(path.join(local, 'project.inlang/settings.json'))
    ? fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url)) : local;
}

export async function fixture(name: string) {
  const scratch = path.join(os.homedir(), '.hermes/cache/scratch');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(path.join(scratch, 'sherlock-integration-'));
  const original = exampleRoot(name);
  for (const file of ['project.inlang/settings.json', 'messages/en.json', 'messages/fr.json']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await copyFile(path.join(original, file), path.join(root, file));
  }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}
