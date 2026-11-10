import { describe, expect, it } from 'vitest';
import { capturedCategory, findDateTime, merchantKey, type RawCapture, readCapture, WORDS } from '../src/index';

/*
 * A card issuer's transaction email, handed over by a Shortcuts Mail automation as Title = Subject, Body = Body,
 * App = Sender. The body is a table — a row of labels, then a row of values, twice, then a status — and nobody knows
 * exactly how Mail flattens it, so each test below is one flattening. Every figure, digit and code here is invented.
 */
const email = (body: string, title = 'Contoh Credit Card Transaction Notification (do not reply)'): RawCapture => ({
  id: 'mail-1',
  kind: 'notification',
  capturedAt: '2026-11-03T09:42:10+07:00',
  app: 'alerts@bankcontoh.co.id',
  title,
  body,
  lines: [],
  imageFile: null,
});

const GREETING = ['Hi Pemegang Kartu Kredit Bank Contoh,', '', 'Anda baru saja melakukan transaksi dengan', 'Bank Contoh Kartu Kredit', ''];
const FOOTER = [
  '',
  'Jika Anda tidak merasa melakukan transaksi ini, segera hubungi layanan nasabah kami.',
  'Untuk pengembalian dana atau pembayaran tagihan, kunjungi situs kami. Biaya meterai Rp10.000 berlaku.',
  'Email ini dikirim secara otomatis, mohon tidak membalas email ini.',
];

/** One cell per line: three labels, three values, three labels, three values, then the status. */
const perCell = (values: { card?: string; merchant?: string; time?: string; currency?: string; amount?: string; status?: string[] } = {}) =>
  [
    ...GREETING,
    'Nomor Kartu',
    'Jenis Kartu',
    'Merchant',
    values.card ?? '**** **** **** 4732',
    'VISA',
    values.merchant ?? 'Tokobaju* B-QX7TPLM22',
    'Waktu Transaksi',
    'Mata Uang',
    'Jumlah',
    values.time ?? '03 Nov 26 09:41',
    values.currency ?? 'IDR',
    values.amount ?? '245,500',
    '',
    'Status',
    ...(values.status ?? ['Sukses/', 'Approved']),
    ...FOOTER,
  ].join('\n');

/** One row per line, cells apart by a separator: a tab, or two spaces and more. */
const perRow = (gap: string) =>
  [
    ...GREETING,
    ['Nomor Kartu', 'Jenis Kartu', 'Merchant'].join(gap),
    ['**** **** **** 4732', 'VISA', 'Tokobaju* B-QX7TPLM22'].join(gap),
    ['Waktu Transaksi', 'Mata Uang', 'Jumlah'].join(gap),
    ['03 Nov 26 09:41', 'IDR', '245,500'].join(gap),
    ['Status', 'Sukses/', 'Approved'].join(gap),
    ...FOOTER,
  ].join('\n');

/** Each label, then its value under it. */
const alternating = [
  ...GREETING,
  'Nomor Kartu',
  '**** 4732',
  '',
  'Jenis Kartu',
  'VISA',
  'Merchant',
  'Tokobaju* B-QX7TPLM22',
  'Waktu Transaksi',
  '03 Nov 26 09:41',
  'Mata Uang',
  'IDR',
  'Jumlah',
  '245,500',
  'Status',
  'Sukses/ Approved',
  ...FOOTER,
].join('\n');

