import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fixture, LspClient } from './helpers.ts';

test('rename returns both locale catalogs and all recognized static references', { timeout: 60_000 }, async () => {
  const f = await fixture('my-app');
  const client = new LspClient();
  try {
    const first = path.join(f.root, 'page.tsx'), second = path.join(f.root, 'other.ts');
    const text = "import { m } from './i18n.ts'; const view = <p>{m.welcome()}</p>;";
    const other = "import * as tr from './paraglide/messages.js'; export const value = tr.welcome();";
    await writeFile(second, other);
    const uri = pathToFileURL(first).href;
    const doc = TextDocument.create(uri, 'typescriptreact', 3, text);
    const before = await readFile(path.join(f.root, 'messages/en.json'), 'utf8');
    await client.request('initialize', { rootUri: pathToFileURL(f.root).href, capabilities: { workspace: { workspaceEdit: { documentChanges: true } } } });
    client.notify('initialized', {});
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 3, text } });
    const position = doc.positionAt(text.indexOf('m.welcome') + 3);
    const prepare = await client.request('textDocument/prepareRename', { textDocument: { uri }, position });
    assert.equal(prepare.placeholder, 'welcome');
    const edit = await client.request('textDocument/rename', { textDocument: { uri }, position, newName: 'welcome_heading' });
    assert.equal(edit.documentChanges.length, 4);
    for (const locale of ['en', 'fr']) {
      const catalog = pathToFileURL(path.join(f.root, `messages/${locale}.json`)).href;
      const change = edit.documentChanges.find((c: any) => c.textDocument.uri === catalog);
      const original = await readFile(path.join(f.root, `messages/${locale}.json`), 'utf8');
      const updated = JSON.parse(TextDocument.applyEdits(TextDocument.create(catalog, 'json', 0, original), change.edits));
      assert.equal(updated.welcome, undefined);
      assert.equal(updated.welcome_heading, locale === 'en' ? 'Welcome' : 'Bienvenue');
    }
    for (const [file, original] of [[first, text], [second, other]]) {
      const change = edit.documentChanges.find((c: any) => c.textDocument.uri === pathToFileURL(file).href);
      assert.match(TextDocument.applyEdits(TextDocument.create(pathToFileURL(file).href, 'typescript', 0, original), change.edits), /\.welcome_heading\(\)/);
    }
    await assert.rejects(client.request('textDocument/rename', { textDocument: { uri }, position, newName: 'greeting' }), /exist|collision|already/i);
    assert.equal(await readFile(path.join(f.root, 'messages/en.json'), 'utf8'), before);
    assert.equal(await readFile(second, 'utf8'), other);
  } finally { await client.close(); await f.cleanup(); }
});
