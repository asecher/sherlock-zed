import { test } from 'node:test';
import assert from 'node:assert/strict';
import { references, planExtraction } from '../src/syntax.ts';

test('extracts complete string literals with decoded escapes in JS and JSX attributes', () => {
  const header = "import { m } from './i18n.ts';\n";
  for (const [body, selected, replacement, message] of [
    ["const label = 'Hello\\nWorld';", "'Hello\\nWorld'", 'm.greeting()', 'Hello\nWorld'],
    ['const view = <button title="Hello"/>;', '"Hello"', '{m.greeting()}', 'Hello'],
    ['const view = <p>{"Hello"}</p>;', '"Hello"', 'm.greeting()', 'Hello'],
  ]) {
    const source = header + body;
    const start = source.indexOf(selected);
    const plan = planExtraction('file:///page.tsx', source, start, start + selected.length, 'greeting');
    assert.equal(plan?.message, message);
    assert.equal(plan?.edits[0].newText, replacement);
  }
});
