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

  it('leaves out a bare figure when the list prints money with Rp, and a row with a coins source anywhere', () => {
    const entries: Entry[] = [
      ['Shop A', 'TRX0000000001', '19 Sep 2026 10:00', '−Rp9.000', 'Wallet'],
      ['Shop B', 'TRX0000000002', '18 Sep 2026 10:00', '12', 'Wallet'],
      ['Shop C', 'TRX0000000003', '17 Sep 2026 10:00', '−Rp15.000', 'Poin'],
    ];
    const { rows } = readTransactionList([walletImage(entries)], { today: TODAY, currency: 'IDR' });
    expect(rows.map((r) => [r.description, r.coins])).toEqual([['Shop A', false]]);
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
    expect(readTransactionList([first, second], { today: TODAY, currency: 'IDR' }).rows).toHaveLength(3);
    // No reference printed: the repeated run is still found by date, name and amount.
    const bare = (entries: Entry[]) => walletImage(entries.map(([n, , w, a, s]) => [n, '', w, a, s] as Entry));
    expect(readTransactionList([bare(PAGE.slice(0, 3)), bare(PAGE.slice(2))], { today: TODAY, currency: 'IDR' }).rows).toHaveLength(3);
    // A screenshot overlapping the one before only on a coins row still has its new rows counted once.
    expect(readTransactionList([bare(PAGE.slice(0, 3)), bare(PAGE.slice(2, 3)), bare(PAGE.slice(2))], { today: TODAY, currency: 'IDR' }).rows).toHaveLength(3);
  });

  it('ignores a heading above the first entry and reports a screenshot with nothing', () => {
    const image = [line('Transaction history', 0.05, 0.02, 0.5, 0.03), ...walletImage(PAGE.slice(0, 1))];
    const reading = readTransactionList([image, [line('Nothing here', 0.1, 0.1)]], { today: TODAY, currency: 'IDR' });
    expect(reading.rows).toHaveLength(1);
    expect(reading.rows[0]!.description).toBe('Noodle Stall');
    expect(reading.emptyImages).toEqual([1]);
  });

  describe('a table of columns: date | transaction | id | payment | amount', () => {
    // An invented wallet history laid out as a table, each cell its own Vision line(s). A cell of one line sits at the
    // row's middle; a wrapped cell's lines stand from the row's top. Rows are 0.075 apart.
    type Cell = readonly string[];
    interface TableEntry {
      date: string;
      time: string;
      text: Cell;
      id: Cell;
      pay: string;
      amount: string;
      /** How far the payment cell stands off the row's middle: minus is higher. */
      payDy?: number;
    }
    const STEP = 0.022;
    const cell = (texts: Cell, x: number, top: number, w: number) =>
      texts.length === 1 ? [line(texts[0]!, x, top + STEP / 2, w)] : texts.map((t, k) => line(t, x, top + k * STEP, w));
    const right = (text: string, y: number) => {
      const w = 0.012 * text.length;
      return line(text, 0.97 - w, y, w);
    };
    function tableImage(entries: readonly TableEntry[], opts: { header?: boolean } = {}): CaptureLine[] {
      const first = 0.12;
      const header = opts.header
        ? [
            line('Tanggal', 0.03, first - 0.045, 0.1),
            line('Transaksi', 0.17, first - 0.045, 0.12),
            line('ID transaksi', 0.43, first - 0.045, 0.14),
            line('Metode pembayaran', 0.63, first - 0.045, 0.18),
            right('Jumlah', first - 0.045),
          ]
        : [];
      return [
        ...header,
        ...entries.flatMap((e, i) => {
          const top = first + i * 0.075;
          return [
            line(e.date, 0.03, top, 0.11),
            line(e.time, 0.03, top + STEP, 0.06),
            ...cell(e.text, 0.17, top, 0.24),
            ...cell(e.id, 0.43, top, 0.18),
            line(e.pay, 0.66, top + STEP / 2 + (e.payDy ?? 0), 0.16),
            right(e.amount, top + STEP / 2),
          ];
        }),
      ];
    }

    const TABLE: TableEntry[] = [
      { date: '14/09/2026', time: '19:42', text: ['Kedai Kopi Lembayung'], id: ['GJ260914A7Q4', 'M9X2KD'], pay: 'Wallet Saldo', amount: '-Rp58.300', payDy: -0.004 },
      { date: '13/09/2026', time: '08:15', text: ['Martabak Bang Juned', 'Cabang Timur'], id: ['GJ260913B3R8T5W1PZ'], pay: 'Tabungan Bank Contoh', amount: '-Rp112.750' },
      { date: '12/09/2026', time: '21:03', text: ['Cashback Warung Sate', 'Pak Darmo'], id: ['GJ260912C6V2', 'N8L4QE'], pay: 'Wallet Coins', amount: '150' },
      { date: '11/09/2026', time: '12:30', text: ['Pasar Poin Segar'], id: ['GJ260911D1F7H3J9KM'], pay: 'Wallet Saldo', amount: '-Rp27.400' },
      { date: '10/09/2026', time: '07:55', text: ['Isi saldo dari bank'], id: ['TRXABCDEFGH1', '2345'], pay: 'Transfer bank', amount: '+Rp500.000' },
    ];
    const READ = [
      ['2026-09-14', '19:42', 'Kedai Kopi Lembayung', 'GJ260914A7Q4M9X2KD', 'Wallet Saldo', 58300, 'out', false],
      ['2026-09-13', '08:15', 'Martabak Bang Juned Cabang Timur', 'GJ260913B3R8T5W1PZ', 'Tabungan Bank Contoh', 112750, 'out', false],
      ['2026-09-11', '12:30', 'Pasar Poin Segar', 'GJ260911D1F7H3J9KM', 'Wallet Saldo', 27400, 'out', false],
      ['2026-09-10', '07:55', 'Isi saldo dari bank', 'TRXABCDEFGH12345', 'Transfer bank', 500000, 'in', false],
    ];
    const fields = (rows: ReturnType<typeof readTransactionList>['rows']) =>
      rows.map((r) => [r.on, r.time, r.description, r.ref, r.source, r.amountMinor, r.direction, r.coins]);

    for (const header of [false, true]) {
      it(`reads each cell whole, the transaction text as the note and the payment as its source (${header ? 'with' : 'without'} the heading row)`, () => {
        const { rows } = readTransactionList([tableImage(TABLE, { header })], { today: TODAY, currency: 'IDR' });
        expect(fields(rows)).toEqual(READ);
      });
    }

    it('never takes the payment text as the note, whether it stands level with the transaction text or above it', () => {
      for (const payDy of [0, -0.004, -0.009]) {
        const { rows } = readTransactionList([tableImage(TABLE.map((e) => ({ ...e, payDy })), { header: true })], { today: TODAY, currency: 'IDR' });
        expect(rows.map((r) => [r.description, r.source])).toEqual(READ.map((r) => [r[2], r[4]]));
      }
    });

    it('keeps a row paid through a linked bank as this wallet\'s money row, and leaves a coins cashback out entirely', () => {
      const { rows } = readTransactionList([tableImage(TABLE)], { today: TODAY, currency: 'IDR' });
      expect(rows[1]).toMatchObject({ source: 'Tabungan Bank Contoh', coins: false, amountMinor: 112750 });
      expect(rows.some((r) => r.description.startsWith('Cashback'))).toBe(false);
      // A screenshot of coins rows alone was still read: it is not reported as empty.
      const coinsOnly = readTransactionList([tableImage(TABLE.slice(2, 3))], { today: TODAY, currency: 'IDR' });
      expect(coinsOnly).toEqual({ rows: [], emptyImages: [] });
    });

    it('reads one entry under the heading row with no heading word in it', () => {
      const { rows } = readTransactionList([tableImage(TABLE.slice(0, 1), { header: true })], { today: TODAY, currency: 'IDR' });
      expect(fields(rows)).toEqual(READ.slice(0, 1));
    });

    it('counts an entry once where two screenshots of the table overlap, each with its heading row', () => {
      const first = tableImage(TABLE.slice(0, 3), { header: true });
      const second = tableImage(TABLE.slice(2), { header: true });
      expect(fields(readTransactionList([first, second], { today: TODAY, currency: 'IDR' }).rows)).toEqual(READ);
    });
  });

  it('reads an entry of a date and an amount alone, with no words beside them', () => {
    const image = [line('19 Sep 2026 10:00', 0.05, 0.12), line('−Rp7.000', 0.72, 0.12, 0.25)];
    const { rows } = readTransactionList([image], { today: TODAY, currency: 'IDR' });
    expect(rows).toEqual([expect.objectContaining({ description: '', source: null, ref: null, amountMinor: 7000 })]);
  });

  it('does not take a shop named with a coin word for a coins row', () => {
    const entries: Entry[] = [['Poin Cafe', 'TRX0000000001', '19 Sep 2026 10:00', '−Rp9.000', 'Wallet']];
    const { rows } = readTransactionList([walletImage(entries)], { today: TODAY, currency: 'IDR' });
    expect(rows[0]).toMatchObject({ description: 'Poin Cafe', source: 'Wallet', coins: false });
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
