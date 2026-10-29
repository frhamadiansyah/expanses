import { describe, expect, it } from 'vitest';
import { parsePurchaseList } from '../src/index';

const TODAY = '2026-10-28';
const read = (text: string, currency?: string) => parsePurchaseList(text, { today: TODAY, ...(currency ? { currency } : {}) });
const amountOf = (line: string, currency?: string) => read(line, currency)[0]?.amountMinor;

describe('parsePurchaseList: the owner example', () => {
  it('reads a note and its amount on every line', () => {
    const rows = read('gocar 18000\nyoshinoya 249000\ntaxi bluebird 25000\ncatering 90000');
    expect(rows.map((r) => [r.lineNo, r.note, r.amountMinor, r.status, r.occurredOn])).toEqual([
      [1, 'gocar', 18_000, 'ok', null],
      [2, 'yoshinoya', 249_000, 'ok', null],
      [3, 'taxi bluebird', 25_000, 'ok', null],
      [4, 'catering', 90_000, 'ok', null],
    ]);
  });

  it('keeps the line as typed', () => {
    expect(read('  - gocar 18000 ')[0]!.raw).toBe('  - gocar 18000 ');
  });
});

describe('parsePurchaseList: amounts', () => {
  it('reads plain and dot-grouped whole figures', () => {
    expect(amountOf('a 18000')).toBe(18_000);
    expect(amountOf('a 18.000')).toBe(18_000);
    expect(amountOf('a 1.250.000')).toBe(1_250_000);
    expect(amountOf('a 0')).toBeNull();
  });

  it('reads a comma as the decimal mark, so 18,5 is eighteen and a half', () => {
    expect(amountOf('a 18,5', 'USD')).toBe(1_850);
    expect(amountOf('a 18,50', 'USD')).toBe(1_850);
    expect(amountOf('a 1.250,50', 'USD')).toBe(125_050);
    expect(amountOf('a 18.500,5', 'USD')).toBe(1_850_050);
  });

  it('reads 18,000 as thousands but says it could be read two ways', () => {
    const [row] = read('a 18,000');
    expect(row).toMatchObject({ amountMinor: 18_000, ambiguous: true, status: 'suspicious' });
  });

  it('reads a comma-grouped figure ending in a dot (the other way round)', () => {
    expect(amountOf('a 1,250.50', 'USD')).toBe(125_050);
    expect(amountOf('a 1,250,000')).toBe(1_250_000);
    expect(read('a 1,250,000')[0]!.ambiguous).toBe(false);
  });

  it('reads k, rb and ribu as thousands', () => {
    expect(amountOf('a 249k')).toBe(249_000);
    expect(amountOf('a 249K')).toBe(249_000);
    expect(amountOf('a 25 rb')).toBe(25_000);
    expect(amountOf('a 25rb')).toBe(25_000);
    expect(amountOf('a 2 ribu')).toBe(2_000);
    expect(amountOf('a 1,5k')).toBe(1_500);
  });

  it('reads jt and juta as millions, with a decimal before', () => {
    expect(amountOf('a 2jt')).toBe(2_000_000);
    expect(amountOf('a 1.5jt')).toBe(1_500_000);
    expect(amountOf('a 1,5jt')).toBe(1_500_000);
    expect(amountOf('a 1,25 juta')).toBe(1_250_000);
    expect(read('a 1,5jt')[0]).toMatchObject({ status: 'ok', ambiguous: false });
  });

  it('reads a lone dot before a suffix as the decimal mark, not thousands', () => {
    expect(amountOf('a 1.250k')).toBe(1_250);
  });

  it('reads a currency word in front and a closing ",-" after', () => {
    expect(amountOf('a Rp 18.000')).toBe(18_000);
    expect(amountOf('a Rp18000')).toBe(18_000);
    expect(amountOf('a rp. 18.000')).toBe(18_000);
    expect(amountOf('a 18.000,-')).toBe(18_000);
    expect(amountOf('a Rp 2jt')).toBe(2_000_000);
    expect(read('a Rp 18.000')[0]!.note).toBe('a');
  });

  it('reads a space as a thousands mark only in groups of exactly three digits', () => {
    expect(amountOf('a 18 000')).toBe(18_000);
    expect(amountOf('a 1 250 000')).toBe(1_250_000);
    // "5 1200": the 5 is a quantity, the figure is 1200.
    expect(read('kopi 5 1200')[0]).toMatchObject({ amountMinor: 1_200, note: 'kopi 5' });
  });

  it('takes the last figure as the amount and keeps the other words and figures in the note', () => {
    expect(read('2 kopi 36000')[0]).toMatchObject({ note: '2 kopi', amountMinor: 36_000 });
    expect(read('nasi 2 porsi 36.000')[0]).toMatchObject({ note: 'nasi 2 porsi', amountMinor: 36_000 });
    expect(read('18000 gocar')[0]).toMatchObject({ note: 'gocar', amountMinor: 18_000 });
    expect(read('taxi 25000 pulang')[0]).toMatchObject({ note: 'taxi pulang', amountMinor: 25_000 });
  });

  it('does not take a digit inside a word as the amount', () => {
    expect(read('room b2')[0]).toMatchObject({ amountMinor: null, status: 'no-amount' });
    expect(read('2x kopi')[0]).toMatchObject({ amountMinor: null });
    expect(read('kopi 2kg 30000')[0]).toMatchObject({ note: 'kopi 2kg', amountMinor: 30_000 });
  });

  it('drops separators left between the note and the amount', () => {
    expect(read('gocar: 18000')[0]!.note).toBe('gocar');
    expect(read('gocar - 18000')[0]).toMatchObject({ note: 'gocar', amountMinor: 18_000 });
    expect(read('gocar @ 18000')[0]!.note).toBe('gocar');
    expect(read('gocar-18000')[0]).toMatchObject({ amountMinor: 18_000 });
  });

  it('allows a figure with no words: the note is empty', () => {
    expect(read('18000')[0]).toMatchObject({ note: '', amountMinor: 18_000, status: 'ok' });
    expect(read('Rp 25.000')[0]).toMatchObject({ note: '', amountMinor: 25_000 });
  });

  it('uses the currency for cents and rounds none away silently', () => {
    expect(amountOf('a 18,5', 'USD')).toBe(1_850);
    expect(amountOf('a 18', 'USD')).toBe(1_800);
    // IDR has no cents: 18,5 is rounded and flagged.
    expect(read('a 18,5')[0]).toMatchObject({ amountMinor: 19, ambiguous: true, status: 'suspicious' });
    // A three-decimal currency reads a dot before three digits as thousands, as the amount field does.
    expect(amountOf('a 1.234', 'KWD')).toBe(1_234_000);
    expect(amountOf('a 1,234', 'KWD')).toBe(1_234_000);
    expect(amountOf('a 1,2', 'KWD')).toBe(1_200);
  });

  it('leaves a figure whose marks make no sense unread', () => {
    expect(read('a 1.2.3')[0]).toMatchObject({ amountMinor: null, status: 'no-amount' });
    expect(read('a 12.34.567')[0]).toMatchObject({ amountMinor: null });
    expect(read('a 1,2,3')[0]).toMatchObject({ amountMinor: null });
  });

  it('leaves a negative figure unread: a refund is not a purchase', () => {
    expect(read('refund -5000')[0]).toMatchObject({ amountMinor: null, status: 'no-amount' });
    expect(read('refund −5000')[0]).toMatchObject({ amountMinor: null });
  });

  it('does not lose precision on a huge figure, and refuses what cannot be held', () => {
    expect(read('house 9.000.000.000.000')[0]).toMatchObject({ amountMinor: 9_000_000_000_000, status: 'suspicious' });
    expect(read('house 99999999999999999999')[0]).toMatchObject({ amountMinor: null, status: 'no-amount' });
    expect(amountOf('a 123.456.789.012')).toBe(123_456_789_012);
  });
});

