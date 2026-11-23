import { describe, expect, it } from 'vitest';
import { FACES as BANK_FACES } from './debit-art/faces.generated';
import { programmeFaceRef } from './programme-art/programmes';
import { earnedByMonth, expiringRows, expiringSoon, nextExpiry, pointsFaceRef, pointsLine, shortCount, tierLabel, worthBox } from './points-desk-model';

describe('pointsFaceRef: the face a programme wears on the Mac Points page', () => {
  it('a programme a membership family knows is that card at its tier, exactly as the iPhone draws it', () => {
    expect(pointsFaceRef({ name: 'KrisFlyer', tier: null, banks: ['BCA'] })).toEqual({ key: 'krisflyer', kind: 'membership', mark: 'KrisFlyer' });
    expect(pointsFaceRef({ name: 'Marriott Bonvoy', tier: 'silver', banks: [] })).toEqual({ key: 'bonvoy-silver', kind: 'membership', mark: 'Marriott Bonvoy' });
    // The family wins over a bank in the name: "BCA KrisFlyer" is KrisFlyer's card, not BCA's.
    expect(pointsFaceRef({ name: 'BCA KrisFlyer', tier: null, banks: [] })).toEqual(programmeFaceRef('BCA KrisFlyer', null));
  });

  it('a bank programme with no membership card wears its bank’s card art, the bank named by the programme first', () => {
    expect(pointsFaceRef({ name: 'BCA Rewards', tier: null, banks: [] })).toEqual({ key: 'bca', kind: 'debit', mark: 'BCA' });
    expect(pointsFaceRef({ name: 'CIMB Xtra Points', tier: null, banks: [] })).toEqual({ key: 'cimb', kind: 'debit', mark: 'CIMB NIAGA' });
    expect(pointsFaceRef({ name: 'Maybank TreatsPoints', tier: null, banks: [] })).toEqual({ key: 'maybank', kind: 'debit', mark: 'Maybank' });
    expect(pointsFaceRef({ name: 'Jenius Cashback', tier: null, banks: [] })).toEqual({ key: 'jenius', kind: 'debit', mark: 'Jenius' });
    // The programme's own name before its cards': a Mandiri card earning into "BCA Rewards" is still BCA.
    expect(pointsFaceRef({ name: 'BCA Rewards', tier: null, banks: ['Mandiri'] })?.key).toBe('bca');
  });

  it('a programme whose name names no bank goes by its earning card’s issuer, then the card’s name', () => {
    expect(pointsFaceRef({ name: "Livin' Poin", tier: null, banks: ['Mandiri'] })).toEqual({ key: 'mandiri', kind: 'debit', mark: 'mandiri' });
    expect(pointsFaceRef({ name: 'Poin Seroja', tier: null, banks: [null, 'Danamon Visa Platinum'] })?.key).toBe('danamon');
  });

  it('every bank face it can pick has art drawn for it', () => {
    for (const name of ['BCA Rewards', 'CIMB Xtra', 'Maybank TreatsPoints', 'Jenius', 'Mandiri', 'BRI', 'BNI', 'OCBC', 'UOB', 'Permata', 'Danamon', 'DBS']) {
      const face = pointsFaceRef({ name, tier: null, banks: [] });
      expect(face?.kind, name).toBe('debit');
      expect(BANK_FACES[face!.key], name).toBeDefined();
    }
  });

  it('neither a membership card nor a drawn bank keeps the plain face', () => {
    expect(pointsFaceRef({ name: 'Hilton Honors', tier: null, banks: [] })).toBeNull();
    expect(pointsFaceRef({ name: 'Poin Kenanga', tier: null, banks: [null, 'Kartu Teratai'] })).toBeNull();
    // A bank on the tax report's list with no drawn face is not drawn as another bank's.
    expect(pointsFaceRef({ name: 'BCA Syariah Poin', tier: null, banks: [] })).toBeNull();
    // A wallet's app is not a bank's card.
    expect(pointsFaceRef({ name: 'GoPay Coins', tier: null, banks: [] })).toBeNull();
  });
});

describe('tierLabel', () => {
  it('names the tier chosen in Settings, and nothing when none is chosen or the programme has no family', () => {
    expect(tierLabel('Marriott Bonvoy', 'silver')).toBe('Silver Elite');
    expect(tierLabel('KrisFlyer', null)).toBeNull();
    expect(tierLabel('BCA Rewards', 'gold')).toBeNull();
    expect(tierLabel('KrisFlyer', 'unheard')).toBeNull();
  });
});

