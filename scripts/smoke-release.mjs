import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir, lstat } from 'node:fs/promises';
import { join, resolve, basename, sep } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function smokeRelease(archive) {
  archive = resolve(archive);
  const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
  assert.equal(await readFile(archive + '.sha256', 'utf8'), `${hash}  ${basename(archive)}\n`, 'release checksum mismatch');
  const scratch = join(homedir(), '.hermes/cache/scratch');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'sherlock-isolated-smoke-'));
  let client;
  try {
    const runtime = join(root, 'runtime');
    const workspace = join(root, 'workspace');
    await mkdir(runtime); await mkdir(workspace);
    // Only smoke archives produced by the packager, not untrusted downloads.
    execFileSync('tar', ['-xzf', archive, '-C', runtime]);
    const manifest = JSON.parse(await readFile(join(runtime, 'release.json'), 'utf8'));
    assert.deepEqual(manifest, { format: 1, name: 'sherlock-language-server', version: manifest.version, os: process.platform, arch: process.arch, nodeMajor: 24, entrypoint: 'server/dist/main.js' });
    assert.equal(Number(process.versions.node.split('.')[0]), manifest.nodeMajor);
    const require = createRequire(join(runtime, 'package.json'));
    const sdk = require.resolve('@inlang/sdk');
    assert.ok(sdk.startsWith(runtime + sep), 'SDK must resolve inside extracted archive');
    const payload = { files: 0, native: [], wasm: [] };
    async function inspect(directory) {
      for (const name of await readdir(directory)) {
        const file = join(directory, name); const stat = await lstat(file);
        assert.ok(!stat.isSymbolicLink(), `unexpected link: ${file}`);
        if (stat.isDirectory()) await inspect(file);
        else { assert.ok(stat.isFile() && stat.nlink === 1); payload.files++;
          if (file.endsWith('.node')) payload.native.push(file.slice(runtime.length + 1));
          if (file.endsWith('.wasm')) payload.wasm.push(file.slice(runtime.length + 1));
        }
      }
    }
    await inspect(runtime);
    assert.ok(payload.native.length > 0, 'native dependencies must be shipped');
    assert.ok(payload.wasm.length > 0, 'WASM assets must be shipped');
    client = new LspClient(join(runtime, manifest.entrypoint), workspace);
    const initialized = await client.request('initialize', { rootUri: pathToFileURL(workspace).href, capabilities: { workspace: { workspaceEdit: { documentChanges: true } } } });
    assert.equal(initialized.capabilities.hoverProvider, true);
    client.notify('initialized', {});
    const results = [];
    // Real SDK/catalog integration for both supported pinned format plugins.
    for (const version of ['4.4.0', '4.5.0']) {
      const project = join(workspace, 'plugin-' + version);
      await mkdir(join(project, 'project.inlang'), { recursive: true });
      await mkdir(join(project, 'messages'));
      const settings = { baseLocale: 'en', locales: ['en', 'fr'], modules: [`https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@${version}/dist/index.js`], 'plugin.inlang.messageFormat': { pathPattern: './messages/{locale}.json' } };
      await writeFile(join(project, 'project.inlang/settings.json'), JSON.stringify(settings));
      const catalog = JSON.stringify({ welcome: 'Isolated SDK welcome', get_started: 'Existing message' }, null, 2);
      await writeFile(join(project, 'messages/en.json'), catalog);
      await writeFile(join(project, 'messages/fr.json'), JSON.stringify({ welcome: 'Bonjour' }));
      const file = join(project, 'page.tsx'); const uri = pathToFileURL(file).href;
      const source = "import * as m from './paraglide/messages.js';\nconst title = m.welcome();\nconst view = <h2>Get started</h2>;";
      await writeFile(file, source);
      const document = { uri, languageId: 'typescriptreact', version: 7, text: source };
      client.notify('textDocument/didOpen', { textDocument: document });
      const hover = await client.request('textDocument/hover', { textDocument: { uri }, position: positionAt(source, source.indexOf('m.welcome') + 3) });
      assert.match(hover?.contents?.value ?? '', /Isolated SDK welcome/);
      assert.doesNotMatch(hover.contents.value, /Bonjour/);
      const catalogUri = pathToFileURL(join(project, 'messages/en.json')).href;
      const dirty = JSON.stringify({ welcome: 'Isolated SDK welcome', get_started: 'Unsaved message' }, null, 2);
      client.notify('textDocument/didOpen', { textDocument: { uri: catalogUri, languageId: 'json', version: 9, text: dirty } });
      const start = source.indexOf('Get started');
      const actions = await client.request('textDocument/codeAction', { textDocument: { uri }, range: { start: positionAt(source, start), end: positionAt(source, start + 'Get started'.length) }, context: { diagnostics: [], only: ['refactor.extract'] } });
      assert.equal(actions.length, 1);
      const changes = actions[0].edit.documentChanges;
      assert.equal(changes.length, 2);
      const code = changes.find(c => c.textDocument.uri === uri);
      const messages = changes.find(c => c.textDocument.uri === catalogUri);
      assert.equal(code.textDocument.version, 7); assert.equal(messages.textDocument.version, 9);
      assert.match(applyEdits(source, code.edits), /\{m\.get_started_2\(\)\}/);
      const next = JSON.parse(applyEdits(dirty, messages.edits));
      assert.equal(next.get_started, 'Unsaved message'); assert.equal(next.get_started_2, 'Get started');
      assert.equal(await readFile(join(project, 'messages/en.json'), 'utf8'), catalog);
      assert.equal(await readFile(file, 'utf8'), source);
      results.push({ plugin: version, hover: true, extraction: true, unsavedCatalogPreserved: true, diskUnchanged: true });
    }
    await client.close(); client = null;
    return { archive, sha256: hash, manifest, isolated: true, sdk: sdk.slice(runtime.length + 1), payload, results };
  } finally { if (client) await client.close(); await rm(root, { recursive: true, force: true }); }
}

