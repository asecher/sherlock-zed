import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import { fixture } from './helpers.ts';
import { openSdkProject } from '../src/sdk-project.ts';
import { planExtraction } from '../src/syntax.ts';

test('refuses an invalid catalog rather than replacing it with a new SDK export', async () => {
  const f = await fixture('my-app');
  try {
    const file = path.join(f.root, 'messages/en.json');
    const broken = '{ "welcome": "Hello", BROKEN';
    await writeFile(file, broken);
    await assert.rejects(async () => {
      const project = await openSdkProject(path.join(f.root, 'project.inlang'));
      try { await project.planInsert('new_key', 'New text'); } finally { await project.close(); }
    }, /invalid|parse|JSON|import|error/i);
    assert.equal(await readFile(file, 'utf8'), broken);
  } finally { await f.cleanup(); }
});

test('refuses placeholder-looking literals without an explicit variable mapping', () => {
  const source = "import { m } from './i18n.ts'; const text = 'Hello {name}';";
  const start = source.indexOf("'Hello");
  assert.equal(planExtraction('file:///page.tsx', source, start, start + "'Hello {name}'".length, 'hello'), undefined);
});

test('refuses JSX entity literals until entity decoding is supported', () => {
  const source = "import { m } from './i18n.ts'; const view = <p title=\"Hello &amp; bye\"/>;";
  const selected = '"Hello &amp; bye"';
  const start = source.indexOf(selected);
  assert.equal(planExtraction('file:///page.tsx', source, start, start + selected.length, 'hello'), undefined);
});
