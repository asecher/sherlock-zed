import { test } from 'node:test';
import assert from 'node:assert/strict';
import { references, planExtraction } from '../src/syntax.ts';

test('rejects syntax positions that cannot be safely replaced with a message call', () => {
  const header = "import { m } from './i18n.ts';\n";
  for (const [body, selection] of [
    ['type X = "Hello";', '"Hello"'],
    ['const x = { "Hello": 1 };', '"Hello"'],
    ['const x = <p className="Hello"/>;', '"Hello"'],
    ['const x = m.greeting("Hello");', '"Hello"'],
    ['const x = `Hello ${name}`;', 'Hello'],
    ['const x = <p>Hello world</p>;', 'world'],
  ]) {
    const source = header + body;
    const start = source.indexOf(selection);
    assert.equal(planExtraction('file:///page.tsx', source, start, start + selection.length, 'key'), undefined, body);
  }
});

test('does not match a local parameter shadowing an imported m binding', () => {
  const source = "import { m } from './i18n.ts';\nfunction f(m: any) { return m.not_a_message(); }\nconst a = m.real();";
  assert.deepEqual(references('file:///page.tsx', source).map(r => r.key), ['real']);
});
