import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { openSdkProject } from '../src/sdk-project.ts';
import { exampleRoot } from './helpers.ts';

async function fixture(version = '4.5.0', catalogs: Record<string, unknown> = { en: { greeting: 'Hello {name}', 'literal.dot': 'Dotted' }, fr: { greeting: 'Bonjour {name}', onlyFrench: 'Français' } }) {
  const scratch = path.join(os.homedir(), '.hermes/cache/scratch');
  await fs.mkdir(scratch, { recursive: true });
  const root = await fs.mkdtemp(path.join(scratch, 'sdk-adapter-'));
  const project = path.join(root, 'project.inlang');
  await fs.mkdir(project); await fs.mkdir(path.join(root, 'messages'));
  const settings = { baseLocale: 'en', locales: ['en', 'fr'], modules: [`https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@${version}/dist/index.js`], 'plugin.inlang.messageFormat': { pathPattern: './messages/{locale}.json' } };
  await fs.writeFile(path.join(project, 'settings.json'), JSON.stringify(settings));
  for (const [locale, data] of Object.entries(catalogs)) await fs.writeFile(path.join(root, 'messages', `${locale}.json`), JSON.stringify(data, null, 2) + '\n');
  return { root, project, settings, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

async function fingerprint(root: string): Promise<Record<string, string>> {
  const output: Record<string, string> = {};
  async function walk(dir: string) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (entry.isFile()) output[path.relative(root, target)] = createHash('sha256').update(await fs.readFile(target)).digest('hex');
    }
  }
  await walk(root); return output;
}

test('rejects unsafe keys rather than emitting corrupt or prototype-changing catalogs', async () => {
  const f = await fixture();
  try {
    const p = await openSdkProject(f.project);
    try {
      for (const key of ['', '$schema', '__proto__', 'constructor.prototype', 'bad\u0000key']) {
        await assert.rejects(p.planInsert(key, 'Text'), /unsafe|invalid|reserved/i);
        await assert.rejects(p.planRename('greeting', key), /unsafe|invalid|reserved/i);
      }
      await assert.rejects(p.planInsert('greeting.child', 'Text'), /collision|conflict/i);
      await assert.rejects(p.planInsert('literal', 'Text'), /collision|conflict/i);
      await assert.rejects(p.planRename('onlyFrench', 'greeting.child'), /collision|conflict/i);
      assert.equal(await p.preview('greeting'), 'Hello {name}');
    } finally { await p.close(); }
  } finally { await f.cleanup(); }
});

test('both real example configs work on copies offline and leave all source bytes untouched', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Network access forbidden'); });
  for (const name of ['my-app', 'spa-remix3']) {
    const originalRoot = exampleRoot(name);
    const originalSettings = path.join(originalRoot, 'project.inlang/settings.json');
    const settings = JSON.parse(await fs.readFile(originalSettings, 'utf8'));
    const originals = [originalSettings, ...settings.locales.map((locale: string) => path.join(originalRoot, `messages/${locale}.json`))];
    const originalHashes = await Promise.all(originals.map(async file => createHash('sha256').update(await fs.readFile(file)).digest('hex')));
    const f = await fixture();
    try {
      await fs.copyFile(originalSettings, path.join(f.project, 'settings.json'));
      for (const locale of settings.locales) await fs.copyFile(path.join(originalRoot, `messages/${locale}.json`), path.join(f.root, `messages/${locale}.json`));
      await fs.writeFile(path.join(f.project, '.env'), 'SECRET=do-not-load');
      await fs.mkdir(path.join(f.project, 'cache')); await fs.writeFile(path.join(f.project, 'cache/plugin.js'), 'throw new Error("cache evaluated")');
      await fs.writeFile(path.join(f.project, '.lix'), 'not a project cache');
      const before = await fingerprint(f.root);
      const p = await openSdkProject(f.project);
      try {
        assert.ok(p.keys.size > 0);
        const first = [...p.keys].find(key => key !== '$schema')!;
        assert.equal(typeof await p.preview(first), 'string');
        const changes = await p.planInsert('sdk_test_insert', 'Test {name}');
        assert.equal(changes.length, 1, name + ': only source catalog should change');
        assert.equal(changes[0].path, p.sourcePath);
      } finally { await p.close(); }
      assert.deepEqual(await fingerprint(f.root), before);
      assert.deepEqual(await Promise.all(originals.map(async file => createHash('sha256').update(await fs.readFile(file)).digest('hex'))), originalHashes);
    } finally { await f.cleanup(); }
  }
});

test('rejects catalog symlinks escaping the project root, including unsaved overlays', async () => {
  const f = await fixture(); const outside = await fixture();
  try {
    const target = path.join(f.root, 'messages/en.json');
    await fs.unlink(target); await fs.symlink(path.join(outside.root, 'messages/en.json'), target);
    for (const overlays of [undefined, new Map([[target, '{"greeting":"Overlay"}']])]) {
      await assert.rejects(async () => { const p = await openSdkProject(f.project, overlays); await p.close(); }, /symlink|escape|unsafe/i);
    }
  } finally { await f.cleanup(); await outside.cleanup(); }
});

