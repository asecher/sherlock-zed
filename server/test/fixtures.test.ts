import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { exampleRoot } from './helpers.ts';

test('committed example snapshots keep release CI independent of local application folders', async () => {
  const previous = process.env.SHERLOCK_TEST_FIXTURES_ONLY;
  process.env.SHERLOCK_TEST_FIXTURES_ONLY = '1';
  try {
    for (const name of ['my-app', 'spa-remix3']) {
      const root = exampleRoot(name);
      assert.ok(root.includes(`${path.sep}fixtures${path.sep}`));
      const settings = JSON.parse(await readFile(path.join(root, 'project.inlang/settings.json'), 'utf8'));
      assert.ok(settings.locales.includes(settings.baseLocale));
      assert.ok(Object.keys(JSON.parse(await readFile(path.join(root, 'messages/en.json'), 'utf8'))).length > 1);
    }
  } finally {
    if (previous === undefined) delete process.env.SHERLOCK_TEST_FIXTURES_ONLY;
    else process.env.SHERLOCK_TEST_FIXTURES_ONLY = previous;
  }
});
