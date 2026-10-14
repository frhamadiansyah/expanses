import { describe, expect, it } from 'vitest';
import { looksLikeRefund, matchStatement, merchantKeyOf, readStatement } from '../src/index';
import type { CaptureLine } from '../src/index';
import { dashNoYearShot, line, slashNoYearShot, STATEMENT_CORPUS } from './fixtures/statement-corpus';

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

describe('readStatement, day-month dates with a separator', () => {
  const period = { start: '2026-02-10', end: '2026-03-11' };
  const one = (date: string, description = 'TOKO CONTOH') => [[line(date, 0.05, 0.1, 0.1), line(description, 0.25, 0.1), line('55,000', 0.85, 0.1)]];

  it('reads a day and a month word joined by one separator, with a two- or four-digit year or none', () => {
    const cases: [string, string, { start: string; end: string }][] = [
      ['05-Mar-26', '2026-03-05', period],
      ['05/Mar/26', '2026-03-05', period],
      ['05.Mar.26', '2026-03-05', period],
      ['05-Mar-2026', '2026-03-05', period],
      ['05 Mar 2026', '2026-03-05', period],
      ['05-MAR', '2026-03-05', period],
      ['20-FEB', '2026-02-20', period],
      ['8/Feb', '2026-02-08', period],
      ['02.Maret.26', '2026-03-02', period],
      // Indonesian abbreviations, the year from the period.
      ['14-OKT', '2025-10-14', { start: '2025-09-20', end: '2025-10-19' }],
      ['09-AGU', '2025-08-09', { start: '2025-07-20', end: '2025-08-19' }],
    ];
    for (const [printed, iso, p] of cases) expect(readStatement(one(printed), p, 'IDR').rows.map((r) => [r.on, r.description]), printed).toEqual([[iso, 'TOKO CONTOH']]);
  });

  it('takes two digits after a bare space as the description, never as the year', () => {
    expect(readStatement(one('06 MAY', '10 PCS BOLT'), { start: '2026-05-01', end: '2026-05-31' }, 'IDR').rows.map((r) => [r.on, r.description])).toEqual([['2026-05-06', '10 PCS BOLT']]);
    expect(readStatement([[line('06 MAY 10 PCS BOLT', 0.05, 0.1, 0.5), line('55,000', 0.85, 0.1)]], { start: '2026-05-01', end: '2026-05-31' }, 'IDR').rows.map((r) => [r.on, r.description])).toEqual([['2026-05-06', '10 PCS BOLT']]);
  });

  it('wants the same separator before the year as after the day', () => {
    expect(readStatement(one('05-Mar/26'), period, 'IDR').rows).toEqual([]);
    expect(readStatement(one('05-Mar.2026'), period, 'IDR').rows).toEqual([]);
  });

  it('keeps a shop that starts with a number and a dash as a description', () => {
    const images = [[line('06/05', 0.05, 0.1, 0.1), line('3-MAYBERRY CLINIC', 0.25, 0.1), line('150.000', 0.85, 0.1)]];
    expect(readStatement(images, { start: '2026-05-01', end: '2026-05-31' }, 'IDR').rows.map((r) => r.description)).toEqual(['3-MAYBERRY CLINIC']);
  });
});

describe('readStatement, two dates on a row', () => {
  const twoDates = (first: string, second: string) => [[line(first, 0.05, 0.1, 0.08), line(second, 0.15, 0.1, 0.08), line('TOKO CONTOH', 0.25, 0.1), line('55,000', 0.85, 0.1)]];
  const period = { start: '2026-02-10', end: '2026-03-11' };
  const read = (a: string, b: string, p = period) => readStatement(twoDates(a, b), p, 'IDR').rows.map((r) => [r.on, r.postedOn]);

  it('takes the earlier as the transaction date and the later as the posting date, in either column order', () => {
    expect(read('07-Mar-26', '05-Mar-26')).toEqual([['2026-03-05', '2026-03-07']]);
    expect(read('05-Mar-26', '07-Mar-26')).toEqual([['2026-03-05', '2026-03-07']]);
    expect(read('09MAR', '07MAR')).toEqual([['2026-03-07', '2026-03-09']]);
    expect(read('03-MAR', '03-MAR')).toEqual([['2026-03-03', '2026-03-03']]);
  });

  it('puts a yearless date in the year nearest the period, never a year ahead', () => {
    const january = { start: '2027-01-05', end: '2027-02-04' };
    // 20 December lies more than a week before the period: the December before it, not the one after.
    expect(read('20/12', '02/01', january)).toEqual([['2026-12-20', '2027-01-02']]);
    const images = [[line('28/12', 0.05, 0.1, 0.1), line('TOKO CONTOH', 0.25, 0.1), line('55,000', 0.85, 0.1)]];
    expect(readStatement(images, { start: '2027-01-10', end: '2027-02-09' }, 'IDR').rows.map((r) => r.on)).toEqual(['2026-12-28']);
  });

  it('keeps no posting date more than sixty days after the purchase', () => {
    expect(read('15/01', '20/04', { start: '2027-01-05', end: '2027-02-04' })).toEqual([['2027-01-15', null]]);
    expect(read('15/01', '15/03', { start: '2027-01-05', end: '2027-02-04' })).toEqual([['2027-01-15', '2027-03-15']]);
  });
});

