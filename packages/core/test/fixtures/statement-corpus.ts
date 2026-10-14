import type { CaptureLine, StatementPeriod, StatementReading, StatementRow } from '../../src/index';

/**
 * Made-up statement screenshots, as Apple Vision hands their lines over, and what each must be read as.
 *
 * Every merchant, number and amount is invented. The layouts are the shapes the owner meets: a two-date English
 * statement with `CR` markers, a one-date Indonesian statement with `K`, a minus refund, the summary page, a
 * December–January period, screenshots that overlap where the owner scrolled, header noise, and a blurred screenshot
 * that gave nothing. Columns come as separate lines on one height, the way Vision returns them.
 */
export const line = (text: string, x: number, y: number, w = 0.2, h = 0.02): CaptureLine => ({ text, box: [x, y, w, h], height: h });

/** A two-date row: posting date, transaction date, description, amount — at x 0.05 / 0.15 / 0.25 / 0.85. */
const twoDate = (y: number, posted: string, on: string, description: string, amount: string): CaptureLine[] => [
  line(posted, 0.05, y, 0.08),
  line(on, 0.15, y, 0.08),
  line(description, 0.25, y, 0.5),
  // Vision rarely puts a right-hand column on exactly the same height.
  line(amount, 0.85, y + 0.003, 0.12),
];

/** A one-date row: date, description, amount — at x 0.05 / 0.25 / 0.85. */
const oneDate = (y: number, on: string, description: string, amount: string): CaptureLine[] => [
  line(on, 0.05, y, 0.1),
  line(description, 0.25, y, 0.5),
  line(amount, 0.85, y, 0.12),
];

/**
 * A transaction-date-first layout, in a screenshot's own pixels (1206 wide): transaction date, posting date,
 * description, amount right-aligned, then `CR` in a column of its own. Dates print as `21-Mar-26`, amounts with cents
 * (`140,492.00`), and a foreign purchase is followed by a date-less detail line `(TRY 412.00 x 341.00)`.
 */
type PixelItem =
  | { kind: 'row'; y: number; on: string; posted: string; description: string; amount: string; cr?: true }
  | { kind: 'text'; y: number; x: number; text: string; h?: number };
const pxRow = (y: number, on: string, posted: string, description: string, amount: string, cr?: true): PixelItem =>
  cr ? { kind: 'row', y, on, posted, description, amount, cr } : { kind: 'row', y, on, posted, description, amount };
const pxText = (y: number, x: number, text: string, h?: number): PixelItem => (h === undefined ? { kind: 'text', y, x, text } : { kind: 'text', y, x, text, h });
/** A detail line sits in the description column. */
const pxDetail = (y: number, text: string): PixelItem => pxText(y, 426, text);
/** The two-line column headings every page repeats. */
const pxHeader = (y: number): PixelItem[] => [
  pxText(y, 94, 'Tanggal Transaksi', 16),
  pxText(y, 249, 'Tanggal Pembukuan', 16),
  pxText(y, 426, 'Keterangan', 16),
  pxText(y, 978, 'Jumlah', 16),
  pxText(y + 18, 94, 'Transaction Date', 14),
  pxText(y + 18, 249, 'Posting Date', 14),
  pxText(y + 18, 426, 'Description', 14),
  pxText(y + 18, 978, 'Amount (IDR)', 14),
];
/** A screenshot's Vision lines: columns at x 95 / 249 / 426, the amount ending at 1068, CR at 1087, text 13 px high. */
export function pixelShot(height: number, items: PixelItem[], width = 1206): CaptureLine[] {
  const GLYPH = 7.2;
  const at = (text: string, x: number, centre: number, w: number, h = 13): CaptureLine => ({
    text,
    box: [x / width, (centre - h / 2) / height, w / width, h / height],
    height: h / height,
  });
  return items.flatMap((item) => {
    if (item.kind === 'text') return [at(item.text, item.x, item.y, item.text.length * GLYPH, item.h)];
    const amountW = item.amount.length * GLYPH;
    const lines = [
      at(item.on, 95, item.y, 9 * GLYPH),
      at(item.posted, 249, item.y, 9 * GLYPH),
      at(item.description, 426, item.y, item.description.length * GLYPH),
      // A right-hand column rarely lands on exactly the same height.
      at(item.amount, 1068 - amountW, item.y + 1, amountW),
    ];
    if (item.cr) lines.push(at('CR', 1087, item.y + 1, 2 * GLYPH));
    return lines;
  });
}

