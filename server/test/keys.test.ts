import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKey } from '../src/keys.ts';

test('generates valid deterministic keys with collision protection', () => {
  assert.equal(generateKey('Hello world!', new Set()), 'hello_world');
  assert.equal(generateKey('42 things', new Set()), 'message_42_things');
  assert.equal(generateKey('Hello world', new Set(['hello_world', 'hello_world_2'])), 'hello_world_3');
  assert.match(generateKey('你好 👋', new Set()), /^[A-Za-z_$][\w$]*$/);
});

test('avoids reserved catalog keys and occupied dotted namespaces', () => {
  assert.equal(generateKey('constructor', new Set()), 'message_constructor');
  assert.equal(generateKey('prototype', new Set()), 'message_prototype');
  assert.equal(generateKey('Hello', new Set(['hello.child', 'hello_2.child'])), 'hello_3');
});