describe('worthBox', () => {
  it('adds each unit’s programmes, and the total is exactly its rows', () => {
    const box = worthBox(
      [
        { unit: 'points', worth: { valueMinor: 1_890_000, currency: 'IDR' } },
        { unit: 'miles', worth: { valueMinor: 10_480_000, currency: 'IDR' } },
        { unit: 'points', worth: { valueMinor: 740_000, currency: 'IDR' } },
        { unit: 'cashback', worth: { valueMinor: 126_500, currency: 'IDR' } },
        { unit: 'miles', worth: null },
        { unit: 'points', worth: { valueMinor: 500, currency: 'USD' } },
      ],
      'IDR',
    );
    expect(box.units).toEqual([
      { unit: 'miles', label: 'Miles', minor: 10_480_000 },
      { unit: 'points', label: 'Points', minor: 2_630_000 },
      { unit: 'cashback', label: 'Cashback', minor: 126_500 },
    ]);
    expect(box.totalMinor).toBe(box.units.reduce((sum, unit) => sum + unit.minor, 0));
    expect(box.unvalued).toBe(2);
  });
});

describe('earnedByMonth', () => {
  it('sums the cards’ earning by the month its statement closes, the open statement counted this month', () => {
    const months = earnedByMonth(
      [
        { kind: 'earn', on: '2026-09-25', quantity: 3600 },
        { kind: 'earn', on: '2026-10-25', quantity: 5200 },
        { kind: 'earn', on: '2026-10-05', quantity: 100 },
        // Still open: closes in December, counted in November.
        { kind: 'earn', on: '2026-12-05', quantity: 900 },
        { kind: 'convert_in', on: '2026-10-10', quantity: 50_000 },
        { kind: 'adjust', on: '2026-10-10', quantity: 4000 },
        { kind: 'earn', on: '2025-01-25', quantity: 7 },
      ],
      '2026-11-18',
    );
    expect(months.map((month) => month.month)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
    expect(months.map((month) => month.quantity)).toEqual([0, 0, 0, 3600, 5300, 900]);
    expect(months.map((month) => month.current)).toEqual([false, false, false, false, false, true]);
    expect(months[5]!.label).toBe('Nov');
  });

  it('crosses a year', () => {
    expect(earnedByMonth([], '2027-02-01', 4).map((month) => month.month)).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

describe('shortCount', () => {
  it('writes a bar’s figure short', () => {
    expect(shortCount(840)).toBe('840');
    expect(shortCount(4800)).toBe('4,8k');
    expect(shortCount(52_400)).toBe('52k');
    expect(shortCount(1_250_000)).toBe('1,3M');
  });
});

describe('nextExpiry and the Expiring soon box', () => {
  it('says the phone’s note inside the window, else the first lot left with its date', () => {
    expect(nextExpiry([{ expiresOn: '2026-12-31', remaining: 6000 }], '6.000 expire 31 Dec', 'points')).toEqual({ on: '2026-12-31', remaining: 6000, soon: true, text: '6.000 expire 31 Dec' });
    expect(nextExpiry([{ expiresOn: '2027-03-12', remaining: 8200 }], null, 'miles')).toEqual({ on: '2027-03-12', remaining: 8200, soon: false, text: '8.200 miles on 12 Mar 2027' });
    expect(nextExpiry([], null, 'points')).toBeNull();
    expect(nextExpiry([{ expiresOn: '2027-03-12', remaining: 0 }], null, 'points')).toBeNull();
  });

  it('lists the soonest first and leaves out what expires never', () => {
    const at = (on: string) => ({ on, remaining: 1, soon: false, text: '' });
    const rows = expiringRows([
      { name: 'KrisFlyer', unit: 'miles', expiry: at('2027-03-12') },
      { name: 'BCA Rewards', unit: 'points', expiry: at('2026-12-31') },
      { name: 'Jenius', unit: 'cashback', expiry: null },
    ]);
    expect(rows.map((row) => row.name)).toEqual(['BCA Rewards', 'KrisFlyer']);
  });
});

describe('pointsLine', () => {
  const money = (minor: number) => `Rp ${minor}`;
  it('counts the programmes and says what they are worth, the Worth tile’s own total', () => {
    const worth = worthBox([{ unit: 'miles', worth: { valueMinor: 900, currency: 'IDR' } }, { unit: 'points', worth: { valueMinor: 300, currency: 'IDR' } }], 'IDR');
    expect(pointsLine(2, worth, money)).toBe('2 programmes · worth Rp 1200');
  });
  it('leaves the worth out when no programme has a value to go by', () => {
    expect(pointsLine(1, worthBox([{ unit: 'points', worth: null }], 'IDR'), money)).toBe('1 programme');
  });
});

describe('expiringSoon', () => {
  const lot = (on: string, soon: boolean) => ({ on, remaining: 10, soon, text: '' });
  it('counts only what expires within the warning window, the soonest first', () => {
    const rows = [
      { name: 'B', expiry: lot('2026-12-31', true) },
      { name: 'A', expiry: lot('2026-12-15', true) },
      { name: 'C', expiry: lot('2027-03-01', false) },
      { name: 'D', expiry: null },
    ];
    const soon = expiringSoon(rows);
    expect(soon.count).toBe(2);
    expect(soon.first?.name).toBe('A');
    expect(expiringSoon([{ name: 'C', expiry: lot('2027-03-01', false) }])).toEqual({ count: 0, first: null });
  });
});
