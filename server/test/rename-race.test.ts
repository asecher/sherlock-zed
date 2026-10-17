import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fixture, LspClient } from './helpers.ts';

test('rename rejects an initiating source change even when its old reference disappears', { timeout: 60_000 }, async () => {
  const f = await fixture('my-app');
  const client = new LspClient();
  try {
    const file = path.join(f.root, 'page.ts');
    const uri = pathToFileURL(file).href;
    const source = "import { m } from './i18n.ts'; const value = m.welcome();";
    await writeFile(file, source);
    const before = await readFile(path.join(f.root, 'messages/en.json'), 'utf8');
    await client.request('initialize', { rootUri: pathToFileURL(f.root).href, capabilities: { workspace: { workspaceEdit: { documentChanges: true } } } });
    client.notify('initialized', {});
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescript', version: 1, text: source } });
    const position = TextDocument.create(uri, 'typescript', 1, source).positionAt(source.indexOf('m.welcome') + 3);
    // Deliberately do not await rename: didChange arrives during project discovery.
    const rename = client.request('textDocument/rename', { textDocument: { uri }, position, newName: 'renamed_welcome' });
    client.notify('textDocument/didChange', { textDocument: { uri, version: 2 }, contentChanges: [{ text: source.replace('m.welcome()', 'm.greeting()') }] });
    await assert.rejects(rename, /source changed|content.?modified/i);
    assert.equal(await readFile(file, 'utf8'), source);
    assert.equal(await readFile(path.join(f.root, 'messages/en.json'), 'utf8'), before);
  } finally { await client.close(); await f.cleanup(); }
});
