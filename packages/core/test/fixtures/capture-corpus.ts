import type { CaptureLine, MoveType, RawCapture, Reading } from '../../src/index';

/**
 * Made-up captures, and what each one must be read as.
 *
 * Every account number, merchant and person here is invented, and every sample is a shape the owner will actually
 * meet: a bank's transfer notification, a wallet's QR confirmation, a card alert, a receipt photographed at a till.
 * The corpus is the guard against a reader that only handles the examples in its own test file — it is read by
 * `capture-corpus.test.ts`, which asserts every field of every sample.
 */
export interface CorpusCase {
  name: string;
  capture: RawCapture;
  expected: {
    skipped: Reading['skipped'];
    amount?: { minor: number; currency: string | null } | null;
    type?: MoveType;
    name?: string | null;
    occurredAt?: string | null;
    accountHint?: string | null;
    /** The line an image's amount came from, when the sample is an image. */
    line?: number | null;
  };
}

const CAPTURED = '2026-09-29T08:12:00+07:00';

/** A notification that says one thing. */
function note(name: string, body: string, expected: CorpusCase['expected'], title: string | null = null): CorpusCase {
  return {
    name,
    capture: { id: `n-${name}`, kind: 'notification', capturedAt: CAPTURED, app: 'Notifikasi', title, body, lines: [], imageFile: null },
    expected,
  };
}

/** A screen read off an image: one line per string, in reading order. `tall` marks the lines set in larger type. */
function shot(name: string, texts: string[], expected: CorpusCase['expected'], tall: number[] = []): CorpusCase {
  const lines: CaptureLine[] = texts.map((text, index) => ({
    text,
    box: [0.08, 0.04 + index * 0.04, 0.84, 0.03],
    height: tall.includes(index) ? 0.08 : 0.03,
  }));
  return {
    name,
    capture: { id: `s-${name}`, kind: 'screen', capturedAt: CAPTURED, app: null, title: null, body: null, lines, imageFile: `${name}.png` },
    expected,
  };
}

