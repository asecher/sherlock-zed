export function generateKey(text: string, existing: ReadonlySet<string>): string {
  let base = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'message';
  if (!/^[a-z_$]/.test(base) || ['constructor', 'prototype', '__proto__', '$schema'].includes(base)) base = `message_${base}`;
  const occupied = (key: string) => existing.has(key) || [...existing].some(value => value.startsWith(key + '.'));
  if (!occupied(base)) return base;
  for (let n = 2; n < 100_000; n++) {
    const candidate = `${base}_${n}`;
    if (!occupied(candidate)) return candidate;
  }
  throw new Error('Could not generate an unused message key');
}
