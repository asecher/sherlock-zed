import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { LspClient, fixture } from './helpers.ts';

test('stdio hover reads the official SDK source locale on both example configurations', { timeout: 90_000 }, async () => {
  for (const name of ['my-app', 'spa-remix3']) {
    const f = await fixture(name);
    const client = new LspClient();
    try {
      const uri = pathToFileURL(path.join(f.root, 'page.tsx')).href;
      const text = "import { m } from './i18n.ts';\nconst view = <p>{m.welcome()}</p>;";
      const key = name === 'my-app' ? 'welcome' : 'brand_name';
      const source = text.replace('welcome', key);
      const doc = TextDocument.create(uri, 'typescriptreact', 1, source);
      const init = await client.request('initialize', { rootUri: pathToFileURL(f.root).href, capabilities: {} });
      assert.equal(init.capabilities.hoverProvider, true);
      client.notify('initialized', {});
      client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text: source } });
      const hover = await client.request('textDocument/hover', { textDocument: { uri }, position: doc.positionAt(source.indexOf('m.') + 3) });
      assert.match(hover.contents.value, name === 'my-app' ? /Welcome/ : /Wayfinder/);
      assert.doesNotMatch(hover.contents.value, /Bienvenue|\| Locale \|/);
    } finally { await client.close(); await f.cleanup(); }
  }
});

test('extraction returns versioned code and SDK catalog edits while preserving unsaved translations', { timeout: 60_000 }, async () => {
  const f = await fixture('my-app');
  const client = new LspClient();
  try {
    const uri = pathToFileURL(path.join(f.root, 'page.tsx')).href;
    const catalog = path.join(f.root, 'messages/en.json');
    const catalogUri = pathToFileURL(catalog).href;
    const original = await readFile(catalog, 'utf8');
    const dirty = JSON.stringify({ ...JSON.parse(original), get_started: 'Unsaved message' }, null, 2);
    const source = "import * as m from './paraglide/messages.js';\nconst view = <h2>Get started</h2>;";
    const doc = TextDocument.create(uri, 'typescriptreact', 7, source);
    await client.request('initialize', { rootUri: pathToFileURL(f.root).href, capabilities: { workspace: { workspaceEdit: { documentChanges: true } } } });
    client.notify('initialized', {});
    for (const d of [{ uri, languageId: 'typescriptreact', version: 7, text: source }, { uri: catalogUri, languageId: 'json', version: 9, text: dirty }]) {
      client.notify('textDocument/didOpen', { textDocument: d });
    }
    const start = source.indexOf('Get started');
    const actions = await client.request('textDocument/codeAction', { textDocument: { uri },
      range: { start: doc.positionAt(start), end: doc.positionAt(start + 11) }, context: { diagnostics: [], only: ['refactor.extract'] } });
    assert.equal(actions.length, 1);
    const changes = actions[0].edit.documentChanges;
    assert.equal(changes.length, 2);
    const code = changes.find((c: any) => c.textDocument.uri === uri);
    const messages = changes.find((c: any) => c.textDocument.uri === catalogUri);
    assert.equal(code.textDocument.version, 7);
    assert.equal(messages.textDocument.version, 9);
    assert.match(TextDocument.applyEdits(doc, code.edits), /\{m\.get_started_2\(\)\}/);
    const next = JSON.parse(TextDocument.applyEdits(TextDocument.create(catalogUri, 'json', 9, dirty), messages.edits));
    assert.equal(next.get_started, 'Unsaved message');
    assert.equal(next.get_started_2, 'Get started');
    assert.equal(await readFile(catalog, 'utf8'), original);
  } finally { await client.close(); await f.cleanup(); }
});
