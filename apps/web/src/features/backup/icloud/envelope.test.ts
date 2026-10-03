import { describe, expect, it } from 'vitest';
import { keyIdOf, NotACopyError, seal, unseal } from './envelope';

const key = { keyId: 'k-1', raw: crypto.getRandomValues(new Uint8Array(32)) };
const database = new Uint8Array(200).map((_, i) => i % 251);
const contents = {
  database,
  summary: { takenAt: '2026-10-02T00:12:00.000Z', model: 'iPhone', accounts: 14, transactions: 3218, photos: 1 },
  photos: [{ name: 'abc.jpg', bytes: new Uint8Array([1, 2, 3]) }],
};

describe('the iCloud envelope', () => {
  it('opens to exactly what was sealed', async () => {
    const sealed = await seal(contents, key);
    expect(keyIdOf(sealed)).toBe('k-1');
    expect(await unseal(sealed, key.raw)).toEqual(contents);
  });

  it('does not carry the figures in the clear', async () => {
    const sealed = await seal({ ...contents, database: new TextEncoder().encode('SQLite format 3\0 Jenius BCA'.padEnd(200, '.')) }, key);
    expect(new TextDecoder().decode(sealed)).not.toContain('Jenius');
    expect(new TextDecoder().decode(sealed)).not.toContain('3218');
  });

  it('refuses the wrong key', async () => {
    const sealed = await seal(contents, key);
    await expect(unseal(sealed, crypto.getRandomValues(new Uint8Array(32)))).rejects.toBeInstanceOf(NotACopyError);
  });

  it('refuses a header that was changed, so a copy cannot be relabelled', async () => {
    const sealed = await seal(contents, key);
    const tampered = sealed.slice();
    const at = new TextDecoder().decode(tampered).indexOf('2026-10-02');
    tampered[at + 3] = '5'.charCodeAt(0);
    await expect(unseal(tampered, key.raw)).rejects.toBeInstanceOf(NotACopyError);
  });

  it('refuses a file that is not a copy', async () => {
    await expect(unseal(new TextEncoder().encode('SQLite format 3'), key.raw)).rejects.toBeInstanceOf(NotACopyError);
  });

  it('drops a photo whose name could reach outside the photo folder', async () => {
    const sealed = await seal({ ...contents, photos: [{ name: '../escape.jpg', bytes: new Uint8Array([9]) }, { name: 'ok.png', bytes: new Uint8Array([8]) }] }, key);
    expect((await unseal(sealed, key.raw)).photos.map((p) => p.name)).toEqual(['ok.png']);
  });
});
