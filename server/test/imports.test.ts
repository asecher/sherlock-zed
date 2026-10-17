import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planExtraction } from '../src/syntax.ts';

test('adds a configured import when no translation binding exists', () => {
  const source = 'const view = <p>Hello</p>;';
  const start = source.indexOf('Hello');
  const plan = planExtraction('file:///page.tsx', source, start, start + 5, 'hello', { module: './i18n.ts', kind: 'named' });
  assert.equal(plan?.message, 'Hello');
  assert.ok(plan?.edits.some(edit => edit.newText.includes('import { m } from "./i18n.ts";')));
  assert.ok(plan?.edits.some(edit => edit.newText === '{m.hello()}'));
});

test('does not extract through a shadowed imported translation binding', () => {
  const source = "import { m } from './i18n.ts';\nfunction x(m: number) { return <p>Hello</p>; }";
  const start = source.indexOf('Hello');
  assert.equal(planExtraction('file:///page.tsx', source, start, start + 5, 'hello'), undefined);
});