/** Two screenshots of the transaction-date-first layout, in statement order. Every merchant and figure is invented. */
export const TRANSACTION_FIRST_SHOTS: CaptureLine[][] = [
  pixelShot(800, [
    pxRow(36, '07-Mar-26', '09-Mar-26', 'TOKO ROTI SENJA Kota OrnekID', '215,410.00'),
    pxRow(61, '12-Mar-26', '14-Mar-26', 'PAY*KEDAI TEH ORNEK Kota Ornek CN', '103,630.00'),
    pxDetail(86, '(CNY 43.00 x 2,410.00)'),
    pxRow(111, '16-Mar-26', '16-Mar-26', 'TRX NOTIFICATION CHARGE', '6,000.00'),
    pxRow(136, '21-Mar-26', '23-Mar-26', 'KAFE ORNEK CITY TR', '140,492.00'),
    // A page break between a row and its detail line: the footer, the next page's mark and headings, then the detail.
    pxText(200, 94, 'Hal / Page'),
    pxText(200, 978, 'Page 1 of 5'),
    pxText(260, 908, 'wordmark', 34),
    ...pxHeader(320),
    pxDetail(365, '(TRY 412.00 x 341.00)'),
    pxRow(390, '22-Mar-26', '24-Mar-26', 'ARAC KIRALAMA ORNEK KOTA ORNEK TR', '2,508,061.00', true),
    pxDetail(415, '(TRY 7,310.00CR x 343.10)'),
    pxRow(440, '24-Mar-26', '26-Mar-26', 'LOKANTA ORNEK KOTA ORNEK TR', '414,846.00'),
  ]),
  // The next screenshot opens on the headings and then the detail line of the last row above.
  pixelShot(400, [
    ...pxHeader(40),
    pxDetail(85, '(TRY 1,213.00 x 342.00)'),
    pxRow(110, '25-Mar-26', '27-Mar-26', 'MUZE ORNEK KOTA ORNEK TR', '28,552.00'),
    pxDetail(135, '(TRY 83.00 x 344.00)'),
    pxRow(160, '28-Mar-26', '30-Mar-26', 'BULUT ORNEK KOTA ORNEK US', '338,730.00'),
    pxDetail(185, '(USD 21.00 x 16,130.00)'),
  ]),
];

/**
 * A layout with day-month dates and no year (`02-MEI`), transaction date then posting date, dot thousands with no
 * decimals (`187.000`), `CR` in its own column, and date-less subtotal lines that carry amounts. Pixels of a 1340-wide
 * screenshot; every merchant and figure is invented.
 */
export function dashNoYearShot(): CaptureLine[] {
  const width = 1340;
  const height = 400;
  const GLYPH = 8;
  const at = (text: string, x: number, centre: number): CaptureLine => ({
    text,
    box: [x / width, (centre - 7) / height, (text.length * GLYPH) / width, 14 / height],
    height: 14 / height,
  });
  const amount = (text: string, centre: number) => at(text, 1275 - text.length * GLYPH, centre + 1);
  const row = (centre: number, on: string, posted: string, description: string[], figure: string, cr = false): CaptureLine[] => [
    at(on, 60, centre),
    at(posted, 245, centre),
    // The description can come as two lines where the statement spaces it out.
    ...description.map((d, i) => at(d, 390 + i * 120, centre)),
    amount(figure, centre),
    ...(cr ? [at('CR', 1300, centre + 1)] : []),
  ];
  return [
    ...row(20, '02-MEI', '02-MEI', ['KEDAI.ID', '*XY-AB-000KOTA ORNEK ID'], '187.000'),
    at('SUBTOTAL TRANSAKSI', 0, 62),
    amount('187.000', 62),
    ...row(98, '03-MEI', '03-MEI', ['BIAYA BUNGA'], '6.412'),
    ...row(134, '21-APR', '21-APR', ['BIAYA KETERLAMBATAN'], '1.875'),
    ...row(170, '03-MEI', '03-MEI', ['PEMBAYARAN - BANK ORNEK'], '187.000', true),
    ...row(206, '03-MEI', '03-MEI', ['PEMBAYARAN - BANK ORNEK'], '188.875', true),
    // Foreign rows: the detail line close under its row, dot thousands, comma decimals and an uppercase X.
    ...row(242, '10-APR', '11-APR', ['KEDAI ORNEK', 'KOTA ORNEK', 'CN'], '4.988.700'),
    at('(CNY 2.070,00 X 2.410,00)', 390, 262),
    ...row(290, '12-APR', '13-APR', ['KEDAI ORNEK', 'KOTA ORNEK', 'CN'], '385.600', true),
    at('(CNY 160,00CR X 2.410,00)', 390, 310),
    at('SUBTOTAL', 0, 350),
    amount('6.412', 350),
  ];
}

