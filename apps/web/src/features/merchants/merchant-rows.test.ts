import type { BundledMerchant } from '@expanses/catalog';
import { describe, expect, it } from 'vitest';
import { bundledRows } from './merchant-rows';

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
