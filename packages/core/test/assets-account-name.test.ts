import { describe, expect, it } from 'vitest';
import { accountDisplayName, cashCodeForSubtype, cashItem, CASH_ITEMS, shortBankName } from '../src/index';

describe('an account is shown with its bank', () => {
  it('puts the bank in front of the name typed', () => {
    expect(accountDisplayName({ name: 'Xpresi', subtype: 'savings', bank: 'Mandiri' })).toBe('Mandiri Xpresi');
    expect(accountDisplayName({ name: 'Payroll', subtype: 'bank', bank: 'Hanseatic Bank' })).toBe('Hanseatic Bank Payroll');
    expect(accountDisplayName({ name: 'Six months', subtype: 'time_deposit', bank: 'Bank Jago' })).toBe('Jago Six months');
  });

  it('calls a bank on the list by its short name', () => {
    expect(accountDisplayName({ name: 'Xpresi', subtype: 'savings', bank: 'Bank Mandiri' })).toBe('Mandiri Xpresi');
    expect(accountDisplayName({ name: 'Tahapan', subtype: 'bank', bank: 'Bank Central Asia' })).toBe('BCA Tahapan');
    expect(shortBankName('bank mandiri')).toBe('Mandiri');
    expect(shortBankName('SeaBank')).toBe('SeaBank');
    expect(shortBankName(' Volksbank ')).toBe('Volksbank');
  });

  it('never says the bank twice', () => {
    expect(accountDisplayName({ name: 'Mandiri Xpresi', subtype: 'savings', bank: 'Mandiri' })).toBe('Mandiri Xpresi');
    expect(accountDisplayName({ name: 'mandiri xpresi', subtype: 'savings', bank: 'Mandiri' })).toBe('mandiri xpresi');
    expect(accountDisplayName({ name: 'Mandiri Xpresi', subtype: 'savings', bank: 'Bank Mandiri' })).toBe('Mandiri Xpresi');
    expect(accountDisplayName({ name: 'Bank Mandiri Xpresi', subtype: 'savings', bank: 'Bank Mandiri' })).toBe('Bank Mandiri Xpresi');
    expect(accountDisplayName({ name: 'BCA Tahapan', subtype: 'bank', bank: 'Bank Central Asia' })).toBe('BCA Tahapan');
    expect(accountDisplayName({ name: 'Mandiri', subtype: 'bank', bank: 'Mandiri' })).toBe('Mandiri');
    // A pocket's stored name is its account's and its currency: the bank goes in front of both, once.
    expect(accountDisplayName({ name: 'Xpresi · USD', subtype: 'savings', bank: 'Mandiri' })).toBe('Mandiri Xpresi · USD');
  });

  it('matches only a whole word at the front', () => {
    expect(accountDisplayName({ name: 'Mandirian', subtype: 'savings', bank: 'Mandiri' })).toBe('Mandiri Mandirian');
    expect(accountDisplayName({ name: 'Joint Mandiri', subtype: 'savings', bank: 'Mandiri' })).toBe('Mandiri Joint Mandiri');
    expect(accountDisplayName({ name: 'Mandiri-Xpresi', subtype: 'savings', bank: 'Mandiri' })).toBe('Mandiri-Xpresi');
  });

  it('leaves an account with no bank as it is called', () => {
    expect(accountDisplayName({ name: 'Xpresi', subtype: 'savings' })).toBe('Xpresi');
    expect(accountDisplayName({ name: 'Xpresi', subtype: 'savings', bank: null })).toBe('Xpresi');
    expect(accountDisplayName({ name: 'Xpresi', subtype: 'savings', bank: '  ' })).toBe('Xpresi');
    expect(accountDisplayName({ name: 'Pocket money', subtype: 'cash', bank: 'Mandiri' })).toBe('Pocket money');
  });

  it('names a credit card by its issuer and its name, and an older card saved whole as it was', () => {
    // The new card form keeps the issuer apart: "BCA" and "UnionPay", "Mandiri" and "Signature".
    expect(accountDisplayName({ name: 'UnionPay', subtype: 'credit_card', bank: 'BCA' })).toBe('BCA UnionPay');
    expect(accountDisplayName({ name: 'Signature', subtype: 'credit_card', bank: 'Mandiri' })).toBe('Mandiri Signature');
    // A long official name, from the bank list or the catalogue, by the short one the list knows.
    expect(accountDisplayName({ name: 'Everyday Rewards', subtype: 'credit_card', bank: 'Bank Central Asia' })).toBe('BCA Everyday Rewards');
    expect(accountDisplayName({ name: 'Visa Infinite', subtype: 'credit_card', bank: 'Bank DBS Indonesia' })).toBe('DBS Visa Infinite');
    expect(accountDisplayName({ name: 'Garuda', subtype: 'credit_card', bank: 'Bank BNI' })).toBe('BNI Garuda');
    expect(shortBankName('Bank OCBC NISP')).toBe('OCBC');
    // A bank the list does not know is shown as stored.
    expect(accountDisplayName({ name: 'Garuda x bluDebit Card', subtype: 'credit_card', bank: 'blu by BCA Digital' })).toBe('blu by BCA Digital Garuda x bluDebit Card');
    // Saved whole before the form split them, or named by another of its bank's names: once.
    expect(accountDisplayName({ name: 'Mandiri Signature', subtype: 'credit_card', bank: 'Mandiri' })).toBe('Mandiri Signature');
    expect(accountDisplayName({ name: 'BCA Singapore Airlines KrisFlyer Visa Infinite', subtype: 'credit_card', bank: 'BCA' })).toBe('BCA Singapore Airlines KrisFlyer Visa Infinite');
    expect(accountDisplayName({ name: 'BCA KrisFlyer', subtype: 'credit_card', bank: 'Bank Central Asia' })).toBe('BCA KrisFlyer');
    expect(accountDisplayName({ name: 'Jenius Visa Platinum', subtype: 'credit_card', bank: 'Bank SMBC Indonesia' })).toBe('Jenius Visa Platinum');
    expect(accountDisplayName({ name: 'Nusa Voyager Travel', subtype: 'credit_card' })).toBe('Nusa Voyager Travel');
  });

  it('never touches what is called by its product, its broker or its catalogue', () => {
    expect(accountDisplayName({ name: 'GoPay', subtype: 'ewallet', bank: 'Dompet Anak Bangsa' })).toBe('GoPay');
    expect(accountDisplayName({ name: 'Flazz', subtype: 'emoney', bank: 'Bank Central Asia' })).toBe('Flazz');
    expect(accountDisplayName({ name: 'Stockbit Sekuritas', subtype: 'fund', bank: 'Bank Central Asia' })).toBe('Stockbit Sekuritas');
    // A fund's Held at is a name only: the fund keeps its own name.
    expect(accountDisplayName({ name: 'Sucorinvest Money Market', subtype: 'investment', bank: 'Bibit' })).toBe('Sucorinvest Money Market');
    expect(accountDisplayName({ name: 'KPR', subtype: 'loan', bank: 'Bank Tabungan Negara' })).toBe('KPR');
  });
});

describe('electronic money is its own kind of account', () => {
  it('files a chip card and a wallet app under electronic money on the tax report', () => {
    expect(cashItem('emoney').code).toBe('0105');
    expect(cashItem('ewallet').code).toBe('0105');
    expect(cashCodeForSubtype('emoney')).toBe('0105');
  });

  it('is called Electronic money, after Digital wallet, and spent from like one', () => {
    const ids = CASH_ITEMS.map((item) => item.id);
    expect(ids.indexOf('emoney')).toBe(ids.indexOf('ewallet') + 1);
    expect(cashItem('emoney').label).toBe('Electronic money');
    expect(cashItem('emoney').sub).toBe('Flazz, e-money, Brizzi, TapCash');
    expect(cashItem('ewallet').sub).toBe('GoPay, OVO, DANA, ShopeePay');
    expect(cashItem('emoney').behaviour).toMatchObject({ opens: 'money', subtype: 'emoney', spendable: true });
  });
});