describe('readStatement, a foreign purchase\'s detail line', () => {
  const period = { start: '2026-03-06', end: '2026-04-05' };
  /** A transaction-date-first row at height `y` (0–1), and a detail line under it. */
  const row = (y: number, description: string, amount: string, cr = false) => [
    line('21-Mar-26', 0.08, y, 0.06),
    line('23-Mar-26', 0.2, y, 0.06),
    line(description, 0.35, y, 0.3),
    line(amount, 0.8, y, 0.08),
    ...(cr ? [line('CR', 0.9, y, 0.02)] : []),
  ];
  const detail = (y: number, text: string) => line(text, 0.35, y, 0.2);
  const originals = (images: CaptureLine[][], currency = 'IDR') => readStatement(images, period, currency).rows.map((r) => [r.description, r.original ?? null]);

  it('reads the original currency and amount into the row above, and is never a row of its own', () => {
    const { rows } = readStatement([[...row(0.1, 'KAFE ORNEK CITY TR', '140,492.00'), detail(0.13, '(TRY 412.00 x 341.00)')]], period, 'IDR');
    expect(rows).toEqual([
      { on: '2026-03-21', postedOn: '2026-03-23', description: 'KAFE ORNEK CITY TR', amountMinor: 140492, direction: 'out', isFee: false, image: 0, original: { currency: 'TRY', amountMinor: 41200 } },
    ]);
  });

  it('reads it with a bracket lost, a credit marker glued on, a times sign, and in a currency without minor digits', () => {
    expect(originals([[...row(0.1, 'KAFE ORNEK CITY TR', '140,492.00'), detail(0.13, '(TRY 412.00 x 341.00')]])).toEqual([['KAFE ORNEK CITY TR', { currency: 'TRY', amountMinor: 41200 }]]);
    expect(originals([[...row(0.1, 'KAFE ORNEK CITY TR', '140,492.00'), detail(0.13, 'TRY 412.00 x 341.00)')]])).toEqual([['KAFE ORNEK CITY TR', { currency: 'TRY', amountMinor: 41200 }]]);
    expect(originals([[...row(0.1, 'ARAC ORNEK TR', '2,508,061.00', true), detail(0.13, '(TRY 7,310.00CR x 343.10)')]])).toEqual([['ARAC ORNEK TR', { currency: 'TRY', amountMinor: 731000 }]]);
    expect(originals([[...row(0.1, 'DUKKAN ORNEK JP', '123,630.00'), detail(0.13, '(JPY 1,300 × 95.10)')]])).toEqual([['DUKKAN ORNEK JP', { currency: 'JPY', amountMinor: 1300 }]]);
    // Dot thousands and comma decimals, with an uppercase X, read by the same amount parsing.
    expect(originals([[...row(0.1, 'KEDAI ORNEK KOTA ORNEK CN', '4.988.700'), detail(0.13, '(CNY 2.070,00 X 2.410,00)')]])).toEqual([['KEDAI ORNEK KOTA ORNEK CN', { currency: 'CNY', amountMinor: 207000 }]]);
    expect(originals([[...row(0.1, 'KEDAI ORNEK KOTA ORNEK CN', '385.600', true), detail(0.13, '(CNY 160,00 CR X 2.410,00)')]])).toEqual([['KEDAI ORNEK KOTA ORNEK CN', { currency: 'CNY', amountMinor: 16000 }]]);
  });

  it('ignores a detail whose figures are more than half a percent off the charged amount', () => {
    expect(originals([[...row(0.1, 'KAFE ORNEK CITY TR', '140,492.00'), detail(0.13, '(TRY 417.00 x 341.00)')]])).toEqual([['KAFE ORNEK CITY TR', null]]);
    // 0.4% off still pairs: a bank rounds the rate it prints.
    expect(originals([[...row(0.1, 'KAFE ORNEK CITY TR', '140,492.00'), detail(0.13, '(TRY 413.64 x 341.00)')]])).toEqual([['KAFE ORNEK CITY TR', { currency: 'TRY', amountMinor: 41364 }]]);
  });

  it('ignores a currency the app does not know, the card\'s own currency, and a credit that disagrees with the row', () => {
    expect(originals([[...row(0.1, 'KAFE ORNEK CITY', '140,492.00'), detail(0.13, '(QQQ 412.00 x 341.00)')]])).toEqual([['KAFE ORNEK CITY', null]]);
    expect(originals([[...row(0.1, 'KAFE ORNEK CITY', '140,492.00'), detail(0.13, '(IDR 140,492.00 x 1.00)')]])).toEqual([['KAFE ORNEK CITY', null]]);
    expect(originals([[...row(0.1, 'KAFE ORNEK CITY', '140,492.00'), detail(0.13, '(TRY 412.00CR x 341.00)')]])).toEqual([['KAFE ORNEK CITY', null]]);
    expect(originals([[...row(0.1, 'KAFE ORNEK CITY', '140,492.00', true), detail(0.13, '(TRY 412.00 x 341.00)')]])).toEqual([['KAFE ORNEK CITY', null]]);
  });

  it('keeps the first detail of a row and ignores a second', () => {
    expect(originals([[...row(0.1, 'KAFE ORNEK CITY', '140,492.00'), detail(0.13, '(TRY 412.00 x 341.00)'), detail(0.16, '(TRY 412.10 x 340.90)')]])).toEqual([['KAFE ORNEK CITY', { currency: 'TRY', amountMinor: 41200 }]]);
  });

  const muze = (y: number) => row(y, 'MUZE ORNEK TR', '28,552.00');
  const muzeDetail = (y: number) => detail(y, '(TRY 83.00 x 344.00)');
  const lokanta = (y: number) => row(y, 'LOKANTA ORNEK TR', '414,846.00');
  const lokantaDetail = (y: number) => detail(y, '(TRY 1,213.00 x 342.00)');
  const MUZE = ['MUZE ORNEK TR', { currency: 'TRY', amountMinor: 8300 }];
  const LOKANTA = ['LOKANTA ORNEK TR', { currency: 'TRY', amountMinor: 121300 }];
  const BULUT = ['BULUT ORNEK US', { currency: 'USD', amountMinor: 2100 }];

  it('gives a detail that opens a screenshot to the last row of the one before, and to nothing when it opens the first', () => {
    const first = [...muze(0.1), muzeDetail(0.13), ...lokanta(0.16)];
    const second = [lokantaDetail(0.05), ...row(0.1, 'BULUT ORNEK US', '338,730.00'), detail(0.13, '(USD 21.00 x 16,130.00)')];
    expect(originals([first, second])).toEqual([MUZE, LOKANTA, BULUT]);
    // Handed over the other way round, the opening detail has no row before it, and the figures refuse a wrong one.
    expect(originals([second, first])).toEqual([BULUT, MUZE, ['LOKANTA ORNEK TR', null]]);
    expect(originals([second])).toEqual([BULUT]);
  });

  it('where screenshots overlap, gives an opening detail to the row before the repeated run, and keeps a detail only the repeat shows', () => {
    // The first screenshot ends on LOKANTA with its detail cut off; the second repeats MUZE's detail and LOKANTA.
    const first = [...muze(0.1), muzeDetail(0.13), ...lokanta(0.16)];
    const second = [muzeDetail(0.05), ...lokanta(0.1), lokantaDetail(0.13), ...row(0.16, 'BULUT ORNEK US', '338,730.00')];
    expect(originals([first, second])).toEqual([MUZE, LOKANTA, ['BULUT ORNEK US', null]]);
  });

  it('gives an opening detail to a row first read on an earlier screenshot, when the screenshot before repeats it', () => {
    const first = [...muze(0.1)];
    // The second only repeats MUZE (its detail cut off again) and adds LOKANTA; the third repeats LOKANTA and opens on MUZE's detail.
    const second = [...muze(0.1), ...lokanta(0.16), lokantaDetail(0.19)];
    const third = [muzeDetail(0.05), ...lokanta(0.1)];
    expect(originals([first, second, third])).toEqual([MUZE, LOKANTA]);
  });

  it('reads a screenshot that holds only headings and a detail line: the detail goes to the row above, and the screenshot is not empty', () => {
    const headings = [line('Transaction Date', 0.08, 0.03, 0.1), line('Description', 0.35, 0.03, 0.1), line('Amount (IDR)', 0.8, 0.03, 0.1)];
    const reading = readStatement([[...muze(0.1)], [...headings, muzeDetail(0.1)]], period, 'IDR');
    expect(reading.rows.map((r) => [r.description, r.original ?? null])).toEqual([MUZE]);
    expect(reading.emptyImages).toEqual([]);
    // Headings alone still read as nothing.
    expect(readStatement([[...muze(0.1)], headings], period, 'IDR').emptyImages).toEqual([1]);
  });
});

