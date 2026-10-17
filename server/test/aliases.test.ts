import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { fixture, LspClient } from './helpers.ts';

for (const workspaceAlias of [true, false]) {
  for (const operation of ['rename', 'extract']) {
    test(`${operation} rejects ${workspaceAlias ? 'symlink workspace' : 'aliased dirty catalog'} without dropping unsaved text`, { timeout: 60_000 }, async () => {
      const f = await fixture('my-app');
      const client = new LspClient();
      try {
        const alias = path.join(f.root, 'alias');
        await symlink(f.root, alias, 'dir');
        const root = workspaceAlias ? alias : f.root;
        const source = "import { m } from './i18n.ts'; const value = m.welcome(); const label = 'Fresh label';";
        await writeFile(path.join(f.root, 'page.ts'), source);
        const uri = pathToFileURL(path.join(root, 'page.ts')).href;
        const catalog = path.join(f.root, 'messages/en.json');
        const before = await readFile(catalog, 'utf8');
        const dirty = JSON.stringify({ ...JSON.parse(before), welcome: 'Unsaved welcome', unsaved_only: 'Keep me' });
        const catalogUri = pathToFileURL(path.join(alias, 'messages/en.json')).href;
        await client.request('initialize', { rootUri: pathToFileURL(root).href, capabilities: { workspace: { workspaceEdit: { documentChanges: true } } } });
        client.notify('initialized', {});
        client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'typescript', version: 1, text: source } });
        client.notify('textDocument/didOpen', { textDocument: { uri: catalogUri, languageId: 'json', version: 7, text: dirty } });
        const doc = TextDocument.create(uri, 'typescript', 1, source);
        const request = operation === 'rename'
          ? client.request('textDocument/rename', { textDocument: { uri }, position: doc.positionAt(source.indexOf('m.welcome') + 3), newName: 'renamed_welcome' })
          : client.request('textDocument/codeAction', { textDocument: { uri }, range: { start: doc.positionAt(source.indexOf("'Fresh label'")), end: doc.positionAt(source.indexOf("'Fresh label'") + "'Fresh label'".length) }, context: { diagnostics: [], only: ['refactor.extract'] } });
        await assert.rejects(request, /alias|symlink/i);
        // No edit is returned to overwrite the dirty buffer; planning never writes disk.
        assert.equal(await readFile(catalog, 'utf8'), before);
        assert.equal(await readFile(path.join(f.root, 'page.ts'), 'utf8'), source);
      } finally { await client.close(); await f.cleanup(); }
    });
  }
}
