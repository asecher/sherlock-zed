import { test } from 'node:test';
import assert from 'node:assert/strict';
import { references, planExtraction } from '../src/syntax.ts';

test('references use namespace .js and named wrapper imports, not comments or strings', () => {
  const source = `import * as tr from './paraglide/messages.js';
import { m as msg } from './i18n.ts';
const a = tr.welcome(); const b = msg["key.with.dots"]();
// tr.fake()
const s = "msg.fake()";`;
  assert.deepEqual(references('file:///page.tsx', source).map(r => r.key), ['welcome', 'key.with.dots']);
 });

test('extracts JSX text using the imported symbol even before its first use', () => {
  for (const header of ["import * as m from './paraglide/messages.js';", "import { m } from './i18n.ts';", "import { m as tr } from './i18n.ts';"]) {
    const text = header + '\nconst view = <h2>Get started</h2>;';
    const start = text.indexOf('Get started');
    const plan = planExtraction('file:///page.tsx', text, start, start + 11, 'get_started');
    assert.equal(plan?.message, 'Get started');
    assert.equal(plan?.edits[0].newText, header.includes('as tr') ? '{tr.get_started()}' : '{m.get_started()}');
  }
});