test('unsaved catalogs drive preview, all-locale collision checks and edit before text', async () => {
  const f = await fixture();
  const en = '{"greeting":"Unsaved {name}","localOnly":"New"}';
  const fr = '{"remoteOnly":"Autre","greeting":"Salut {name}"}';
  try {
    const p = await openSdkProject(f.project, new Map([[path.join(f.root, 'messages/en.json'), en], [path.join(f.root, 'messages/fr.json'), fr]]));
    try {
      assert.equal(p.sourceText, en); assert.equal(await p.preview('greeting'), 'Unsaved {name}');
      assert.ok(p.keys.has('remoteOnly')); assert.ok(!p.keys.has('onlyFrench'));
      await assert.rejects(p.planInsert('remoteOnly', 'Collision'), /exist|collision/i);
      const changes = await p.planRename('greeting', 'salutation');
      assert.equal(changes.find(c => c.path.endsWith('/en.json'))!.before, en);
      assert.equal(changes.find(c => c.path.endsWith('/fr.json'))!.before, fr);
    } finally { await p.close(); }
    await assert.rejects(async () => { const invalid = await openSdkProject(f.project, new Map([[path.join(f.root, 'messages/en.json'), '{ broken']])); await invalid.close(); }, /JSON|import|catalog/i);
  } finally { await f.cleanup(); }
});

test('supports trusted 4.4 export and retains dotted key semantics', async () => {
  const f = await fixture('4.4.0');
  try {
    const p = await openSdkProject(f.project);
    try {
      const changes = await p.planInsert('new.literal', 'Welcome {user}');
      const after = JSON.parse(changes.find(c => c.path === p.sourcePath)!.after);
      assert.equal(after.new.literal, 'Welcome {user}');
      assert.equal(after.literal.dot, 'Dotted');
    } finally { await p.close(); }
  } finally { await f.cleanup(); }
});

test('rejects unknown executable modules and unsafe project settings before SDK loading', async () => {
  const f = await fixture();
  try {
    const cases = [
      { modules: ['https://evil.invalid/plugin.js'] },
      { modules: ['https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@latest/dist/index.js'] },
      { modules: ['https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4.5.0/dist/index.js?evil'] },
      { modules: ['./plugin.js'] },
      { 'plugin.evil': {} },
      { locales: ['en', '../outside'] },
      { baseLocale: 'de' },
      { 'plugin.inlang.messageFormat': { pathPattern: '../outside/{locale}.json' } },
      { 'plugin.inlang.messageFormat': { pathPattern: '/absolute/{locale}.json' } },
      { 'plugin.inlang.messageFormat': { pathPattern: ['./messages/{locale}.json'] } },
      { 'plugin.inlang.messageFormat': { pathPattern: './messages/{locale}.json', unknown: true } },
    ];
    for (const change of cases) {
      await fs.writeFile(path.join(f.project, 'settings.json'), JSON.stringify({ ...f.settings, ...change }));
      await assert.rejects(async () => { const p = await openSdkProject(f.project); await p.close(); }, /unsupported|unsafe|locale|module|plugin|pattern/i, JSON.stringify(change));
    }
  } finally { await f.cleanup(); }
});

test('rename preserves every locale, complex variants and metadata; rejects collisions', async () => {
  const complex = [{ declarations: ['input count'], selectors: ['count'], match: { 'count=1': 'One item', 'count=*': '{count} items' } }];
  const f = await fixture('4.5.0', { en: { '$schema': 'https://inlang.com/schema/inlang-message-format', greeting: complex, untouched: 'Stay' }, fr: { greeting: 'Bonjour {count}', onlyFrench: 'Français' } });
  try {
    const p = await openSdkProject(f.project);
    try {
      await assert.rejects(p.planRename('greeting', 'onlyFrench'), /exist|collision/i);
      const changes = await p.planRename('greeting', 'renamed');
      assert.equal(changes.length, 2);
      const en = JSON.parse(changes.find(c => c.path.endsWith('/en.json'))!.after);
      const fr = JSON.parse(changes.find(c => c.path.endsWith('/fr.json'))!.after);
      assert.equal(en.greeting, undefined); assert.deepEqual(en.renamed, complex);
      assert.equal(en.$schema, 'https://inlang.com/schema/inlang-message-format');
      assert.equal(en.untouched, 'Stay'); assert.equal(fr.renamed, 'Bonjour {count}');
      assert.equal(fr.greeting, undefined); assert.equal(fr.onlyFrench, 'Français');
      assert.equal(await p.preview('renamed'), '{count} items');
      await assert.rejects(p.planRename('absent', 'anything'), /not found|missing/i);
    } finally { await p.close(); }
  } finally { await f.cleanup(); }
});

test('insert exports through the SDK and keeps variables and dotted keys', async () => {
  const f = await fixture();
  try {
    const p = await openSdkProject(f.project);
    try {
      const changes = await p.planInsert('new.literal', 'Welcome {user}');
      assert.equal(changes.length, 1); assert.equal(changes[0].path, p.sourcePath);
      assert.equal(changes[0].before, p.sourceText);
      const after = JSON.parse(changes[0].after);
      assert.equal(after.new.literal, 'Welcome {user}');
      assert.equal(after['literal.dot'], 'Dotted');
      assert.equal(after.greeting, 'Hello {name}');
      assert.equal(await fs.readFile(p.sourcePath, 'utf8'), p.sourceText);
      await assert.rejects(p.planInsert('onlyFrench', 'Collision'), /exist|collision/i);
    } finally { await p.close(); }
  } finally { await f.cleanup(); }
});

test('opens official SDK with base preview, variables and literal dotted keys', async () => {
  const f = await fixture();
  try {
    const p = await openSdkProject(f.project);
    try {
      assert.equal(p.rootPath, f.root); assert.equal(p.projectPath, f.project);
      assert.equal(p.baseLocale, 'en'); assert.equal(p.sourcePath, path.join(f.root, 'messages/en.json'));
      assert.equal(p.sourceText, await fs.readFile(p.sourcePath, 'utf8'));
      assert.equal(await p.preview('greeting'), 'Hello {name}');
      assert.equal(await p.preview('literal.dot'), 'Dotted');
      assert.equal(await p.preview('missing'), undefined);
      assert.ok(p.keys.has('onlyFrench'));
    } finally { await p.close(); }
  } finally { await f.cleanup(); }
});
