import { describe, expect, it } from 'vitest';
import { merchantKeyOf, readStatement } from '../src/index';
import { line, STATEMENT_CORPUS } from './fixtures/statement-corpus';

describe('readStatement, over the corpus', () => {
  for (const sample of STATEMENT_CORPUS) {
    it(sample.name, () => {
      expect(readStatement(sample.images, sample.period, sample.currency)).toEqual(sample.expected);
    });
  }
});

describe('readStatement, the review focus', () => {
  it("places each row's year inside the period", () => {
    const images = [[line('15DEC', 0.05, 0.1), line('TOKO A', 0.25, 0.1), line('150,000', 0.85, 0.1), line('05JAN', 0.05, 0.2), line('TOKO B', 0.25, 0.2), line('75,000', 0.85, 0.2)]];
    const { rows } = readStatement(images, { start: '2026-12-11', end: '2027-01-10' }, 'IDR');
    expect(rows.map((r) => r.on)).toEqual(['2026-12-15', '2027-01-05']);
  });

  it('places a December row of a statement lying wholly in January in the year before', () => {
    const images = [[line('02JAN', 0.05, 0.1, 0.1), line('31DEC', 0.15, 0.1, 0.1), line('HOTEL NUSA', 0.25, 0.1), line('1,250,000', 0.85, 0.1)]];
    const { rows } = readStatement(images, { start: '2027-01-02', end: '2027-02-01' }, 'IDR');
    expect(rows.map((r) => [r.on, r.postedOn])).toEqual([['2026-12-31', '2027-01-02']]);
  });

  it('keeps repeats inside one image, drops the overlap between images', () => {
    const repeat = (y: number) => [line('06MAY', 0.05, y), line('KURASU KISSATEN', 0.25, y), line('113,190', 0.85, y)];
    const a = [...repeat(0.1), ...repeat(0.15)];
    const b = [...repeat(0.1), line('07MAY', 0.05, 0.15), line('TOKO LAIN', 0.25, 0.15), line('20,000', 0.85, 0.15)];
    const period = { start: '2026-05-01', end: '2026-05-31' };
    expect(readStatement([a], period, 'IDR').rows).toHaveLength(2);
    // The second image starts with the same row the first ends on: that repeat is the scroll, not a purchase.
    expect(readStatement([a, b], period, 'IDR').rows.map((r) => r.description)).toEqual(['KURASU KISSATEN', 'KURASU KISSATEN', 'TOKO LAIN']);
  });

  it('reads a zero balance as zero, while a bare small figure on a row is still no amount', () => {
    const images = [[
      line('Previous Balance', 0.05, 0.1, 0.3), line('0', 0.85, 0.1),
      line('New Balance', 0.05, 0.15, 0.3), line('0', 0.85, 0.15),
      line('12MAY', 0.05, 0.2), line('PAGE', 0.25, 0.2), line('2', 0.85, 0.2),
    ]];
    expect(readStatement(images, { start: '2026-05-01', end: '2026-05-31' }, 'IDR')).toEqual({ rows: [], closingMinor: 0, previousMinor: 0, emptyImages: [] });
  });

  it('reads a currency with minor digits in its minor units', () => {
    const images = [[line('06/05', 0.05, 0.1), line('BOOK SHOP', 0.25, 0.1), line('1,234.56', 0.85, 0.1)]];
    expect(readStatement(images, { start: '2026-05-01', end: '2026-05-31' }, 'USD').rows[0]?.amountMinor).toBe(123456);
  });
});

describe('merchantKeyOf', () => {
  it('drops case, digits, stars and the city and country at the end, so two branches are one merchant', () => {
    expect(merchantKeyOf('KOPI SENJA JAKARTA SLT ID')).toBe('kopi senja');
    expect(merchantKeyOf('Kopi  Senja TANGERANG KAB ID')).toBe('kopi senja');
    expect(merchantKeyOf('OJEKFOOD*KOPI SENJA 12345 JAKARTA ID')).toBe('ojekfood kopi senja');
  });

  it('keeps a city word that is not at the end', () => {
    expect(merchantKeyOf('BANDUNG BAKERY SURABAYA ID')).toBe('bandung bakery');
    expect(merchantKeyOf('0811000000 JKT ID ID')).toBe('');
    expect(merchantKeyOf('KOPI SENJA JKT ID')).toBe('kopi senja');
  });
});