/**
 * A layout with numeric day/month dates and no year (`30/01`), transaction date then posting date, comma thousands
 * with cents (`275,000.00`), `CR` in its own column, a hyphenated payment row, stamp duty spelled `METERAI`, merchant
 * numbers inside the description, and a date-less subtotal with `CR`. Pixels of a 1420-wide screenshot; every
 * merchant and figure is invented.
 */
export function slashNoYearShot(): CaptureLine[] {
  const width = 1420;
  const height = 300;
  const GLYPH = 8;
  const at = (text: string, x: number, centre: number): CaptureLine => ({
    text,
    box: [x / width, (centre - 7) / height, (text.length * GLYPH) / width, 14 / height],
    height: 14 / height,
  });
  const amount = (text: string, centre: number) => at(text, 1345 - text.length * GLYPH, centre + 1);
  const row = (centre: number, on: string, posted: string, description: string[], figure: string, cr = false): CaptureLine[] => [
    at(on, 25, centre),
    at(posted, 205, centre),
    ...description.map((d, i) => at(d, 315 + i * 175, centre)),
    amount(figure, centre),
    ...(cr ? [at('CR', 1370, centre + 1)] : []),
  ];
  return [
    ...row(12, '30/01', '31/01', ['SPBU 00-11111', 'Kota Orn IDN'], '275,000.00'),
    ...row(37, '01/02', '01/02', ['PAYMENT-THANK YOU'], '1,150,000.00', true),
    ...row(62, '02/02', '02/02', ['BENGKEL ORNEK RAYA'], '215,000.00'),
    ...row(87, '06/02', '06/02', ['GAMESTORE', 'Ornek NET', 'JPN'], '612,700.00'),
    ...row(112, '14/02', '15/02', ['SPBU 00-11112', 'Kota Orn IDN'], '410,000.00'),
    ...row(137, '19/02', '19/02', ['KIOS ORNEK 2'], '35,000.00'),
    ...row(162, '24/02', '24/02', ['BEA METERAI LUNAS'], '6,000.00'),
    at('SUBTOTAL', 315, 187),
    amount('1,234,600.00', 187),
    at('CR', 1370, 188),
  ];
}

const MAY_JUN: StatementPeriod = { start: '2026-05-11', end: '2026-06-10' };

const row = (on: string, description: string, amountMinor: number, extra: Partial<StatementRow> = {}): StatementRow => ({
  on,
  postedOn: null,
  description,
  amountMinor,
  direction: 'out',
  isFee: false,
  image: 0,
  ...extra,
});

const reading = (rows: StatementRow[], extra: Partial<StatementReading> = {}): StatementReading => ({
  rows,
  closingMinor: null,
  previousMinor: null,
  emptyImages: [],
  ...extra,
});

export interface StatementCase {
  name: string;
  images: CaptureLine[][];
  period: StatementPeriod;
  currency: string;
  expected: StatementReading;
}

/** Eight overlapping-scroll rows: r1..r8. */
const scrollRows = [
  ['12MAY', 'TOKO ALFA', '21,000'],
  ['13MAY', 'TOKO BETA', '32,500'],
  ['14MAY', 'TOKO GAMA', '43,000'],
  ['15MAY', 'TOKO DELTA', '54,000'],
  ['16MAY', 'TOKO EPSILON', '65,000'],
  ['17MAY', 'TOKO ZETA', '76,000'],
  ['18MAY', 'TOKO ETA', '87,000'],
  ['19MAY', 'TOKO TETA', '98,000'],
] as const;
const scrollImage = (from: number, to: number): CaptureLine[] =>
  scrollRows.slice(from, to).flatMap(([on, description, amount], i) => oneDate(0.1 + i * 0.05, on, description, amount));

