import type { BundledMerchant } from '@expanses/catalog';
import { describe, expect, it } from 'vitest';
import { bundledRows, merchantOutcome, mineRows, patternAsName } from './merchant-rows';

const bundled: BundledMerchant[] = [
  { pattern: 'mcdonald', mcc: '5814', name: "McDonald's", basis: 'typical' },
  { pattern: 'kfc', mcc: '5814', name: 'KFC', basis: 'typical' },
  { pattern: 'pertamina', mcc: '5541', name: 'Pertamina', basis: 'typical' },
];

describe('bundledRows', () => {
  it('marks bundled merchants as typical, yours, or ignored and sorts by name', () => {
    const rows = bundledRows(bundled, [{ pattern: 'kfc', mcc: '5812' }, { pattern: 'pertamina', mcc: null }], '');
    expect(rows.map((r) => [r.name, r.status, r.yourMcc])).toEqual([
      ['KFC', 'yours', '5812'],
      ["McDonald's", 'typical', null],
      ['Pertamina', 'ignored', null],
    ]);
  });

  it('searches names, patterns, and codes by every word', () => {
    expect(bundledRows(bundled, [], 'mcd').map((r) => r.pattern)).toEqual(['mcdonald']);
    expect(bundledRows(bundled, [], '5814').map((r) => r.pattern)).toEqual(['kfc', 'mcdonald']);
    expect(bundledRows(bundled, [], 'fuel')).toEqual([]);
  });
});

describe('mineRows', () => {
  const memory = [
    { id: 'a', pattern: 'warung bunda', mcc: '5812' },
    { id: 'b', pattern: 'pertamina', mcc: null },
    { id: 'c', pattern: 'bengkel', mcc: '7538' },
  ];

  it("names an entry after the typical merchant sharing its text, else its own text capitalised, sorted by name", () => {
    expect(mineRows(memory, bundled, '').map((r) => [r.name, r.typical?.pattern ?? null])).toEqual([
      ['Bengkel', null],
      ['Pertamina', 'pertamina'],
      ['Warung Bunda', null],
    ]);
  });

  it('searches the name, the matched text and the code', () => {
    expect(mineRows(memory, bundled, 'Perta').map((r) => r.entry.id)).toEqual(['b']);
    expect(mineRows(memory, bundled, '7538').map((r) => r.entry.id)).toEqual(['c']);
    expect(mineRows(memory, bundled, 'warung 5812').map((r) => r.entry.id)).toEqual(['a']);
    expect(mineRows(memory, bundled, 'kfc')).toEqual([]);
  });
});

describe('merchantOutcome', () => {
  it('cannot save without a name, or with a code that is not four digits', () => {
    expect(merchantOutcome({ pattern: '  ', mcc: '5814', useTypical: true }, bundled)).toBeNull();
    expect(merchantOutcome({ pattern: 'warung', mcc: '58', useTypical: true }, bundled)).toBeNull();
  });

  it('needs a code for a merchant with no typical one, and keeps the text as the repository will', () => {
    expect(merchantOutcome({ pattern: 'warung', mcc: '', useTypical: true }, bundled)).toBeNull();
    expect(merchantOutcome({ pattern: '  Warung   Bunda ', mcc: '5812', useTypical: false }, bundled)).toEqual({
      kind: 'save',
      entry: { id: undefined, pattern: 'warung bunda', mcc: '5812' },
    });
  });

  it('switch off ignores the typical code, whatever code is typed', () => {
    expect(merchantOutcome({ pattern: 'KFC', mcc: '5814', useTypical: false }, bundled)).toEqual({ kind: 'save', entry: { id: undefined, pattern: 'kfc', mcc: null } });
    expect(merchantOutcome({ id: 'x', pattern: 'kfc', mcc: '', useTypical: false }, bundled)).toEqual({ kind: 'save', entry: { id: 'x', pattern: 'kfc', mcc: null } });
  });

  it('switch on with the typical code needs no entry: nothing new, and an existing one is forgotten', () => {
    expect(merchantOutcome({ pattern: 'kfc', mcc: '5814', useTypical: true }, bundled)).toEqual({ kind: 'none' });
    expect(merchantOutcome({ pattern: 'kfc', mcc: '', useTypical: true }, bundled)).toEqual({ kind: 'none' });
    expect(merchantOutcome({ id: 'x', pattern: 'kfc', mcc: '5814', useTypical: true }, bundled)).toEqual({ kind: 'forget', id: 'x' });
  });

  it('a different code on a typical merchant makes it the owner’s', () => {
    expect(merchantOutcome({ pattern: 'kfc', mcc: '5812', useTypical: true }, bundled)).toEqual({ kind: 'save', entry: { id: undefined, pattern: 'kfc', mcc: '5812' } });
    expect(merchantOutcome({ id: 'x', pattern: 'kfc', mcc: '5812', useTypical: true }, bundled)).toEqual({ kind: 'save', entry: { id: 'x', pattern: 'kfc', mcc: '5812' } });
  });
});

describe('patternAsName', () => {
  it('starts each word with a capital and keeps the rest as typed', () => {
    expect(patternAsName('kedai senja')).toBe('Kedai Senja');
    expect(patternAsName('grab* food')).toBe('Grab* Food');
    expect(patternAsName('')).toBe('');
  });
});
