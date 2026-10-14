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

  it('places a DDMMM date up to a week either side of the period on its own year, across a new year too', () => {
    const first = Date.UTC(2020, 0, 1);
    const last = Date.UTC(2035, 11, 31);
    // Periods starting in the weeks around each new year, where the year is easiest to get wrong.
    const nearNewYear = fc.integer({ min: 0, max: 15 }).chain((y) => fc.integer({ min: -40, max: 10 }).map((d) => Date.UTC(2020 + y, 0, 1) + d * DAY_MS));
    const anywhere = fc.integer({ min: 0, max: (last - first) / DAY_MS }).map((d) => first + d * DAY_MS);
    fc.assert(
      fc.property(fc.oneof(nearNewYear, anywhere), fc.integer({ min: -7, max: 37 }), (startMs, offset) => {
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

describe('readStatement, over day-month dates with a separator and two dates in either order', () => {
  const MONTH_WORDS = [
    ['Jan', 'JAN', 'Januari'], ['Feb', 'FEB', 'February'], ['Mar', 'MAR', 'Maret'], ['Apr', 'APR', 'April'],
    ['May', 'MEI', 'Mei'], ['Jun', 'JUN', 'Juni'], ['Jul', 'JUL', 'July'], ['Aug', 'AGU', 'Agustus'],
    ['Sep', 'SEP', 'September'], ['Oct', 'OKT', 'Oktober'], ['Nov', 'NOV', 'November'], ['Dec', 'DES', 'Desember'],
  ];
  const first = Date.UTC(2020, 0, 1);
  const last = Date.UTC(2035, 11, 31);
  const anyStart = fc.integer({ min: 0, max: (last - first) / DAY_MS }).map((d) => first + d * DAY_MS);

  it('reads DD<sep>Mon<sep>YY, DD<sep>Mon<sep>YYYY and DD<sep>Mon as the day it names, the year from the period when none is printed', () => {
    const sep = fc.constantFrom('-', '/', '.', ' ');
    const yearForm = fc.constantFrom('none', 'yy', 'yyyy');
    fc.assert(
      fc.property(anyStart, fc.integer({ min: 0, max: 30 }), sep, yearForm, fc.integer({ min: 0, max: 2 }), fc.boolean(), (startMs, offset, s, form, spelling, padDay) => {
        const period = { start: isoOf(startMs), end: isoOf(startMs + 30 * DAY_MS) };
        const date = new Date(startMs + offset * DAY_MS);
        const day = padDay ? String(date.getUTCDate()).padStart(2, '0') : String(date.getUTCDate());
        const month = MONTH_WORDS[date.getUTCMonth()]![spelling]!;
        const year = date.getUTCFullYear();
        // Two digits after a bare space are never a year, so that form is printed with its full year.
        const printedYear = form === 'none' ? '' : form === 'yy' && s !== ' ' ? `${s}${String(year).slice(2)}` : `${s}${year}`;
        const printed = `${day}${s}${month}${printedYear}`;
        const { rows } = readStatement(oneRow(printed, '55,000'), period, 'IDR');
        expect(rows.map((r) => [r.on, r.description])).toEqual([[isoOf(date.getTime()), 'TOKO CONTOH']]);
      }),
      run,
    );
  });

  it('reads DD/MM with no year as the day it names, never MM/DD', () => {
    fc.assert(
      fc.property(anyStart, fc.integer({ min: 0, max: 30 }), (startMs, offset) => {
        const period = { start: isoOf(startMs), end: isoOf(startMs + 30 * DAY_MS) };
        const date = new Date(startMs + offset * DAY_MS);
        const printed = `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
        expect(readStatement(oneRow(printed, '55,000'), period, 'IDR').rows[0]?.on).toBe(isoOf(date.getTime()));
      }),
      run,
    );
  });

  it('takes the earlier of two dates as the transaction date and the later as the posting date, in either column order', () => {
    const shapes = fc.constantFrom(
      (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}-${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`,
      (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}${MONTHS[d.getUTCMonth()]}`,
      (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
    );
    fc.assert(
      fc.property(anyStart, fc.integer({ min: 0, max: 27 }), fc.integer({ min: 0, max: 3 }), fc.boolean(), shapes, (startMs, offset, lag, postedFirst, shape) => {
        const period = { start: isoOf(startMs), end: isoOf(startMs + 30 * DAY_MS) };
        const on = new Date(startMs + offset * DAY_MS);
        const posted = new Date(on.getTime() + lag * DAY_MS);
        const [a, b] = postedFirst ? [shape(posted), shape(on)] : [shape(on), shape(posted)];
        const images = [[line(a, 0.05, 0.1, 0.08), line(b, 0.15, 0.1, 0.08), line('TOKO CONTOH', 0.25, 0.1), line('55,000', 0.85, 0.1)]];
        const { rows } = readStatement(images, period, 'IDR');
        expect(rows.map((r) => [r.on, r.postedOn, r.description])).toEqual([[isoOf(on.getTime()), isoOf(posted.getTime()), 'TOKO CONTOH']]);
      }),
      run,
    );
  });
});

describe('readStatement, over foreign detail lines', () => {
  const EXPONENT: Record<string, number> = { USD: 2, TRY: 2, CNY: 2, EUR: 2, SGD: 2, JPY: 0 };
  const printed = (minor: number, exponent: number, locale = 'en-US') =>
    (minor / 10 ** exponent).toLocaleString(locale, { minimumFractionDigits: exponent, maximumFractionDigits: exponent });

  it('reads the original amount exactly in its own minor units whenever the charge is the original times the rate', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.keys(EXPONENT)),
        fc.integer({ min: 1, max: 50_000_000 }),
        fc.integer({ min: 1, max: 2_000_000 }),
        fc.boolean(),
        fc.constantFrom('en-US', 'id-ID'),
        fc.constantFrom('x', 'X', '×'),
        (currency, originalMinor, rateHundredths, cr, locale, sign) => {
          const exponent = EXPONENT[currency]!;
          const charged = Math.round((originalMinor / 10 ** exponent) * (rateHundredths / 100));
          fc.pre(charged > 999);
          // `1,213.00 x 342.00` or `2.070,00 X 2.410,00`: each convention, read by the last group.
          const detail = `(${currency} ${printed(originalMinor, exponent, locale)}${cr ? 'CR' : ''} ${sign} ${printed(rateHundredths, 2, locale)})`;
          const images = [[
            line('21-Mar-26', 0.05, 0.1, 0.08), line('23-Mar-26', 0.15, 0.1, 0.08), line('KAFE ORNEK CITY', 0.25, 0.1),
            line(`${charged.toLocaleString('en-US')}.00`, 0.8, 0.1, 0.1), ...(cr ? [line('CR', 0.92, 0.1, 0.03)] : []),
            line(detail, 0.25, 0.14),
          ]];
          const { rows } = readStatement(images, { start: '2026-03-06', end: '2026-04-05' }, 'IDR');
          expect(rows).toHaveLength(1);
          expect(rows[0]).toMatchObject({ amountMinor: charged, direction: cr ? 'in' : 'out', original: { currency, amountMinor: originalMinor } });
        },
      ),
      run,
    );
  });
});