describe('readStatement, fee words', () => {
  const feeOf = (description: string) =>
    readStatement([[line('24/02', 0.05, 0.1, 0.1), line(description, 0.25, 0.1), line('6,000.00', 0.85, 0.1)]], { start: '2026-02-01', end: '2026-02-28' }, 'IDR').rows[0]?.isFee;

  it('takes a charge, stamp duty in either spelling, interest and a late fee as fees', () => {
    for (const d of ['TRX NOTIFICATION CHARGE', 'BEA METERAI LUNAS', 'BEA MATERAI', 'BIAYA BUNGA', 'BIAYA KETERLAMBATAN', 'LATE CHARGE']) expect(feeOf(d), d).toBe(true);
  });

  it('leaves a shop whose name only contains the word alone', () => {
    for (const d of ['SUPERCHARGER ORNEK', 'CHARGEPOINT ORNEK', 'RECHARGE PULSA ORNEK', 'DISCHARGE ORNEK', 'BEAUTY ORNEK', 'BEA ORNEK BOUTIQUE', 'TOKO BUNGA MAWAR']) expect(feeOf(d), d).toBe(false);
  });
});

describe('readStatement, subtotal lines', () => {
  it('are neither rows nor the closing or previous balance', () => {
    const images = [[
      line('SUBTOTAL TRANSAKSI', 0.0, 0.1, 0.3), line('187.000', 0.85, 0.1),
      line('SUBTOTAL', 0.0, 0.15, 0.3), line('6.412', 0.85, 0.15),
      line('SUBTOTAL TAGIHAN', 0.0, 0.2, 0.3), line('6.412', 0.85, 0.2),
    ]];
    expect(readStatement(images, { start: '2026-04-04', end: '2026-05-03' }, 'IDR')).toEqual({ rows: [], closingMinor: null, previousMinor: null, emptyImages: [0] });
  });
});

