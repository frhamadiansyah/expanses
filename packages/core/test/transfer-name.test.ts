import { describe, expect, it } from 'vitest';
import { transferName, transferSideOf } from '../src';

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

  it('reads money into a credit card as a Credit card payment', () => {
    for (const from of ['bank', 'savings', 'time_deposit', 'ewallet', 'emoney', 'other_cash', 'cash']) {
      expect(transferName(side(from), side('credit_card'))).toBe('Credit card payment');
    }
    // a card in dollars paid from rupiah
    expect(transferName(side('bank', 'IDR'), side('credit_card', 'USD'))).toBe('Credit card payment');
  });

  it('reads a bank account into a bank account as a Bank transfer, in any currency', () => {
    expect(transferName(side('bank'), side('bank'))).toBe('Bank transfer');
    expect(transferName(side('bank'), side('savings'))).toBe('Bank transfer');
    expect(transferName(side('savings'), side('bank'))).toBe('Bank transfer');
    expect(transferName(side('bank', 'IDR'), side('bank', 'USD'))).toBe('Bank transfer');
  });

  it('leaves everything else unnamed', () => {
    // a top-up of an e-wallet, and an e-wallet back into a bank
    expect(transferName(side('bank'), side('ewallet'))).toBeNull();
    expect(transferName(side('ewallet'), side('bank'))).toBeNull();
    expect(transferName(side('bank'), side('time_deposit'))).toBeNull();
    expect(transferName(side('cash', 'IDR'), side('cash', 'IDR'))).toBeNull();
    expect(transferName(side('credit_card'), side('bank'))).toBeNull();
    expect(transferName(side('credit_card'), side('cash'))).toBeNull();
    expect(transferName(side('credit_card'), side('credit_card'))).toBeNull();
    expect(transferName(side('bank'), side('loan'))).toBeNull();
    expect(transferName(side('bank'), side('stock'))).toBeNull();
    expect(transferName(side('bank'), side('fund'))).toBeNull();
    expect(transferName(null, side('cash'))).toBeNull();
  });
});

describe('transferSideOf', () => {
  it('reads an ordinary line by its account', () => {
    expect(transferSideOf({ accountSubtype: 'bank', currency: 'IDR' })).toEqual({ subtype: 'bank', currency: 'IDR' });
    expect(transferSideOf({ currency: 'IDR' })).toEqual({ subtype: '', currency: 'IDR' });
  });

  it('reads a household placeholder by the partner’s item it stands for, never by its own cash subtype', () => {
    expect(transferSideOf({ accountSubtype: 'cash', currency: 'IDR', placeholder: true, partnerSubtype: 'bank' })).toEqual({ subtype: 'bank', currency: 'IDR', partner: true });
    expect(transferSideOf({ accountSubtype: 'cash', currency: 'IDR', placeholder: true })).toBeNull();
    expect(transferSideOf({ accountSubtype: 'cash', currency: 'IDR', placeholder: true, partnerSubtype: null })).toBeNull();
  });

  it('names a partner side only by a bank, a saving account or a card: handing a partner cash is no withdrawal', () => {
    const bank = transferSideOf({ accountSubtype: 'bank', currency: 'IDR' });
    const cash = transferSideOf({ accountSubtype: 'cash', currency: 'IDR' });
    for (const partnerSubtype of ['cash', 'ewallet', 'emoney', 'other_cash', 'time_deposit', 'loan']) {
      const partner = transferSideOf({ accountSubtype: 'cash', currency: 'IDR', placeholder: true, partnerSubtype });
      expect(partner).toBeNull();
      expect(transferName(bank, partner)).toBeNull();
      expect(transferName(partner, bank)).toBeNull();
      expect(transferName(cash, partner)).toBeNull();
    }
    // cash or a wallet into a partner's bank is handed over, not deposited; a partner's bank into this phone's cash is no withdrawal
    const partnerBank = transferSideOf({ accountSubtype: 'cash', currency: 'IDR', placeholder: true, partnerSubtype: 'bank' });
    expect(transferName(cash, partnerBank)).toBeNull();
    expect(transferName(partnerBank, cash)).toBeNull();
    expect(transferName(transferSideOf({ accountSubtype: 'ewallet', currency: 'IDR' }), partnerBank)).toBeNull();
    // cash into a partner's card is still the card paid
    expect(transferName(cash, transferSideOf({ accountSubtype: 'cash', currency: 'IDR', placeholder: true, partnerSubtype: 'credit_card' }))).toBe('Credit card payment');
  });

  it('a bank into a partner’s placeholder is never a Cash withdrawal', () => {
    const bank = transferSideOf({ accountSubtype: 'bank', currency: 'IDR' });
    expect(transferName(bank, transferSideOf({ accountSubtype: 'cash', currency: 'IDR', placeholder: true }))).toBeNull();
    expect(transferName(bank, transferSideOf({ accountSubtype: 'cash', currency: 'IDR', placeholder: true, partnerSubtype: 'savings' }))).toBe('Bank transfer');
    expect(transferName(bank, transferSideOf({ accountSubtype: 'cash', currency: 'IDR', placeholder: true, partnerSubtype: 'credit_card' }))).toBe('Credit card payment');
  });
});
