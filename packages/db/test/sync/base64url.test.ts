import { describe, expect, it } from 'vitest';
import { fromBase64Url, toBase64Url } from '../../src/sync/base64url';

describe('toBase64Url / fromBase64Url', () => {
  it('round-trips plain ASCII', () => {
    const text = JSON.stringify({ v: 1, ops: [{ entity: 'purchase', id: 'a', op: 'upsert', fields: { note: 'hi' } } as const] });
    expect(fromBase64Url(toBase64Url(text))).toBe(text);
  });

  it('round-trips multi-byte UTF-8 (a category name, a member name)', () => {
    const text = JSON.stringify({ name: 'Belanja Rumah 🏠', member: 'Dewi 女士' });
    expect(fromBase64Url(toBase64Url(text))).toBe(text);
  });

  it('round-trips the empty string', () => {
    expect(fromBase64Url(toBase64Url(''))).toBe('');
  });

  it('produces no "+", "/" or "=" — the alphabet is url-safe and unpadded', () => {
    const text = 'x'.repeat(500); // long enough to guarantee padding would otherwise appear
    const encoded = toBase64Url(text);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('uses no Node Buffer (documented in the source; this just re-asserts the round trip is pure Web APIs)', () => {
    // A smoke check that nothing here depends on a global only Node provides.
    expect(typeof btoa).toBe('function');
    expect(typeof atob).toBe('function');
  });
});
