import { describe, expect, it } from 'vitest';
import { transferName } from '../src';

const side = (subtype: string, currency = 'IDR') => ({ subtype, currency });

describe('transferName', () => {
  it('reads a bank or e-wallet into Cash as a Cash withdrawal, in any currency', () => {
    expect(transferName(side('bank'), side('cash'))).toBe('Cash withdrawal');
    expect(transferName(side('savings'), side('cash'))).toBe('Cash withdrawal');
    expect(transferName(side('ewallet'), side('cash'))).toBe('Cash withdrawal');
    expect(transferName(side('emoney'), side('cash'))).toBe('Cash withdrawal');
    // the ATM abroad: a rupiah bank account into lira cash
    expect(transferName(side('bank', 'IDR'), side('cash', 'TRY'))).toBe('Cash withdrawal');
  });

  it('reads Cash into Cash in another currency as a Currency exchange', () => {
    expect(transferName(side('cash', 'IDR'), side('cash', 'TRY'))).toBe('Currency exchange');
  });

  it('reads Cash into a bank or e-wallet as a Cash deposit', () => {
    expect(transferName(side('cash'), side('bank'))).toBe('Cash deposit');
    expect(transferName(side('cash', 'TRY'), side('ewallet'))).toBe('Cash deposit');
  });

  it('leaves everything else as it is today', () => {
    expect(transferName(side('bank'), side('bank'))).toBeNull();
    expect(transferName(side('bank'), side('ewallet'))).toBeNull();
    expect(transferName(side('cash', 'IDR'), side('cash', 'IDR'))).toBeNull();
    expect(transferName(side('credit_card'), side('bank'))).toBeNull();
    expect(transferName(side('credit_card'), side('cash'))).toBeNull();
    expect(transferName(side('cash'), side('credit_card'))).toBeNull();
    expect(transferName(side('bank'), side('loan'))).toBeNull();
    expect(transferName(side('bank'), side('stock'))).toBeNull();
    expect(transferName(null, side('cash'))).toBeNull();
  });
});
