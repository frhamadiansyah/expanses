import { describe, expect, it } from 'vitest';
import type { CaptureLine } from '../src/capture/types';
import { readTransactionList } from '../src/statement/list';
import { type ListCandidate, matchList } from '../src/statement/list-match';

const TODAY = '2026-09-20';
const line = (text: string, x: number, y: number, w = 0.3, h = 0.018): CaptureLine => ({ text, box: [x, y, w, h], height: h });

/**
 * An invented wallet list, the way Vision gives it: each entry a block of separate lines. Left column the name, the
 * long reference and the date with its time; right column the amount with the source under it. Blocks are 0.1 apart.
 */
type Entry = readonly [name: string, ref: string, when: string, amount: string, source: string];
function walletImage(entries: readonly Entry[], opts: { dateFirst?: boolean } = {}): CaptureLine[] {
  return entries.flatMap(([name, ref, when, amount, source], i) => {
    const top = 0.12 + i * 0.1;
    const left = opts.dateFirst
      ? [line(when, 0.05, top), line(name, 0.05, top + 0.025, 0.5), line(ref, 0.05, top + 0.05, 0.5)]
      : [line(name, 0.05, top, 0.5), line(ref, 0.05, top + 0.025, 0.5), line(when, 0.05, top + 0.05)];
    return [...left, line(amount, 0.72, opts.dateFirst ? top + 0.025 : top, 0.25), line(source, 0.72, (opts.dateFirst ? top + 0.025 : top) + 0.025, 0.25)];
  });
}

const PAGE: Entry[] = [
  ['Noodle Stall', 'TRX20260919A1B2C3', '19 Sep 2026 12:31', '−Rp41.000', 'Wallet balance'],
  ['Top up from bank', 'TRX20260918D4E5F6', '18 Sep 2026 09:05', '+Rp1.000.000', 'Bank transfer'],
  ['Cashback ride', 'TRX20260917G7H8J9', '17 Sep 2026 18:20', '41', 'Coins'],
  ['Transfer to Person A', 'TRX20260916K1L2M3', '16 Sep 2026 15:00', '-Rp10.500', 'Wallet balance'],
];

