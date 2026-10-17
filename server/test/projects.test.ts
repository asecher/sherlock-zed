import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fixture } from './helpers.ts';
import { projectForFile, sourceFiles } from '../src/projects.ts';

test('finds the nearest project in a multi-app workspace without crossing its root', async () => {
  const f = await fixture('my-app');
  try {
    assert.equal(await projectForFile(path.join(f.root, 'new.tsx'), [f.root]), path.join(f.root, 'project.inlang'));
    assert.equal(await projectForFile(path.join(path.dirname(f.root), 'other.tsx'), [f.root]), undefined);
    await mkdir(path.join(f.root, 'app/paraglide'), { recursive: true });
    await writeFile(path.join(f.root, 'app/paraglide/generated.ts'), 'generated');
    await writeFile(path.join(f.root, 'page.tsx'), 'source');
    assert.deepEqual(await sourceFiles(f.root), [path.join(f.root, 'page.tsx')]);
  } finally { await f.cleanup(); }
});
