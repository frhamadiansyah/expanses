import { describe, expect, it } from 'vitest';
import { goldBrandMatches } from '../src/index';

describe('goldBrandMatches', () => {
  it('offers makers by name or a shorter name, Indonesia’s only in a rupiah workspace', () => {
    expect(goldBrandMatches('an', true).map((b) => b.name)).toEqual(['Antam']);
    expect(goldBrandMatches('logam', true).map((b) => b.name)).toEqual(['Antam']);
    expect(goldBrandMatches('an', false)).toEqual([]);
    expect(goldBrandMatches('pamp', false).map((b) => b.name)).toEqual(['PAMP Suisse']);
    expect(goldBrandMatches('perth', true).map((b) => b.name)).toEqual(['Perth Mint']);
  });

  it('offers nothing for an empty field or a name already typed in full', () => {
    expect(goldBrandMatches('', true)).toEqual([]);
    expect(goldBrandMatches('Antam', true)).toEqual([]);
  });
});
