import { describe, expect, it } from 'vitest';
import { fundNamesFooter } from './fund-names';

describe('the sentence under a Fund account’s two names', () => {
  it('names both places by the names given', () => {
    expect(fundNamesFooter('Mirae Sekuritas', 'CIMB Niaga')).toBe('Shown as CIMB Niaga in Money; as Mirae Sekuritas on stocks, funds and their tax lines.');
  });

  it('says the broker stands in Money until a custodian bank is named', () => {
    expect(fundNamesFooter('Mirae Sekuritas', '  ')).toBe('Shown as Mirae Sekuritas in Money until a custodian bank is named; as Mirae Sekuritas on stocks, funds and their tax lines.');
  });

  it('falls back to general words when neither is given', () => {
    expect(fundNamesFooter('', '')).toBe('Shown as the broker in Money until a custodian bank is named; as the broker on stocks, funds and their tax lines.');
  });
});
