import { describe, expect, it } from 'vitest';
import { MERCHANTS, validateMerchants } from '../src/index';

describe('bundled merchants', () => {
  it('validates the bundled list', () => {
    expect(validateMerchants(MERCHANTS)).toEqual([]);
    expect(MERCHANTS.merchants.find((m) => m.pattern === 'mcdonald')?.mcc).toBe('5814');
  });

  it('rejects duplicate or untrimmed patterns, bad codes, and a missing basis', () => {
    const errors = validateMerchants({
      version: 1,
      verifiedOn: '2026-09-11',
      merchants: [
        { pattern: 'kfc', mcc: '5814', name: 'KFC', basis: 'typical' },
        { pattern: 'kfc', mcc: '5814', name: 'KFC', basis: 'typical' },
        { pattern: 'Starbucks ', mcc: '5814', name: 'Starbucks', basis: 'typical' },
        { pattern: 'shell', mcc: '554', name: 'Shell', basis: 'typical' },
        { pattern: 'grab', mcc: '4121', name: 'Grab', basis: '' },
      ],
    });
    for (const pattern of [/merchants\[1\].*duplicate/, /merchants\[2\].*lowercase/, /merchants\[3\]\.mcc/, /merchants\[4\]\.basis/]) {
      expect(errors.some((e) => pattern.test(e)), `${pattern} in ${errors.join(' | ')}`).toBe(true);
    }
    expect(validateMerchants(null)).toEqual(['merchant list: must be an object']);
  });
});
