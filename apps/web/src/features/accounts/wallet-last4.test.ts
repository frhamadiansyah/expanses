import { describe, expect, it } from 'vitest';
import { keepLast4, last4Field, readAccountNumberLast4, readWalletLast4 } from './wallet-last4';

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

describe('readAccountNumberLast4', () => {
  it('keeps the last four of a whole number pasted in, empties to nothing, and refuses fewer than four', () => {
    expect(readAccountNumberLast4('123-456-7890')).toEqual({ ok: true, last4: '7890' });
    expect(readAccountNumberLast4('  ')).toEqual({ ok: true, last4: null });
    expect(readAccountNumberLast4('12')).toMatchObject({ ok: false });
  });
});

describe('keepLast4', () => {
  it('keeps digits only, at most four of them', () => {
    expect(keepLast4('55')).toBe('55');
    expect(keepLast4('5a5-2')).toBe('552');
    expect(keepLast4('')).toBe('');
  });

  it('keeps the end of a whole number pasted in, never its start', () => {
    expect(keepLast4('0812-3456-5521')).toBe('5521');
    expect(keepLast4('+62 812 3456 5521')).toBe('5521');
    expect(keepLast4('123-456-4321')).toBe('4321');
  });
});

describe('last4Field', () => {
  it('asks for the number pad and four characters at most', () => {
    const field = last4Field(() => {});
    expect(field.inputMode).toBe('numeric');
    expect(field.maxLength).toBe(4);
  });

  it('hands on only digits, typed or pasted, and takes the paste over from the browser', () => {
    const seen: string[] = [];
    const field = last4Field((digits) => seen.push(digits));
    field.onChange({ target: { value: '12a' } });
    let prevented = false;
    field.onPaste({ preventDefault: () => (prevented = true), clipboardData: { getData: () => '0812-3456-5521' } });
    expect(seen).toEqual(['12', '5521']);
    expect(prevented).toBe(true);
  });
});