describe('parsePurchaseList: lines with no amount and suspicious ones', () => {
  it('keeps a line with no figure as no-amount, note and all', () => {
    expect(read('parkir')[0]).toMatchObject({ lineNo: 1, note: 'parkir', amountMinor: null, status: 'no-amount' });
  });

  it('flags a figure that looks like a dropped zero', () => {
    expect(read('gocar 2')[0]).toMatchObject({ amountMinor: 2, status: 'suspicious', ambiguous: false });
    expect(read('gocar 99')[0]!.status).toBe('suspicious');
    expect(read('gocar 100')[0]!.status).toBe('ok');
  });

  it('flags 1.25 in a currency without cents: rounded, ambiguous', () => {
    expect(read('a 1.25')[0]).toMatchObject({ amountMinor: 1, ambiguous: true, status: 'suspicious' });
    // The same text in a currency with cents is just one twenty-five.
    expect(read('a 1.25', 'USD')[0]).toMatchObject({ amountMinor: 125, ambiguous: false, status: 'ok' });
  });

  it('does not flag small figures in a currency with cents', () => {
    expect(read('gum 2', 'USD')[0]).toMatchObject({ amountMinor: 200, status: 'ok' });
    expect(read('gum 0,5', 'USD')[0]!.status).toBe('suspicious');
  });
});

