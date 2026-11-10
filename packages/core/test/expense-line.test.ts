import { describe, expect, it } from 'vitest';
import { readExpenseLine, tidyDescription, type PaymentOption } from '../src';

const TODAY = '2026-11-10';
const PAYMENTS: PaymentOption[] = [
  { accountId: 'nusa', cardId: 'nusa-a', accountName: 'Bank Nusa Platinum', last4: '4417', holderName: null },
  { accountId: 'biru', cardId: null, accountName: 'Dompet Biru', last4: null, holderName: null },
  { accountId: 'tunai', cardId: null, accountName: 'Cash', last4: null, holderName: null },
  { accountId: 'mandala', cardId: null, accountName: 'Bank Mandala', last4: null, holderName: null },
];
const read = (line: string, currency = 'IDR') => readExpenseLine(line, { today: TODAY, currency, payments: PAYMENTS });

describe('readExpenseLine', () => {
  it('reads a note and an amount', () => {
    expect(read('parkir 10rb')).toEqual({
      description: 'Parkir',
      amountMinor: 10_000,
      currency: 'IDR',
      currencyRead: false,
      occurredOn: null,
      payment: null,
      ambiguous: false,
      small: false,
      rest: '10rb',
    });
  });

  it('reads every amount spelling Paste a list reads', () => {
    expect(read('a 18000').amountMinor).toBe(18_000);
    expect(read('a 18.000').amountMinor).toBe(18_000);
    expect(read('a 38rb').amountMinor).toBe(38_000);
    expect(read('a 38k').amountMinor).toBe(38_000);
    expect(read('a 1,5jt').amountMinor).toBe(1_500_000);
    expect(read('a Rp 38.000').amountMinor).toBe(38_000);
  });

  it('takes the last figure when there are two, leaving the other in the note', () => {
    const r = read('gojek 2 kali 38000');
    expect(r.amountMinor).toBe(38_000);
    expect(r.description).toBe('Gojek 2 Kali');
  });

  it('marks a comma read as thousands', () => {
    const r = read('kopi 18,000');
    expect(r.amountMinor).toBe(18_000);
    expect(r.ambiguous).toBe(true);
  });

  it('has no amount without a figure, or with a minus', () => {
    expect(read('parkir').amountMinor).toBeNull();
    expect(read('kopi -38rb').amountMinor).toBeNull();
  });

  it('saves an amount alone with an empty note', () => {
    const r = read('38rb');
    expect(r.description).toBe('');
    expect(r.amountMinor).toBe(38_000);
  });

  it('reads paid-with from a whole word of an account', () => {
    const a = read('kopi pagi 38.000 biru');
    expect(a.payment).toEqual({ accountId: 'biru', cardId: null });
    expect(a.description).toBe('Kopi Pagi');
    const b = read('cash 15rb parkir');
    expect(b.payment).toEqual({ accountId: 'tunai', cardId: null });
    expect(b.description).toBe('Parkir');
  });

  it("reads paid-with from a card's last digits, which are not the amount", () => {
    const r = read('warung sate 1,5jt 4417');
    expect(r.payment).toEqual({ accountId: 'nusa', cardId: 'nusa-a' });
    expect(r.amountMinor).toBe(1_500_000);
    expect(r.description).toBe('Warung Sate');
  });

  it('lets known digits win when they are the only figure (Review Focus)', () => {
    const r = read('parkir 4417');
    expect(r.payment).toEqual({ accountId: 'nusa', cardId: 'nusa-a' });
    expect(r.amountMinor).toBeNull();
  });

  it("does not take a word that only contains an account's name", () => {
    const r = read('mandi 20rb');
    expect(r.payment).toBeNull();
    expect(r.description).toBe('Mandi');
  });

  it('leaves words naming two accounts in the note', () => {
    const r = read('nusa biru 20rb');
    expect(r.payment).toBeNull();
    expect(r.description).toBe('Nusa Biru');
  });

  it('reads yesterday in either word', () => {
    const r = read('kemarin toko buku 249k nusa');
    expect(r.occurredOn).toBe('2026-11-09');
    expect(r.payment).toEqual({ accountId: 'nusa', cardId: 'nusa-a' });
    expect(r.description).toBe('Toko Buku');
    expect(read('yesterday taxi 25000').occurredOn).toBe('2026-11-09');
  });

  it('reads a date inside the line, never as the amount', () => {
    const a = read('toko buku 28/10 85000');
    expect(a.occurredOn).toBe('2026-10-28');
    expect(a.amountMinor).toBe(85_000);
    expect(a.description).toBe('Toko Buku');
    const b = read('28 Oct makan siang 45rb');
    expect(b.occurredOn).toBe('2026-10-28');
    expect(b.amountMinor).toBe(45_000);
    expect(b.description).toBe('Makan Siang');
  });

  it('puts a yearless date over a month ahead in last year', () => {
    expect(read('2 Dec hotel 900000').occurredOn).toBe('2026-12-02');
    expect(read('25 Dec hotel 900000').occurredOn).toBe('2025-12-25');
  });

  it('reads a currency code before or after the figure, any case', () => {
    for (const line of ['KRW 95000 tteokbokki', 'tteokbokki 95000 krw']) {
      const r = read(line);
      expect(r.currency).toBe('KRW');
      expect(r.currencyRead).toBe(true);
      expect(r.amountMinor).toBe(95_000);
      expect(r.description).toBe('Tteokbokki');
    }
  });

  it("scales a code's figure by that currency's cents", () => {
    const a = read('usd 12,50 museum');
    expect(a.currency).toBe('USD');
    expect(a.amountMinor).toBe(1_250);
    const b = read('$12.50 museum');
    expect(b.currency).toBe('USD');
    expect(b.amountMinor).toBe(1_250);
  });

  it('reads Rp as rupiah in a workspace of another currency', () => {
    const r = read('Rp 38.000 kopi', 'USD');
    expect(r.currency).toBe('IDR');
    expect(r.amountMinor).toBe(38_000);
  });

  it('does not read try as lira', () => {
    const r = read('try 50000');
    expect(r.currency).toBe('IDR');
    expect(r.description).toBe('Try');
  });

  it('keeps a description typed with capitals as typed', () => {
    expect(read('KFC 50rb').description).toBe('KFC');
    expect(tidyDescription('kopi kenangan')).toBe('Kopi Kenangan');
    expect(tidyDescription('iPhone case')).toBe('iPhone case');
  });

  it('gives back what is not the description, for a picked suggestion', () => {
    expect(read('kopi ke 38rb nusa').rest).toBe('38rb nusa');
    expect(read('kemarin kopi 20rb').rest).toBe('kemarin 20rb');
  });

  it('reads S$ and RM in any case, also touching the figure', () => {
    const a = read('s$4,50 kaya toast');
    expect(a.currency).toBe('SGD');
    expect(a.amountMinor).toBe(450);
    expect(a.description).toBe('Kaya Toast');
    for (const line of ['beli RM 15', 'beli RM15', 'beli Rm 15', 'beli Rm15']) {
      const r = read(line);
      expect(r.currency).toBe('MYR');
      expect(r.currencyRead).toBe(true);
      expect(r.amountMinor).toBe(1_500);
      expect(r.description).toBe('Beli');
    }
    expect(read('RM15 nasi lemak').description).toBe('Nasi Lemak');
    expect(read('S$12 chicken rice').amountMinor).toBe(1_200);
  });

  it('never reads lower-case rm (rumah makan) as ringgit', () => {
    const cases: [string, number][] = [
      ['makan di rm 45.000 gopay', 45_000],
      ['makan rm 45rb', 45_000],
      ['rm 35rb', 35_000],
      ['rm2 padang 35rb', 35_000],
      ['rm padang 35rb', 35_000],
    ];
    for (const [line, minor] of cases) {
      const r = read(line);
      expect(r.currency, line).toBe('IDR');
      expect(r.currencyRead, line).toBe(false);
      expect(r.amountMinor, line).toBe(minor);
    }
    const tiny = read('beli rm 15');
    expect(tiny.currency).toBe('IDR');
    expect(tiny.amountMinor).toBe(15);
    expect(tiny.small).toBe(true);
  });

  it('reads RM as ringgit only before a plain figure, not one with rb/jt or dot thousands', () => {
    const a = read('RM15 nasi lemak');
    expect(a.currency).toBe('MYR');
    expect(a.amountMinor).toBe(1_500);
    expect(a.description).toBe('Nasi Lemak');
    expect(read('beli RM 15').currency).toBe('MYR');
    expect(read('beli RM 15').amountMinor).toBe(1_500);
    expect(read('RM12.50 teh tarik').amountMinor).toBe(1_250);
    expect(read('RM12.50 teh tarik').currency).toBe('MYR');
    for (const line of ['RM 45rb', 'RM 45.000']) {
      const r = read(line);
      expect(r.currency, line).toBe('IDR');
      expect(r.amountMinor, line).toBe(45_000);
    }
  });

  it('still reads rm inside a word as a word, and try never as lira', () => {
    const r = read('farm 15rb');
    expect(r.currency).toBe('IDR');
    expect(r.amountMinor).toBe(15_000);
    const eatery = read('rm sedap 25rb');
    expect(eatery.currency).toBe('IDR');
    expect(eatery.amountMinor).toBe(25_000);
    expect(eatery.description).toBe('Rm Sedap');
    expect(read('try 50000').currency).toBe('IDR');
    expect(read('try50000').currency).toBe('IDR');
  });

  it('marks a tiny amount as small, as Paste a list does', () => {
    const r = read('kopi 25 nusa');
    expect(r.amountMinor).toBe(25);
    expect(r.small).toBe(true);
    expect(read('kopi 25rb').small).toBe(false);
    expect(read('usd 0,50 gum').small).toBe(true);
    expect(read('usd 2 gum').small).toBe(false);
  });

  it('prefers a figure with rb, k or jt over a tiny bare one after it, leaving that in the note', () => {
    const r = read('kopi 50rb 2 gelas');
    expect(r.amountMinor).toBe(50_000);
    expect(r.small).toBe(false);
    expect(r.description).toBe('Kopi 2 Gelas');
    expect(read('nasi 1,5 juta 3 porsi').amountMinor).toBe(1_500_000);
    // A bare figure that is not tiny is still the amount, as the last figure.
    expect(read('gojek 2 kali 38000').amountMinor).toBe(38_000);
  });
});
