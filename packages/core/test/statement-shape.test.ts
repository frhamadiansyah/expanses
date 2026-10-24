import { describe, expect, it } from 'vitest';
import { readsAsStatement } from '../src/index';
import { line } from './fixtures/statement-corpus';

/*
 * Invented pictures, as Vision reads them: every column its own line, one row under another. No figure, shop or date
 * here comes from a real statement or receipt.
 */
const TODAY = '2026-10-24';

/** A statement page: date, description and amount at x 0.05 / 0.25 / 0.85. */
const statementPage = (rows: readonly (readonly [string, string, string])[]) =>
  rows.flatMap(([on, description, amount], i) => {
    const y = 0.12 + i * 0.05;
    return [line(on, 0.05, y, 0.1), line(description, 0.25, y, 0.5), line(amount, 0.85, y, 0.12)];
  });

const STATEMENT = statementPage([
  ['03OCT', 'KEDAI LANGIT SORE', '61,500'],
  ['07OCT', 'TOKO ALAT TULIS RIANG', '23,750'],
  ['11OCT', 'BENGKEL SEPEDA MAJU', '142,000'],
  ['16OCT', 'APOTEK SEHAT SELALU', '37,250'],
]);

/** A paper receipt: a shop, the day it was printed, the items, one total. */
const RECEIPT = [
  line('WARUNG PELANGI', 0.3, 0.05, 0.4),
  line('14/10/2026 19:42', 0.3, 0.09, 0.4),
  line('Nasi Goreng', 0.05, 0.2, 0.4),
  line('27.500', 0.8, 0.2, 0.15),
  line('Es Jeruk', 0.05, 0.24, 0.4),
  line('9.000', 0.8, 0.24, 0.15),
  line('TOTAL', 0.05, 0.32, 0.4),
  line('36.500', 0.8, 0.32, 0.15),
];

/** A payment app's screen: two dated rows of history under the payment just made. */
const PAYMENT_SCREEN = [
  line('Payment successful', 0.2, 0.1, 0.6),
  line('Rp 18.500', 0.3, 0.16, 0.4),
  ...statementPage([
    ['20/10', 'KOPI PAGI CERAH', '18,500'],
    ['19/10', 'ROTI BAKAR SENJA', '12,000'],
  ]).map((l) => ({ ...l, box: [l.box[0], l.box[1] + 0.4, l.box[2], l.box[3]] as typeof l.box })),
];

describe('pictures handed over together: a statement, or a draft', () => {
  it('reads a page with three or more dated rows as a one-screenshot statement', () => {
    expect(readsAsStatement([STATEMENT], TODAY, 'IDR')).toBe(true);
    expect(readsAsStatement([STATEMENT.slice(0, 9)], TODAY, 'IDR')).toBe(true);
  });

  it('reads a receipt with one date and a total as a draft', () => {
    expect(readsAsStatement([RECEIPT], TODAY, 'IDR')).toBe(false);
  });

  it('reads a payment screen with two dated rows as a draft', () => {
    expect(readsAsStatement([PAYMENT_SCREEN], TODAY, 'IDR')).toBe(false);
  });

  it('reads two or more pictures as one statement, whatever is on them', () => {
    expect(readsAsStatement([RECEIPT, RECEIPT], TODAY, 'IDR')).toBe(true);
    expect(readsAsStatement([[], []], TODAY, 'IDR')).toBe(true);
  });

  it('reads nothing, or a picture with no text, as no statement', () => {
    expect(readsAsStatement([], TODAY, 'IDR')).toBe(false);
    expect(readsAsStatement([[]], TODAY, 'IDR')).toBe(false);
  });

  it('places a statement from across a year end, read in January', () => {
    const december = statementPage([
      ['18DEC', 'KEDAI LANGIT SORE', '61,500'],
      ['22DEC', 'TOKO ALAT TULIS RIANG', '23,750'],
      ['29DEC', 'BENGKEL SEPEDA MAJU', '142,000'],
    ]);
    expect(readsAsStatement([december], '2027-01-08', 'USD')).toBe(true);
  });
});