export const STATEMENT_CORPUS: StatementCase[] = [
  {
    name: 'a two-date English layout: posting date then transaction date, CR money in, a stamp-duty fee',
    images: [
      [
        line('Post Date', 0.05, 0.05, 0.08),
        line('Trans Date', 0.15, 0.05, 0.08),
        line('Description', 0.25, 0.05),
        line('Amount (IDR)', 0.85, 0.05, 0.12),
        ...twoDate(0.1, '07MAY', '06MAY', 'KOPI SENJA JAKARTA SLT ID', '127,050'),
        ...twoDate(0.14, '08MAY', '08MAY', '0811000000 JKT ID ID', '8,786,844CR'),
        ...twoDate(0.18, '03JUN', '03JUN', 'STAMP DUTY FEE', '10,000'),
      ],
    ],
    period: MAY_JUN,
    currency: 'IDR',
    expected: reading([
      row('2026-05-06', 'KOPI SENJA JAKARTA SLT ID', 127050, { postedOn: '2026-05-07' }),
      row('2026-05-08', '0811000000 JKT ID ID', 8786844, { postedOn: '2026-05-08', direction: 'in' }),
      row('2026-06-03', 'STAMP DUTY FEE', 10000, { postedOn: '2026-06-03', isFee: true }),
    ]),
  },
  {
    name: 'a one-date Indonesian layout: DD/MM dates, dot thousands, a K marker for money in',
    images: [
      [
        ...oneDate(0.1, '06/05', 'TOKO BUKU', '55.000'),
        ...oneDate(0.15, '09/05', 'PEMBAYARAN - TERIMA KASIH', '1.000.000 K'),
      ],
    ],
    period: { start: '2026-05-01', end: '2026-05-31' },
    currency: 'IDR',
    expected: reading([
      row('2026-05-06', 'TOKO BUKU', 55000),
      row('2026-05-09', 'PEMBAYARAN - TERIMA KASIH', 1000000, { direction: 'in' }),
    ]),
  },
  {
    name: 'a minus amount is money in, and a printed year is used as printed',
    images: [[...oneDate(0.1, '12 Mei 2026', 'REFUND TOKO ABC', '-250.000')]],
    period: MAY_JUN,
    currency: 'IDR',
    expected: reading([row('2026-05-12', 'REFUND TOKO ABC', 250000, { direction: 'in' })]),
  },
  {
    name: 'the summary screenshot gives the previous and the new balance, and no rows',
    images: [
      [
        line('Statement Summary', 0.05, 0.05, 0.4),
        line('Previous Balance', 0.05, 0.1, 0.3),
        line('12,000,000', 0.85, 0.1, 0.12),
        line('New Balance', 0.05, 0.15, 0.3),
        line('19,214,880', 0.85, 0.15, 0.12),
      ],
    ],
    period: MAY_JUN,
    currency: 'IDR',
    expected: reading([], { previousMinor: 12000000, closingMinor: 19214880 }),
  },
  {
    name: 'a December–January statement places each row in its own year',
    images: [
      [
        ...oneDate(0.1, '15DEC', 'TOKO AKHIR TAHUN', '150,000'),
        ...oneDate(0.15, '05JAN', 'TOKO AWAL TAHUN', '75,000'),
      ],
    ],
    period: { start: '2026-12-11', end: '2027-01-10' },
    currency: 'IDR',
    expected: reading([row('2026-12-15', 'TOKO AKHIR TAHUN', 150000), row('2027-01-05', 'TOKO AWAL TAHUN', 75000)]),
  },
  {
    name: 'the run repeated where two screenshots overlap is read once',
    images: [scrollImage(0, 5), scrollImage(3, 8)],
    period: MAY_JUN,
    currency: 'IDR',
    expected: reading([
      row('2026-05-12', 'TOKO ALFA', 21000),
      row('2026-05-13', 'TOKO BETA', 32500),
      row('2026-05-14', 'TOKO GAMA', 43000),
      row('2026-05-15', 'TOKO DELTA', 54000),
      row('2026-05-16', 'TOKO EPSILON', 65000),
      row('2026-05-17', 'TOKO ZETA', 76000, { image: 1 }),
      row('2026-05-18', 'TOKO ETA', 87000, { image: 1 }),
      row('2026-05-19', 'TOKO TETA', 98000, { image: 1 }),
    ]),
  },
  {
    name: 'two identical rows inside one screenshot are two real purchases',
    images: [
      [
        ...twoDate(0.1, '07MAY', '06MAY', 'KEDAI TEH SORE JAKARTA ID', '113,190'),
        ...twoDate(0.14, '07MAY', '06MAY', 'KEDAI TEH SORE JAKARTA ID', '113,190'),
      ],
    ],
    period: MAY_JUN,
    currency: 'IDR',
    expected: reading([
      row('2026-05-06', 'KEDAI TEH SORE JAKARTA ID', 113190, { postedOn: '2026-05-07' }),
      row('2026-05-06', 'KEDAI TEH SORE JAKARTA ID', 113190, { postedOn: '2026-05-07' }),
    ]),
  },
  {
    name: 'header lines — title, card number, due date, page number — are not rows',
    images: [
      [
        line('CREDIT CARD STATEMENT', 0.05, 0.02, 0.5),
        line('Card number 4XXX XXXX XXXX 1234', 0.05, 0.05, 0.5),
        line('Payment due 15JUN', 0.05, 0.08, 0.3),
        ...oneDate(0.15, '20MAY', 'APOTEK SEHAT', '88,000'),
        line('Page 2 of 5', 0.4, 0.95, 0.2),
        line('2', 0.85, 0.98, 0.05),
      ],
    ],
    period: MAY_JUN,
    currency: 'IDR',
    expected: reading([row('2026-05-20', 'APOTEK SEHAT', 88000)]),
  },
  {
    name: 'a blurred screenshot that gave no line is named as empty',
    images: [
      [...oneDate(0.1, '21MAY', 'BENGKEL MAJU', '300,000')],
      [line('New Balance', 0.05, 0.1, 0.3), line('300,000', 0.85, 0.1, 0.12)],
      [],
    ],
    period: MAY_JUN,
    currency: 'IDR',
    expected: reading([row('2026-05-21', 'BENGKEL MAJU', 300000)], { closingMinor: 300000, emptyImages: [2] }),
  },
  {
    name: 'a date printed with its year on a line of its own is a heading, not a transaction of its year in rupiah',
    images: [[line('12 Mei 2026', 0.05, 0.05, 0.3), ...oneDate(0.1, '12 Mei 2026', 'TOKO ROTI', '45.000')]],
    period: MAY_JUN,
    currency: 'IDR',
    expected: reading([row('2026-05-12', 'TOKO ROTI', 45000)]),
  },
  {
    name: "a description that starts with a number and a month-like word is not a second date",
    images: [
      [
        ...oneDate(0.1, '06/05', '3 MAYBERRY CLINIC', '150.000'),
        ...oneDate(0.15, '07/05', '2 MARKET STREET', '20.000'),
        ...oneDate(0.2, '08 Mei', '9 Mei Bakery', '30.000'),
      ],
    ],
    period: { start: '2026-05-01', end: '2026-05-31' },
    currency: 'IDR',
    // `08 Mei` then `9 Mei` has the shape of two word dates, so it is read as two dates: the earlier is the
    // transaction, the later the posting, as with any two dates.
    expected: reading([
      row('2026-05-06', '3 MAYBERRY CLINIC', 150000),
      row('2026-05-07', '2 MARKET STREET', 20000),
      row('2026-05-08', 'Bakery', 30000, { postedOn: '2026-05-09' }),
    ]),
  },
  {
    name: 'interest is a fee only when it says so: a florist is not a charge',
    images: [
      [
        ...oneDate(0.1, '14/05', 'TOKO BUNGA MAWAR', '120.000'),
        ...oneDate(0.15, '31/05', 'BIAYA BUNGA', '35.000'),
        ...oneDate(0.2, '31/05', 'BUNGA KARTU KREDIT', '12.000'),
      ],
    ],
    period: { start: '2026-05-01', end: '2026-05-31' },
    currency: 'IDR',
    expected: reading([
      row('2026-05-14', 'TOKO BUNGA MAWAR', 120000),
      row('2026-05-31', 'BIAYA BUNGA', 35000, { isFee: true }),
      row('2026-05-31', 'BUNGA KARTU KREDIT', 12000, { isFee: true }),
    ]),
  },
  {
    name: 'a transaction-date-first layout: DD-Mon-YY dates, cents printed, CR in its own column, a notification charge, foreign detail lines across a page break and a screenshot seam',
    images: TRANSACTION_FIRST_SHOTS,
    period: { start: '2026-03-06', end: '2026-04-05' },
    currency: 'IDR',
    expected: reading([
      row('2026-03-07', 'TOKO ROTI SENJA Kota OrnekID', 215410, { postedOn: '2026-03-09' }),
      row('2026-03-12', 'PAY*KEDAI TEH ORNEK Kota Ornek CN', 103630, { postedOn: '2026-03-14', original: { currency: 'CNY', amountMinor: 4300 } }),
      row('2026-03-16', 'TRX NOTIFICATION CHARGE', 6000, { postedOn: '2026-03-16', isFee: true }),
      row('2026-03-21', 'KAFE ORNEK CITY TR', 140492, { postedOn: '2026-03-23', original: { currency: 'TRY', amountMinor: 41200 } }),
      row('2026-03-22', 'ARAC KIRALAMA ORNEK KOTA ORNEK TR', 2508061, { postedOn: '2026-03-24', direction: 'in', original: { currency: 'TRY', amountMinor: 731000 } }),
      row('2026-03-24', 'LOKANTA ORNEK KOTA ORNEK TR', 414846, { postedOn: '2026-03-26', original: { currency: 'TRY', amountMinor: 121300 } }),
      row('2026-03-25', 'MUZE ORNEK KOTA ORNEK TR', 28552, { postedOn: '2026-03-27', image: 1, original: { currency: 'TRY', amountMinor: 8300 } }),
      row('2026-03-28', 'BULUT ORNEK KOTA ORNEK US', 338730, { postedOn: '2026-03-30', image: 1, original: { currency: 'USD', amountMinor: 2100 } }),
    ]),
  },
  {
    name: 'a day-month layout with no year (02-MEI), dot thousands with no decimals, CR in its own column, subtotals that are neither rows nor balances, and comma-decimal detail lines',
    images: [dashNoYearShot()],
    period: { start: '2026-04-04', end: '2026-05-03' },
    currency: 'IDR',
    expected: reading([
      row('2026-05-02', 'KEDAI.ID *XY-AB-000KOTA ORNEK ID', 187000, { postedOn: '2026-05-02' }),
      row('2026-05-03', 'BIAYA BUNGA', 6412, { postedOn: '2026-05-03', isFee: true }),
      row('2026-04-21', 'BIAYA KETERLAMBATAN', 1875, { postedOn: '2026-04-21', isFee: true }),
      row('2026-05-03', 'PEMBAYARAN - BANK ORNEK', 187000, { postedOn: '2026-05-03', direction: 'in' }),
      row('2026-05-03', 'PEMBAYARAN - BANK ORNEK', 188875, { postedOn: '2026-05-03', direction: 'in' }),
      row('2026-04-10', 'KEDAI ORNEK KOTA ORNEK CN', 4988700, { postedOn: '2026-04-11', original: { currency: 'CNY', amountMinor: 207000 } }),
      row('2026-04-12', 'KEDAI ORNEK KOTA ORNEK CN', 385600, { postedOn: '2026-04-13', direction: 'in', original: { currency: 'CNY', amountMinor: 16000 } }),
    ]),
  },
  {
    name: 'a numeric day/month layout with no year (30/01): transaction then posting date across a month boundary, a hyphenated payment, METERAI stamp duty, and a subtotal with CR',
    images: [slashNoYearShot()],
    period: { start: '2026-01-27', end: '2026-02-26' },
    currency: 'IDR',
    expected: reading([
      row('2026-01-30', 'SPBU 00-11111 Kota Orn IDN', 275000, { postedOn: '2026-01-31' }),
      row('2026-02-01', 'PAYMENT-THANK YOU', 1150000, { postedOn: '2026-02-01', direction: 'in' }),
      row('2026-02-02', 'BENGKEL ORNEK RAYA', 215000, { postedOn: '2026-02-02' }),
      row('2026-02-06', 'GAMESTORE Ornek NET JPN', 612700, { postedOn: '2026-02-06' }),
      row('2026-02-14', 'SPBU 00-11112 Kota Orn IDN', 410000, { postedOn: '2026-02-15' }),
      row('2026-02-19', 'KIOS ORNEK 2', 35000, { postedOn: '2026-02-19' }),
      row('2026-02-24', 'BEA METERAI LUNAS', 6000, { postedOn: '2026-02-24', isFee: true }),
    ]),
  },
];