describe('readTransactionList', () => {
  for (const dateFirst of [false, true]) {
    it(`puts each entry's lines together (${dateFirst ? 'date on top' : 'date below'})`, () => {
      const { rows } = readTransactionList([walletImage(PAGE, { dateFirst })], { today: TODAY, currency: 'IDR' });
      expect(rows.map((r) => [r.on, r.time, r.description, r.ref, r.source, r.amountMinor, r.direction, r.coins])).toEqual([
        ['2026-09-19', '12:31', 'Noodle Stall', 'TRX20260919A1B2C3', 'Wallet balance', 41000, 'out', false],
        ['2026-09-18', '09:05', 'Top up from bank', 'TRX20260918D4E5F6', 'Bank transfer', 1000000, 'in', false],
        ['2026-09-17', '18:20', 'Cashback ride', 'TRX20260917G7H8J9', 'Coins', 41, 'in', true],
        ['2026-09-16', '15:00', 'Transfer to Person A', 'TRX20260916K1L2M3', 'Wallet balance', 10500, 'out', false],
      ]);
    });
  }

  it('reads the minus in its other forms and an unsigned amount as money in', () => {
    const entries: Entry[] = [
      ['Shop A', 'TRX0000000001', '19 Sep 2026 10:00', '–Rp 5.000', 'Wallet'],
      ['Shop B', 'TRX0000000002', '18 Sep 2026 10:00', 'Rp5.000', 'Wallet'],
      ['Shop C', 'TRX0000000003', '17 Sep 2026 10:00', '-Rp1.250.000', 'Wallet'],
    ];
    const { rows } = readTransactionList([walletImage(entries)], { today: TODAY, currency: 'IDR' });
    expect(rows.map((r) => [r.amountMinor, r.direction])).toEqual([
      [5000, 'out'],
      [5000, 'in'],
      [1250000, 'out'],
    ]);
  });

  it('marks a bare figure coins when the list prints money with Rp, and a coins source anywhere', () => {
    const entries: Entry[] = [
      ['Shop A', 'TRX0000000001', '19 Sep 2026 10:00', '−Rp9.000', 'Wallet'],
      ['Shop B', 'TRX0000000002', '18 Sep 2026 10:00', '12', 'Wallet'],
      ['Shop C', 'TRX0000000003', '17 Sep 2026 10:00', '−Rp15.000', 'Poin'],
    ];
    const { rows } = readTransactionList([walletImage(entries)], { today: TODAY, currency: 'IDR' });
    expect(rows.map((r) => r.coins)).toEqual([false, true, true]);
  });

  it('keeps a bare figure as money when the list never prints a currency and names no coins', () => {
    const entries: Entry[] = [['Shop A', 'TRX0000000001', '19 Sep 2026 10:00', '-12', 'Wallet']];
    const { rows } = readTransactionList([walletImage(entries)], { today: TODAY, currency: 'IDR' });
    expect(rows[0]).toMatchObject({ coins: false, amountMinor: 12, direction: 'out' });
  });

  it('puts a year on a date without one, within the year before today', () => {
    const entries: Entry[] = [
      ['Shop A', 'TRX0000000001', '19 Sep 10:00', '−Rp1.000', 'Wallet'],
      ['Shop B', 'TRX0000000002', '30 Dec 10:00', '−Rp1.000', 'Wallet'],
    ];
    const { rows } = readTransactionList([walletImage(entries)], { today: TODAY, currency: 'IDR' });
    expect(rows.map((r) => r.on)).toEqual(['2026-09-19', '2025-12-30']);
  });

  it('counts an entry once where two screenshots overlap, by its reference or its words', () => {
    const first = walletImage(PAGE.slice(0, 3));
    const second = walletImage(PAGE.slice(2));
    expect(readTransactionList([first, second], { today: TODAY, currency: 'IDR' }).rows).toHaveLength(4);
    // No reference printed: the repeated run is still found by date, name and amount.
    const bare = (entries: Entry[]) => walletImage(entries.map(([n, , w, a, s]) => [n, '', w, a, s] as Entry));
    expect(readTransactionList([bare(PAGE.slice(0, 3)), bare(PAGE.slice(2))], { today: TODAY, currency: 'IDR' }).rows).toHaveLength(4);
  });

  it('ignores a heading above the first entry and reports a screenshot with nothing', () => {
    const image = [line('Transaction history', 0.05, 0.02, 0.5, 0.03), ...walletImage(PAGE.slice(0, 1))];
    const reading = readTransactionList([image, [line('Nothing here', 0.1, 0.1)]], { today: TODAY, currency: 'IDR' });
    expect(reading.rows).toHaveLength(1);
    expect(reading.rows[0]!.description).toBe('Noodle Stall');
    expect(reading.emptyImages).toEqual([1]);
  });

  it('reads cents for a currency that has them', () => {
    const entries: Entry[] = [['Shop A', 'TRX0000000001', '19 Sep 2026 10:00', '-$12.50', 'Wallet']];
    const image = walletImage(entries).map((l) => (l.text === '-$12.50' ? { ...l, text: '-Rp12.50' } : l));
    const { rows } = readTransactionList([image], { today: TODAY, currency: 'USD' });
    expect(rows[0]!.amountMinor).toBe(1250);
  });
});

const c = (id: string, on: string, amountMinor: number, direction: 'out' | 'in', description: string): ListCandidate => ({ id, on, amountMinor, direction, description });
const row = (on: string, description: string, amountMinor: number, direction: 'out' | 'in', coins = false) =>
  ({ on, time: null, description, source: null, ref: null, amountMinor, direction, coins, image: 0 }) as const;

