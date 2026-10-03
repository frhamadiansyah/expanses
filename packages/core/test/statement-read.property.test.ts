import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readStatement } from '../src/index';
import { line } from './fixtures/statement-corpus';

const run = { numRuns: 300, seed: 20261003 } as const;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_MS = 86_400_000;
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** One one-date row: date, description and amount, as Vision hands their columns over. */
const oneRow = (on: string, amount: string) => [[line(on, 0.05, 0.1), line('TOKO CONTOH', 0.25, 0.1), line(amount, 0.85, 0.1)]];

describe('readStatement, over every amount and date it can be handed', () => {
  it('reads a printed rupiah amount as itself, with CR as money in; a bare one- or two-digit figure is not money', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000_000 }), fc.boolean(), (rupiah, cr) => {
        const printed = `${rupiah.toLocaleString('en-US')}${cr ? 'CR' : ''}`;
        const { rows } = readStatement(oneRow('15MAY', printed), { start: '2026-05-11', end: '2026-06-10' }, 'IDR');
        if (rupiah < 100) {
          // The page-number guard: `7` or `42` alone at the end of a line is a count, not an amount.
          expect(rows).toEqual([]);
          return;
        }
        expect(rows).toHaveLength(1);
        expect(rows[0]?.amountMinor).toBe(rupiah);
        expect(rows[0]?.direction).toBe(cr ? 'in' : 'out');
      }),
      run,
    );
  });

  it('places a DDMMM date anywhere in a 31-day period on its own year', () => {
    const first = Date.UTC(2020, 0, 1);
    const last = Date.UTC(2035, 11, 31);
    fc.assert(
      fc.property(fc.integer({ min: 0, max: (last - first) / DAY_MS }), fc.integer({ min: 0, max: 30 }), (startDay, offset) => {
        const startMs = first + startDay * DAY_MS;
        const period = { start: isoOf(startMs), end: isoOf(startMs + 30 * DAY_MS) };
        const date = new Date(startMs + offset * DAY_MS);
        const printed = `${String(date.getUTCDate()).padStart(2, '0')}${MONTHS[date.getUTCMonth()]}`;
        const { rows } = readStatement(oneRow(printed, '55,000'), period, 'IDR');
        expect(rows[0]?.on).toBe(isoOf(date.getTime()));
      }),
      run,
    );
  });
});