export const CORPUS: readonly CorpusCase[] = [
  note(
    'transfer out with a balance under it',
    'Transfer Rp250.000 ke BUDI SANTOSO berhasil. Saldo Rp1.750.000',
    { skipped: null, amount: { minor: 25_000_000, currency: 'IDR' }, type: 'spent', name: 'BUDI SANTOSO' },
  ),
  note('QRIS payment', 'Pembayaran QRIS Rp45.500 ke WARUNG KOPI berhasil', {
    skipped: null,
    amount: { minor: 4_550_000, currency: 'IDR' },
    type: 'spent',
    name: 'WARUNG KOPI',
  }),
  note('wallet payment with the balance beside it', 'Pembayaran Rp38.000 ke KOPI KENANGAN berhasil. Saldo Rp1.212.000', {
    skipped: null,
    amount: { minor: 3_800_000, currency: 'IDR' },
    type: 'spent',
    name: 'KOPI KENANGAN',
  }),
  note('top-up, with the balance it made', 'Top up saldo Rp200.000 berhasil. Saldo Rp1.412.000', {
    skipped: null,
    amount: { minor: 20_000_000, currency: 'IDR' },
    type: 'topup',
  }),
  note('money in, with the sender', 'Dana masuk Rp 5.000.000 dari PT MAJU JAYA', {
    skipped: null,
    amount: { minor: 500_000_000, currency: 'IDR' },
    type: 'received',
    name: 'PT MAJU JAYA',
  }),
  note('refund, with the shop', 'Refund Rp125.000 dari TOKO MAKMUR telah dikembalikan', {
    skipped: null,
    amount: { minor: 12_500_000, currency: 'IDR' },
    type: 'refund',
    name: 'TOKO MAKMUR',
  }),
  note('an offer is not money', 'Diskon 20% hingga Rp50.000 di RESTO PADANG. Pakai kode HEMAT', {
    skipped: 'promo',
    amount: null,
    name: null,
  }),
  note('an OTP carries no money', 'Kode OTP Anda 123456. Jangan berikan kepada siapa pun.', {
    skipped: 'unreadable',
    amount: null,
    name: null,
  }),
  note('card purchase, with the masked card', 'Kartu ···· 4321 dipakai Rp1.250.000 di TIKET.COM', {
    skipped: null,
    amount: { minor: 125_000_000, currency: 'IDR' },
    type: 'spent',
    name: 'TIKET.COM',
    accountHint: '4321',
  }),
  note('cash withdrawal, with what is left', 'Tarik tunai Rp2.000.000 berhasil. Sisa saldo Rp500.000', {
    skipped: null,
    amount: { minor: 200_000_000, currency: 'IDR' },
    type: 'spent',
  }),
  note('a bill payment that names no one', 'Pembayaran tagihan Rp1.500.000 untuk PLN berhasil', {
    skipped: null,
    amount: { minor: 150_000_000, currency: 'IDR' },
    type: 'spent',
    name: null,
  }),
  note('a send, with the person', 'Kirim Rp75.000 ke SINTA DEWI berhasil', {
    skipped: null,
    amount: { minor: 7_500_000, currency: 'IDR' },
    type: 'spent',
    name: 'SINTA DEWI',
  }),
  note('money in from a person', 'Terima Rp300.000 dari ANDI PRATAMA', {
    skipped: null,
    amount: { minor: 30_000_000, currency: 'IDR' },
    type: 'received',
    name: 'ANDI PRATAMA',
  }),
  note('a reload', 'Isi ulang Rp50.000 berhasil. Saldo Rp100.000', {
    skipped: null,
    amount: { minor: 5_000_000, currency: 'IDR' },
    type: 'topup',
  }),
  note('a figure written in thousands shorthand', 'Bayar 25rb ke PARKIR MAS berhasil', {
    skipped: null,
    amount: { minor: 2_500_000, currency: null },
    type: 'spent',
    name: 'PARKIR MAS',
  }),
  note('a figure written in millions shorthand, with a decimal', 'Pembayaran 1,5jt ke TOKO ELEKTRONIK berhasil', {
    skipped: null,
    amount: { minor: 150_000_000, currency: null },
    type: 'spent',
    name: 'TOKO ELEKTRONIK',
  }),
  note('a printed date and time', 'Pembayaran Rp38.000 berhasil pada 29 Sep 2026 08:12', {
    skipped: null,
    amount: { minor: 3_800_000, currency: 'IDR' },
    type: 'spent',
    name: null,
    occurredAt: '2026-09-29T08:12',
  }),
  note('a printed date, day first', 'Pembayaran Rp38.000 ke TOKO ABC berhasil pada 29/09/2026 08:12', {
    skipped: null,
    amount: { minor: 3_800_000, currency: 'IDR' },
    type: 'spent',
    name: 'TOKO ABC',
    occurredAt: '2026-09-29T08:12',
  }),
  note('English payment, with the balance in its own sentence', 'Payment of $12.50 to BLUE BOTTLE COFFEE was successful. Balance $120.00', {
    skipped: null,
    amount: { minor: 1_250, currency: 'USD' },
    type: 'spent',
    name: 'BLUE BOTTLE COFFEE',
  }),
  note('English money in', 'You received $250.00 from ACME SUPPLIES', {
    skipped: null,
    amount: { minor: 25_000, currency: 'USD' },
    type: 'received',
    name: 'ACME SUPPLIES',
  }),
  note('English refund', 'Refund of $9.99 from STREAMING CO', {
    skipped: null,
    amount: { minor: 999, currency: 'USD' },
    type: 'refund',
    name: 'STREAMING CO',
  }),
  note('English offer', 'Get 10% cashback on your next purchase', { skipped: 'promo', amount: null, name: null }),
  note('English top-up', 'Top up $20.00 successful. Available balance $45.00', {
    skipped: null,
    amount: { minor: 2_000, currency: 'USD' },
    type: 'topup',
  }),
  note('English card alert, with the masked card', 'Card ending **7788 was charged $45.00 at GREENGROCER', {
    skipped: null,
    amount: { minor: 4_500, currency: 'USD' },
    type: 'spent',
    name: 'GREENGROCER',
    accountHint: '7788',
  }),
  note('English withdrawal from the account', 'Withdrawal of $100.00 from your account', {
    skipped: null,
    amount: { minor: 10_000, currency: 'USD' },
    type: 'spent',
    name: null,
  }),
  note('a statement notice with no figure', 'Your statement is ready. Open the app to view it.', {
    skipped: 'unreadable',
    amount: null,
    name: null,
  }),
  note('English send, with the receiver', 'Sent $75.50 to LANDLORD SERVICES. Balance: $1,024.50', {
    skipped: null,
    amount: { minor: 7_550, currency: 'USD' },
    type: 'spent',
    name: 'LANDLORD SERVICES',
  }),
  note('a payment named in English over a rupiah figure', 'Your payment of Rp 1.250.000 to ACARA WEDDING was successful', {
    skipped: null,
    amount: { minor: 125_000_000, currency: 'IDR' },
    type: 'spent',
    name: 'ACARA WEDDING',
  }),
  note('a rupiah figure written with its cents', 'Pembayaran Rp1.250.000,00 ke BUTIK ANGGUN berhasil', {
    skipped: null,
    amount: { minor: 125_000_000, currency: 'IDR' },
    type: 'spent',
    name: 'BUTIK ANGGUN',
  }),
  note('a rupiah code with English grouping', 'IDR 1,250,000.00 transferred to GLOBAL SUPPLIER PVT', {
    skipped: null,
    amount: { minor: 125_000_000, currency: 'IDR' },
    type: 'spent',
    name: 'GLOBAL SUPPLIER PVT',
  }),
  note('a card with middle-dot masking', 'Kartu ···· 9087 dipakai Rp89.000 di APOTEK SEHAT', {
    skipped: null,
    amount: { minor: 8_900_000, currency: 'IDR' },
    type: 'spent',
    name: 'APOTEK SEHAT',
    accountHint: '9087',
  }),
  note('Singapore dollars', 'Payment S$15.00 to HAWKER CHAN', {
    skipped: null,
    amount: { minor: 1_500, currency: 'SGD' },
    type: 'spent',
    name: 'HAWKER CHAN',
  }),
  note('Malaysian ringgit', 'Payment RM42.00 to KEDAI KOPI', {
    skipped: null,
    amount: { minor: 4_200, currency: 'MYR' },
    type: 'spent',
    name: 'KEDAI KOPI',
  }),

  // ── Screens and receipts, read off an image ────────────────────────────────────────────────────────────────────
  shot(
    'transfer success screen',
    ['Transaksi Berhasil', 'Transfer ke', 'BUDI SANTOSO', 'Nominal Transfer', 'Rp250.000', 'Biaya Admin Rp2.500', 'Saldo Akhir Rp1.750.000', '29 Sep 2026 08:12'],
    {
      skipped: null,
      amount: { minor: 25_000_000, currency: 'IDR' },
      type: 'spent',
      name: 'BUDI SANTOSO',
      occurredAt: '2026-09-29T08:12',
      line: 4,
    },
  ),
  shot(
    'wallet success screen with the total over the figure',
    ['Transaksi Berhasil', 'Pembayaran ke', 'Kopi Kenangan', 'Total Bayar', 'Rp38.000', 'Saldo Rp1.212.000'],
    { skipped: null, amount: { minor: 3_800_000, currency: 'IDR' }, type: 'spent', name: 'Kopi Kenangan', line: 4 },
  ),
  shot(
    'paper receipt with a total and a tax line',
    ['TOKO SEJAHTERA', 'Kopi Susu 2x   Rp40.000', 'Roti Bakar 1x   Rp25.000', 'TOTAL   Rp65.000', 'PPN 11%   Rp7.150', 'Tunai   Rp100.000', 'Kembali   Rp35.000'],
    { skipped: null, amount: { minor: 6_500_000, currency: 'IDR' }, type: 'spent', name: null, line: 3 },
  ),
  shot(
    'invoice, in English',
    ['INVOICE', 'Vendor: ACME SUPPLIES', 'Subtotal $1,200.00', 'Tax $132.00', 'Amount Due $1,332.00', 'Due 15 Oct 2026'],
    { skipped: null, amount: { minor: 133_200, currency: 'USD' }, type: 'spent', name: null, occurredAt: '2026-10-15', line: 4 },
  ),
  shot(
    'a screen that shouts its amount, with no label at all',
    ['Pembayaran Berhasil', 'Rp1.250.000', 'ke TOKO ELEKTRONIK', 'Saldo Rp500.000'],
    { skipped: null, amount: { minor: 125_000_000, currency: 'IDR' }, type: 'spent', name: 'TOKO ELEKTRONIK', line: 1 },
    [1],
  ),
  shot(
    'QRIS screen with a service fee and the funding card',
    ['QRIS', 'Merchant:', 'WARUNG SATE PAK ALI', 'Total Bayar', 'Rp45.500', 'Biaya Layanan Rp500', 'Sumber Dana ···· 1234', 'Saldo Rp200.000'],
    { skipped: null, amount: { minor: 4_550_000, currency: 'IDR' }, type: 'spent', name: 'WARUNG SATE PAK ALI', accountHint: '1234', line: 4 },
  ),
  shot(
    'refund screen, in English',
    ['Refund issued', 'Refunded $9.99 to your card ending 4321', 'Reference RF-8891', '3 Oct 2026'],
    { skipped: null, amount: { minor: 999, currency: 'USD' }, type: 'refund', name: null, line: 1 },
  ),
  shot('a statement fragment with one movement', ['Ringkasan Transaksi', '04 Okt 2026', 'Debit Rp120.000'], {
    skipped: null,
    amount: { minor: 12_000_000, currency: 'IDR' },
    type: 'spent',
    name: null,
    occurredAt: '2026-10-04',
    line: 2,
  }),
];
