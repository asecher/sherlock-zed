import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fixture, LspClient, exampleRoot } from './helpers.ts';
import { references } from '../src/syntax.ts';

for (const [name, relative, key] of [
  ['my-app', 'app/actions/home-page.tsx', 'few_early_kangaroo_endure'],
  ['spa-remix3', 'app/ui/app-shell.tsx', 'brand_name'],
]) {
  test(`hover on the actual ${name} source via stdio`, { timeout: 60_000 }, async () => {
    const f = await fixture(name);
    const client = new LspClient();
    try {
      const text = await readFile(path.join(exampleRoot(name), relative), 'utf8');
      // The opened buffer need not exist on disk; this also exercises document text over filesystem text.
      const uri = pathToFileURL(path.join(f.root, 'page.tsx')).href;
      const doc = TextDocument.create(uri, 'typescriptreact', 4, text);
      const reference = references(uri, text).find(ref => ref.key === key);
      assert.ok(reference);
      await client.request('initialize', { rootUri: pathToFileURL(f.root).href, capabilities: {} });
      client.notify('initialized', {});
      client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 4, text } });
      const hover = await client.request('textDocument/hover', { textDocument: { uri }, position: doc.positionAt(reference.start + 1) });
      assert.match(hover.contents.value, name === 'my-app' ? /Welcome to/ : /Wayfinder/);
    } finally { await client.close(); await f.cleanup(); }
  });
}

test('UTF-16 positions with emoji and CRLF preserve the hovered key range', { timeout: 60_000 }, async () => {
  const f = await fixture('my-app');
  const client = new LspClient();
  try {
    const uri = pathToFileURL(path.join(f.root, 'emoji.tsx')).href;
    const text = "import { m } from './i18n.ts';\r\nconst value = '😀'; const label = m.welcome();\r\n";
    const doc = TextDocument.create(uri, 'typescriptreact', 1, text);
    const position = doc.positionAt(text.indexOf('m.welcome') + 3);
    await client.request('initialize', { rootUri: pathToFileURL(f.root).href, capabilities: {} });
    client.notify('initialized', {});
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescriptreact', version: 1, text } });
    const hover = await client.request('textDocument/hover', { textDocument: { uri }, position });
    assert.equal(doc.getText(hover.range), 'welcome');
    assert.match(hover.contents.value, /Welcome/);
  } finally { await client.close(); await f.cleanup(); }
});
