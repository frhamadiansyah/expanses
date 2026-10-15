import { describe, expect, it } from 'vitest';
import { readWalletLast4 } from './wallet-last4';

describe('readWalletLast4', () => {
  it('reads four digits as the digits, with the spaces around them dropped', () => {
    expect(readWalletLast4('5521')).toEqual({ ok: true, last4: '5521' });
    expect(readWalletLast4(' 0042 ')).toEqual({ ok: true, last4: '0042' });
  });

  it('reads an empty field as no digits, which removes any recorded', () => {
    expect(readWalletLast4('')).toEqual({ ok: true, last4: null });
    expect(readWalletLast4('   ')).toEqual({ ok: true, last4: null });
  });

  it('refuses anything but exactly four digits, saying what is wanted', () => {
    for (const typed of ['552', '55210', '55a1', '+628']) {
      expect(readWalletLast4(typed)).toEqual({ ok: false, error: 'The last 4 digits of the phone number are four numbers, like 5521.' });
    }
  });
});