describe('a transaction email read as a labelled table', () => {
  it.each([
    ['one cell per line', perCell()],
    ['one row per line, apart by tabs', perRow('\t')],
    ['one row per line, apart by spaces', perRow('    ')],
    ['each label then its value', alternating],
  ])('reads %s', (_, body) => {
    const reading = readCapture(email(body), WORDS, null);
    expect(reading.skipped).toBeNull();
    expect(reading.amount?.value).toEqual({ minor: 245_500, currency: 'IDR' });
    expect(reading.occurredAt?.value).toBe('2026-11-03T09:41');
    expect(reading.name?.value).toBe('Tokobaju* B-QX7TPLM22');
    expect(reading.accountHint).toBe('4732');
    expect(reading.type.value).toBe('spent');
  });

  it('reads an amount in the millions with its thousands marks', () => {
    const reading = readCapture(email(perCell({ amount: '1,250,000' })), WORDS, null);
    expect(reading.amount?.value).toEqual({ minor: 1_250_000, currency: 'IDR' });
  });

  it.each([
    ['SGD', '18.40', 1_840],
    ['USD', '12.50', 1_250],
    ['SGD', '1,018.40', 101_840],
  ])('reads a purchase in %s %s in that currency, with its cents', (currency, amount, minor) => {
    const reading = readCapture(email(perCell({ currency, amount })), WORDS, null);
    expect(reading.skipped).toBeNull();
    expect(reading.amount?.value).toEqual({ minor, currency });
  });

  it('reads a figure that wears its own currency mark', () => {
    const reading = readCapture(email(perCell({ currency: 'IDR', amount: 'IDR 245,500' })), WORDS, null);
    expect(reading.amount?.value).toEqual({ minor: 245_500, currency: 'IDR' });
  });

  it.each([
    ['Ditolak/', 'Declined'],
    ['Gagal', ''],
    ['Failed', ''],
  ])('skips a purchase whose status is %s %s', (one, two) => {
    const reading = readCapture(email(perCell({ status: [one, two].filter(Boolean) })), WORDS, null);
    expect(reading.skipped).toBe('declined');
    expect(reading.amount).toBeNull();
    expect(reading.accountHint).toBe('4732');
  });

  it('skips a status that does not say the purchase went through', () => {
    expect(readCapture(email(perCell({ status: ['Pending'] })), WORDS, null).skipped).toBe('declined');
  });

  it.each([['Berhasil'], ['Success']])('records a status of %s', (status) => {
    expect(readCapture(email(perCell({ status: [status] })), WORDS, null).skipped).toBeNull();
  });

  it('reads a table with no status at all as it reads any other', () => {
    const body = perCell().replace(/\nStatus\nSukses\/\nApproved/, '');
    const reading = readCapture(email(body), WORDS, null);
    expect(reading.skipped).toBeNull();
    expect(reading.amount?.value).toEqual({ minor: 245_500, currency: 'IDR' });
  });

  it('reads the English labels', () => {
    const body = [
      'Dear Cardholder,',
      'A transaction was made with a credit card.',
      'Card Number\tCard Type\tMerchant',
      'XXXX XXXX XXXX 9051\tMASTERCARD\tKEDAICONTOH*SNACKS 88A1',
      'Transaction Time\tCurrency\tAmount',
      '21 May 26 18:07\tSGD\t18.40',
      'Status\tApproved',
    ].join('\n');
    const reading = readCapture(email(body, 'Credit Card Transaction Alert'), WORDS, null);
    expect(reading.skipped).toBeNull();
    expect(reading.amount?.value).toEqual({ minor: 1_840, currency: 'SGD' });
    expect(reading.occurredAt?.value).toBe('2026-05-21T18:07');
    expect(reading.name?.value).toBe('KEDAICONTOH*SNACKS 88A1');
    expect(reading.accountHint).toBe('9051');
  });

  it.each([
    ['15 Agu 26 20:05', '2026-08-15T20:05'],
    ['07 Des 26 07:30', '2026-12-07T07:30'],
    ['21 Mei 26 00:00', '2026-05-21T00:00'],
    ['09 Okt 26 13:15', '2026-10-09T13:15'],
  ])('reads the time %s with an Indonesian month', (time, iso) => {
    expect(readCapture(email(perCell({ time })), WORDS, null).occurredAt?.value).toBe(iso);
  });

  it('is not misled by a long footer, its figures or its words', () => {
    const footer = Array.from({ length: 400 }, (_, index) =>
      index % 3 === 0
        ? 'Nikmati cashback hingga Rp500.000 dan refund ongkos kirim. Saldo poin dapat ditukar.'
        : '   Syarat dan ketentuan berlaku.      Hubungi 1500000 atau kunjungi situs kami.   ',
    );
    const body = `${perCell()}\n${footer.join('\n')}`;
    expect(body.length).toBeGreaterThan(20_000);
    const started = performance.now();
    const reading = readCapture(email(body), WORDS, null, { offers: 'skip' });
    const took = performance.now() - started;
    expect(reading.skipped).toBeNull();
    expect(reading.amount?.value).toEqual({ minor: 245_500, currency: 'IDR' });
    expect(reading.name?.value).toBe('Tokobaju* B-QX7TPLM22');
    expect(reading.type.value).toBe('spent');
    expect(took).toBeLessThan(500);
  });

  it('stays fast on a flattened table padded with runs of spaces and tabs', () => {
    const padded = `Jumlah${' '.repeat(60)}\t\t${' '.repeat(60)}Mata Uang${'\t'.repeat(40)}x`;
    const body = `${perCell()}\n${Array.from({ length: 500 }, () => padded).join('\n')}`;
    const started = performance.now();
    readCapture(email(body), WORDS, null);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('leaves a notification that only labels its figure inline as it was', () => {
    // One label and one value, written in a sentence: no table, so the reader it always went through reads it.
    const reading = readCapture(email('Merchant: KOPI CONTOH berhasil. Total: Rp38.000', 'Pembayaran'), WORDS, null);
    expect(reading.amount?.value).toEqual({ minor: 38_000, currency: 'IDR' });
    expect(reading.name?.value).toBe('KOPI CONTOH');
  });
});

describe('a short-year date with a month name', () => {
  it('reads DD Mon YY HH:MM as this century', () => {
    expect(findDateTime('03 Nov 26 09:41')).toBe('2026-11-03T09:41');
    expect(findDateTime('3 Agustus 26')).toBe('2026-08-03');
  });

  it('does not read a word that is no month, or a number run into more digits', () => {
    expect(findDateTime('12 Menit 30 detik')).toBeNull();
    expect(findDateTime('03 Nov 260')).toBeNull();
    // A four-digit year is still read as one.
    expect(findDateTime('03 Nov 2026 09:41')).toBe('2026-11-03T09:41');
  });
});

describe('a merchant with a reference code after its star', () => {
  it('matches every purchase at that merchant, whatever the code', () => {
    expect(merchantKey('Tokobaju* B-QX7TPLM22')).toBe(merchantKey('Tokobaju* C-8ZK2LMQ04'));
    expect(merchantKey('Tokobaju* B-QX7TPLM22')).toBe('tokobaju');
    expect(merchantKey('Ojek* A-7HNQWERTY31')).toBe(merchantKey('OJEK* B-2MZPLOKIJ90'));
    expect(merchantKey('Ojek* A-7HNQWERTY31')).not.toBe(merchantKey('Tokobaju* B-QX7TPLM22'));
  });

  it('files the next one under the category the last one went to', () => {
    const history = [{ description: 'Ojek* A-7HNQWERTY31', categoryId: 'cat-transport' }];
    expect(capturedCategory('Ojek* B-2MZPLOKIJ90', history)).toBe('cat-transport');
  });
});
