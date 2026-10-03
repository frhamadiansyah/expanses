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
];
