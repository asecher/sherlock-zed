import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

async function fixture() {
  const scratch = join(homedir(), '.hermes/cache/scratch');
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'sherlock-release-test-'));
  const stage = join(root, 'stage');
  for (const dir of ['server/dist', 'node_modules/tiny', 'node_modules/.bin']) await mkdir(join(stage, dir), { recursive: true });
  for (const [file, text] of Object.entries({ 'package.json': '{"type":"module","name":"sherlock-language-server","version":"0.1.0","engines":{"node":">=24.0.0"}}', 'server/dist/main.js': 'import "./sibling.js";', 'server/dist/sibling.js': 'export {};', 'node_modules/tiny/LICENSE': 'fixture license', 'node_modules/tiny/runtime.wasm': 'fixture wasm' })) await writeFile(join(stage, file), text);
  await symlink('../tiny/LICENSE', join(stage, 'node_modules/.bin/tiny'));
  return { root, stage, output: join(root, 'out') };
}

test('packages a root-level runtime tree, manifest and matching checksum without bin links', async () => {
  const f = await fixture();
  try {
    const { packageRelease } = await import('./build-release.mjs');
    const result = await packageRelease({ ...f, version: '0.1.0' });
    assert.equal(result.archive, join(f.output, `sherlock-language-server-v0.1.0-${process.platform}-${process.arch}.tar.gz`));
    const listing = execFileSync('tar', ['-tzf', result.archive], { encoding: 'utf8' });
    assert.match(listing, /server\/dist\/sibling.js/);
    assert.match(listing, /node_modules\/tiny\/runtime.wasm/);
    assert.match(listing, /node_modules\/tiny\/LICENSE/);
    assert.doesNotMatch(listing, /\.bin/);
    const dest = join(f.root, 'extracted'); await mkdir(dest);
    execFileSync('tar', ['-xzf', result.archive, '-C', dest]);
    assert.deepEqual(JSON.parse(await readFile(join(dest, 'release.json'), 'utf8')), { format: 1, name: 'sherlock-language-server', version: '0.1.0', os: process.platform, arch: process.arch, nodeMajor: 24, entrypoint: 'server/dist/main.js' });
    const hash = createHash('sha256').update(await readFile(result.archive)).digest('hex');
    assert.equal(await readFile(result.archive + '.sha256', 'utf8'), `${hash}  ${result.archive.split('/').at(-1)}\n`);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('buildRelease stages pinned production packages and validates source metadata', async () => {
  const { buildRelease } = await import('./build-release.mjs');
  assert.equal(typeof buildRelease, 'function', 'production staging entry point is required');
  const f = await fixture();
  try {
    const pkg = { name: 'fixture-dev', version: '0.1.0', type: 'module', engines: { node: '>=24.0.0' }, private: true };
    await writeFile(join(f.stage, 'package.json'), JSON.stringify(pkg));
    await writeFile(join(f.stage, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages: { '': pkg } }));
    await writeFile(join(f.stage, 'Cargo.toml'), '[package]\nname = "fixture"\nversion = "0.1.0"\n');
    await writeFile(join(f.stage, 'extension.toml'), 'id = "fixture"\nversion = "0.1.0"\n');
    await assert.rejects(buildRelease({ root: f.stage, output: f.output, os: 'not-this-host' }), /host|target/i);
    await assert.rejects(buildRelease({ root: f.stage, output: f.output, arch: 'not-this-host' }), /host|target/i);
    const result = await buildRelease({ root: f.stage, output: f.output });
    assert.match(execFileSync('tar', ['-xOf', result.archive, 'package.json'], { encoding: 'utf8' }), /sherlock-language-server/);
    const names = execFileSync('tar', ['-tzf', result.archive], { encoding: 'utf8' });
    assert.doesNotMatch(names, /tiny|Cargo.toml|extension.toml/);
    await writeFile(join(f.stage, 'extension.toml'), 'version = "9.0.0"\n');
    await assert.rejects(buildRelease({ root: f.stage, output: f.output }), /version/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('isolated smoke refuses a corrupt archive before launching anything', async () => {
  const { smokeRelease } = await import('./smoke-release.mjs');
  const f = await fixture();
  try {
    const archive = join(f.root, 'corrupt.tar.gz');
    await writeFile(archive, 'not an archive');
    await writeFile(archive + '.sha256', `${'0'.repeat(64)}  corrupt.tar.gz\n`);
    await assert.rejects(smokeRelease(archive), /checksum/i);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('rejects dependency symlinks and hard links instead of shipping unsafe entries', async () => {
  const { packageRelease } = await import('./build-release.mjs');
  const { link } = await import('node:fs/promises');
  for (const kind of ['symbolic', 'hard']) {
    const f = await fixture();
    try {
      if (kind === 'symbolic') await symlink('LICENSE', join(f.stage, 'node_modules/tiny/link'));
      else await link(join(f.stage, 'node_modules/tiny/LICENSE'), join(f.stage, 'node_modules/tiny/link'));
      await assert.rejects(packageRelease({ ...f, version: '0.1.0' }), /link/i);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
