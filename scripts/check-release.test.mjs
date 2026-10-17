import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRelease } from './check-release.mjs';

const base = { packageVersion: '0.1.0', cargoVersion: '0.1.0', extensionVersion: '0.1.0', target: 'darwin-arm64', expectedTarget: 'darwin-arm64', refType: 'tag', refName: 'v0.1.0' };

test('release checks require identical stable package, extension, crate and tag versions', () => {
  assert.equal(validateRelease(base), 'v0.1.0');
  assert.throws(() => validateRelease({ ...base, cargoVersion: '0.2.0' }), /version/i);
  assert.throws(() => validateRelease({ ...base, extensionVersion: '0.2.0' }), /version/i);
  assert.throws(() => validateRelease({ ...base, refName: 'v0.2.0' }), /tag/i);
  assert.throws(() => validateRelease({ ...base, packageVersion: '0.1.0-rc.1' }), /stable/i);
});

test('release checks refuse a mislabeled or unsupported native platform', () => {
  assert.throws(() => validateRelease({ ...base, target: 'darwin-x64' }), /platform|target/i);
  assert.throws(() => validateRelease({ ...base, target: 'win32-arm64', expectedTarget: 'win32-arm64' }), /support/i);
  assert.equal(validateRelease({ ...base, refType: 'branch', refName: 'main' }), 'v0.1.0');
});