describe('parsePurchaseList: lines that are not purchases', () => {
  it('skips blank lines and comments but keeps the line numbers', () => {
    const rows = read('# lunch\n\ngocar 18000\n// note\n   \nkopi 12000');
    expect(rows.map((r) => [r.lineNo, r.note])).toEqual([
      [3, 'gocar'],
      [6, 'kopi'],
    ]);
  });

  it('reads CRLF, CR and tab-separated lines', () => {
    expect(read('gocar 18000\r\nkopi 12000\r\n').map((r) => r.amountMinor)).toEqual([18_000, 12_000]);
    expect(read('gocar 18000\rkopi 12000').map((r) => r.amountMinor)).toEqual([18_000, 12_000]);
    expect(read('gocar\t18000\n\tkopi\t\t12.000')).toMatchObject([{ note: 'gocar', amountMinor: 18_000 }, { note: 'kopi', amountMinor: 12_000 }]);
  });

  it('strips a bullet or list number', () => {
    const rows = read('- gocar 18000\n* kopi 12000\n• bakso 20000\n1. nasi 15000\n2) teh 5000\n12. sate 30000');
    expect(rows.map((r) => [r.note, r.amountMinor])).toEqual([
      ['gocar', 18_000],
      ['kopi', 12_000],
      ['bakso', 20_000],
      ['nasi', 15_000],
      ['teh', 5_000],
      ['sate', 30_000],
    ]);
  });

  it('does not take the list number for part of a figure', () => {
    expect(read('1.250.000')[0]).toMatchObject({ note: '', amountMinor: 1_250_000 });
    expect(read('2. 18000')[0]).toMatchObject({ note: '', amountMinor: 18_000 });
  });

  it('returns nothing for an empty paste', () => {
    expect(read('')).toEqual([]);
    expect(read('  \n\n  \t\n')).toEqual([]);
  });
});

describe('parsePurchaseList: date lines', () => {
  it('sets the day of the lines below it until the next date line', () => {
    const rows = read('before 1000\n27/10\ngocar 18000\nkopi 12000\n25 Oct\nteh 5000');
    expect(rows.map((r) => [r.note, r.occurredOn])).toEqual([
      ['before', null],
      ['gocar', '2026-10-27'],
      ['kopi', '2026-10-27'],
      ['teh', '2026-10-25'],
    ]);
  });

  it('reads the date shapes people type, day first', () => {
    const day = (line: string) => read(`${line}\nx 1000`)[0]!.occurredOn;
    expect(day('27/10')).toBe('2026-10-27');
    expect(day('27/10/2026')).toBe('2026-10-27');
    expect(day('27-10')).toBe('2026-10-27');
    expect(day('27 Oct')).toBe('2026-10-27');
    expect(day('Oct 27')).toBe('2026-10-27');
    expect(day('27 October 2025')).toBe('2025-10-27');
    expect(day('2026-10-26')).toBe('2026-10-26');
    expect(day('5/10')).toBe('2026-10-05');
    expect(day('Mon 26 Oct')).toBe('2026-10-26');
    expect(day('27/10:')).toBe('2026-10-27');
    expect(day('27/10 -')).toBe('2026-10-27');
  });

  it('puts a date line without a year in the previous year when it would be over a month ahead', () => {
    const day = (today: string, line: string) => parsePurchaseList(`${line}\nx 1000`, { today }).at(0)!.occurredOn;
    expect(day('2026-01-05', '28/12')).toBe('2025-12-28');
    expect(day('2026-01-05', '28 Dec')).toBe('2025-12-28');
    // Within a month ahead stays this year; the same day and a day ahead too.
    expect(day('2026-10-28', '28/10')).toBe('2026-10-28');
    expect(day('2026-10-28', '29/10')).toBe('2026-10-29');
    expect(day('2026-10-28', '28/11')).toBe('2026-11-28');
    expect(day('2026-10-28', '29/11')).toBe('2025-11-29');
    // A year that was typed is kept, however far ahead.
    expect(day('2026-01-05', '28/12/2026')).toBe('2026-12-28');
  });

  it('keeps a 29 February that only exists in a leap year', () => {
    expect(parsePurchaseList('29/2\nx 1000', { today: '2028-03-10' })[0]!.occurredOn).toBe('2028-02-29');
  });

  it('is not fooled by a purchase that looks a little like a date', () => {
    const rows = read('5 kopi 20000\n3 kopi\n1.5\n27');
    expect(rows.map((r) => [r.note, r.amountMinor, r.occurredOn])).toEqual([
      ['5 kopi', 20_000, null],
      ['kopi', 3, null],
      ['', 2, null],
      ['', 27, null],
    ]);
  });

  it('does not take an impossible date for one: the last figure is read as an amount, flagged for being tiny', () => {
    expect(read('31/2')[0]).toMatchObject({ lineNo: 1, amountMinor: 2, status: 'suspicious', occurredOn: null });
  });

  it('gives a no-amount line the day above it too', () => {
    const rows = read('26/10\nparkir');
    expect(rows[0]).toMatchObject({ lineNo: 2, status: 'no-amount', occurredOn: '2026-10-26' });
  });
});