describe('the day-month layouts through matching, with nothing recorded', () => {
  /** Each row's missing kind, the way the check prepares it: refund hints from the rows before it. */
  const kinds = (images: CaptureLine[][], period: { start: string; end: string }) => {
    const { rows } = readStatement(images, period, 'IDR');
    const hints = new Map(rows.map((r, i) => [i, looksLikeRefund(r, rows.filter((p) => p.direction === 'out' && p.on <= r.on))] as const));
    return matchStatement(rows, [], { period, trackPayments: true, refundHints: hints }).outcomes.map((o, i) => [rows[i]!.description, o.status === 'missing' ? o.as : o.status]);
  };

  it('takes interest and a late fee as fees, and a payment with CR as a card payment', () => {
    expect(kinds([dashNoYearShot()], { start: '2026-04-04', end: '2026-05-03' })).toEqual([
      ['KEDAI.ID *XY-AB-000KOTA ORNEK ID', 'purchase'],
      ['BIAYA BUNGA', 'fee'],
      ['BIAYA KETERLAMBATAN', 'fee'],
      ['PEMBAYARAN - BANK ORNEK', 'payment'],
      ['PEMBAYARAN - BANK ORNEK', 'payment'],
      ['KEDAI ORNEK KOTA ORNEK CN', 'purchase'],
      ['KEDAI ORNEK KOTA ORNEK CN', 'refund'],
    ]);
  });

  it('takes a hyphenated PAYMENT-THANK YOU as a card payment and BEA METERAI as a fee', () => {
    expect(kinds([slashNoYearShot()], { start: '2026-01-27', end: '2026-02-26' })).toEqual([
      ['SPBU 00-11111 Kota Orn IDN', 'purchase'],
      ['PAYMENT-THANK YOU', 'payment'],
      ['BENGKEL ORNEK RAYA', 'purchase'],
      ['GAMESTORE Ornek NET JPN', 'purchase'],
      ['SPBU 00-11112 Kota Orn IDN', 'purchase'],
      ['KIOS ORNEK 2', 'purchase'],
      ['BEA METERAI LUNAS', 'fee'],
    ]);
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

  it('drops the country codes and the cut-short city a statement glues on at the end', () => {
    expect(merchantKeyOf('KAFE ORNEK CITY KOTA ORNEK TR')).toBe('kafe ornek city kota ornek');
    expect(merchantKeyOf('PAY*KEDAI TEH ORNEK Kota Ornek CN')).toBe('pay kedai teh ornek kota ornek');
    expect(merchantKeyOf('GAMESTORE Ornek NET JPN')).toBe('gamestore ornek net');
    expect(merchantKeyOf('SPBU 00-11111 Jakarta Sela IDN')).toBe(merchantKeyOf('SPBU 00-11112 Jakarta Selatan IDN'));
    // A word that only ends in a country's letters stays.
    expect(merchantKeyOf('TOKO SENTR')).toBe('toko sentr');
  });
});
