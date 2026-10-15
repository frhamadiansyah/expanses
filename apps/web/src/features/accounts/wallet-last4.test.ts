import { describe, expect, it } from 'vitest';
import { readWalletLast4 } from './wallet-last4';

describe('readWalletLast4', () => {
  it('reads four digits as the digits, with the spaces around them dropped', () => {
    expect(readWalletLast4('5521')).toEqual({ ok: true, last4: '5521' });
    expect(readWalletLast4(' 0042 ')).toEqual({ ok: true, last4: '0042' });
  });

  it('keeps the last four of a whole phone number pasted in, never the carrier’s prefix', () => {
    expect(readWalletLast4('081234565521')).toEqual({ ok: true, last4: '5521' });
    expect(readWalletLast4('0812-3456-5521')).toEqual({ ok: true, last4: '5521' });
    expect(readWalletLast4('+62 812 3456 5521')).toEqual({ ok: true, last4: '5521' });
  });

  it('reads an empty field as no digits, which removes any recorded', () => {
    expect(readWalletLast4('')).toEqual({ ok: true, last4: null });
    expect(readWalletLast4('   ')).toEqual({ ok: true, last4: null });
  });

  it('refuses fewer than four digits, saying what is wanted', () => {
    for (const typed of ['552', '55a1', '+62', 'abcd']) {
      expect(readWalletLast4(typed)).toEqual({ ok: false, error: 'The last 4 digits of the phone number are four numbers, like 5521.' });
    }
  });
});