describe('matchList', () => {
  it('matches the same date, amount and direction, and leaves the rest new', () => {
    const { outcomes, notOnList } = matchList(
      [row('2026-09-19', 'Noodle Stall', 41000, 'out'), row('2026-09-18', 'Top up', 1000000, 'in')],
      [c('a', '2026-09-19', 41000, 'out', 'noodles')],
    );
    expect(outcomes.map((o) => o.status)).toEqual(['recorded', 'new']);
    expect(notOnList).toEqual([]);
  });

  it('does not match the other direction', () => {
    const { outcomes, notOnList } = matchList([row('2026-09-19', 'Refund', 41000, 'in')], [c('a', '2026-09-19', 41000, 'out', 'Refund')]);
    expect(outcomes[0]!.status).toBe('new');
    expect(notOnList).toEqual(['a']);
  });

  it('does not match another date, even a day off', () => {
    const { outcomes } = matchList([row('2026-09-19', 'Noodle Stall', 41000, 'out')], [c('a', '2026-09-20', 41000, 'out', 'Noodle Stall')]);
    expect(outcomes[0]!.status).toBe('new');
  });

  it('takes each recorded entry once: the same amount twice a day needs two entries', () => {
    const rows = [row('2026-09-19', 'Coffee', 25000, 'out'), row('2026-09-19', 'Coffee', 25000, 'out')];
    const one = matchList(rows, [c('a', '2026-09-19', 25000, 'out', 'Coffee')]);
    expect(one.outcomes.map((o) => o.status)).toEqual(['recorded', 'new']);
    const two = matchList(rows, [c('a', '2026-09-19', 25000, 'out', 'Coffee'), c('b', '2026-09-19', 25000, 'out', 'Coffee')]);
    expect(two.outcomes.map((o) => o.status)).toEqual(['recorded', 'recorded']);
    expect(two.outcomes.map((o) => (o.status === 'recorded' ? o.candidateId : ''))).toEqual(['a', 'b']);
  });

  it('gives alike entries to the rows whose names read most alike', () => {
    const { outcomes } = matchList(
      [row('2026-09-19', 'Noodle Stall', 30000, 'out'), row('2026-09-19', 'Bus ticket', 30000, 'out')],
      [c('bus', '2026-09-19', 30000, 'out', 'Bus ticket'), c('noodle', '2026-09-19', 30000, 'out', 'Noodle Stall')],
    );
    expect(outcomes.map((o) => (o.status === 'recorded' ? o.candidateId : ''))).toEqual(['noodle', 'bus']);
  });

  it('calls a same-day, same-name entry with another amount "differs", and only with a name in common', () => {
    const rows = [row('2026-09-19', 'Noodle Stall', 41000, 'out')];
    const near = matchList(rows, [c('a', '2026-09-19', 40000, 'out', 'Noodle Stall lunch')]);
    expect(near.outcomes[0]).toEqual({ row: 0, status: 'differs', candidateId: 'a', listMinor: 41000, recordedMinor: 40000 });
    expect(near.notOnList).toEqual([]);
    const other = matchList(rows, [c('a', '2026-09-19', 40000, 'out', 'Taxi')]);
    expect(other.outcomes[0]!.status).toBe('new');
    expect(other.notOnList).toEqual(['a']);
  });

  it('skips coins rows and never lets them take an entry', () => {
    const { outcomes, notOnList } = matchList([row('2026-09-19', 'Cashback', 41, 'in', true)], [c('a', '2026-09-19', 41, 'in', 'Cashback')]);
    expect(outcomes[0]!.status).toBe('skipped');
    expect(notOnList).toEqual(['a']);
  });

  it('lists recorded entries inside the list days, the first and last day included, and not outside', () => {
    const { notOnList } = matchList(
      [row('2026-09-15', 'A', 1000, 'out'), row('2026-09-19', 'B', 2000, 'out')],
      [
        c('before', '2026-09-14', 5000, 'out', 'x'),
        c('first', '2026-09-15', 5000, 'out', 'x'),
        c('middle', '2026-09-17', 5000, 'out', 'x'),
        c('last', '2026-09-19', 5000, 'out', 'x'),
        c('after', '2026-09-20', 5000, 'out', 'x'),
      ],
    );
    expect(notOnList).toEqual(['first', 'middle', 'last']);
  });

  it('has no range, and so nothing "not on this list", when no row was read', () => {
    expect(matchList([], [c('a', '2026-09-19', 1, 'out', 'x')])).toEqual({ outcomes: [], notOnList: [] });
  });
});
