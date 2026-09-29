import { describe, expect, it } from 'vitest';
import { bankMatches } from '../src/coretax/banks';

describe('bankMatches', () => {
  it('offers nothing before a letter is typed', () => {
    expect(bankMatches('')).toEqual([]);
  });
  it('finds a bank by the name people call it', () => {
    expect(bankMatches('bca').map((b) => b.name)).toEqual(['Bank Central Asia', 'BCA Syariah', 'BCA Digital']);
    expect(bankMatches('jenius').map((b) => b.name)).toEqual(['Bank SMBC Indonesia']);
  });
  it('puts short names before words of the full name', () => {
    expect(bankMatches('ma').map((b) => b.name).slice(0, 2)).toEqual(['Bank Mandiri', 'Maybank Indonesia']);
    expect(bankMatches('rakyat').map((b) => b.name)).toEqual(['Bank Rakyat Indonesia']);
  });
  it('offers nothing once the whole name is typed', () => {
    expect(bankMatches('Bank Mandiri')).toEqual([]);
  });
});