function positionAt(text, offset) {
  const before = text.slice(0, offset).split('\n');
  return { line: before.length - 1, character: before.at(-1).length };
}
function applyEdits(text, edits) {
  const offset = p => text.split('\n').slice(0, p.line).reduce((n, line) => n + line.length + 1, 0) + p.character;
  const patches = edits.map(e => ({ start: offset(e.range.start), end: offset(e.range.end), text: e.newText })).sort((a, b) => b.start - a.start);
  for (const p of patches) text = text.slice(0, p.start) + p.text + text.slice(p.end);
  return text;
}

class LspClient {
  pending = new Map(); sequence = 0; buffer = Buffer.alloc(0); stderr = '';
  constructor(entry, cwd) {
    const env = { ...process.env };
    for (const key of ['NODE_PATH', 'NODE_OPTIONS', 'SHERLOCK_TEST_ENTRY']) delete env[key];
    this.process = spawn(process.execPath, [entry, '--stdio'], { cwd, env });
    this.process.stderr.on('data', b => { this.stderr += b.toString(); });
    this.process.stdout.on('data', b => {
      this.buffer = Buffer.concat([this.buffer, b]);
      while (true) {
        const end = this.buffer.indexOf('\r\n\r\n'); if (end < 0) return;
        const match = /Content-Length:\s*(\d+)/i.exec(this.buffer.subarray(0, end).toString());
        if (!match) { this.fail(new Error('Invalid LSP framing')); return; }
        const size = Number(match[1]); if (this.buffer.length < end + 4 + size) return;
        const message = JSON.parse(this.buffer.subarray(end + 4, end + 4 + size));
        this.buffer = this.buffer.subarray(end + 4 + size);
        const pending = this.pending.get(message.id);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id); message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result); }
      }
    });
    this.process.on('error', error => this.fail(error));
    this.process.on('exit', code => this.fail(new Error(`LSP exited ${code}: ${this.stderr}`)));
  }
  fail(error) { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(error); } this.pending.clear(); }
  send(message) { const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message })); this.process.stdin.write(`Content-Length: ${body.length}\r\n\r\n`); this.process.stdin.write(body); }
  notify(method, params) { this.send({ method, params }); }
  request(method, params) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`LSP timeout: ${method}\n${this.stderr}`)); }, 30_000);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  async close() {
    if (this.process.exitCode !== null || this.process.signalCode !== null) return;
    try { await this.request('shutdown', null); this.notify('exit', null); }
    finally { const exited = once(this.process, 'exit'); this.process.kill(); await exited; }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length > 3) throw new Error('Usage: node scripts/smoke-release.mjs [ARCHIVE]');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const archive = process.argv[2] ?? join(root, 'release', `sherlock-language-server-v${pkg.version}-${process.platform}-${process.arch}.tar.gz`);
  console.log(JSON.stringify(await smokeRelease(archive), null, 2));
}
