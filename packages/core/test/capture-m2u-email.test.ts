import { describe, expect, it } from 'vitest';
import { type RawCapture, readCapture, WORDS } from '../src/index';

/*
 * A bank's app emails each debit as "Label <tab> : value" lines (M2U-style), handed over by a Shortcuts Mail automation.
 * Every figure, digit, name and code here is invented.
 */
const email = (body: string, title: string | null = 'Notifikasi Transaksi'): RawCapture => ({
  id: 'mail-m2u',
  kind: 'notification',
  capturedAt: '2026-11-05T14:08:00+07:00',
  app: 'advisor@bankcontoh.co.id',
  title,
  body,
  lines: [],
  imageFile: null,
});

const LINES: [string, string][] = [
  ['Tanggal dan Jam', '05/11/2026, 14:07:22'],
  ['Tipe Transaksi', 'QR Pembayaran'],
  ['Dari Rekening', '****4821 IDR'],
  ['Nama Merchant', 'Toko Bunga Melati, Kebayo'],
  ['Nama Kota', 'JAKARTA BARAT'],
  ['Kode Pos', '11530'],
  ['Kode Negara', 'ID'],
  ['Pengakuisisi', 'Dompet Contoh'],
  ['MPAN', '9360000000000000017'],
  ['CPAN', '9360000000000000025'],
  ['Terminal ID', 'B07'],
  ['Jumlah', 'IDR 245,500.00'],
  ['Biaya Transaksi', 'IDR 0.00'],
  ['Status', 'Sukses'],
  ['Nomor Referensi', 'X0000000001'],
];
const HEAD = 'Terima kasih Anda telah menggunakan aplikasi Bank Contoh. Berikut ini adalah aktivitas yang telah Anda lakukan:';
const FOOT = [
  'Email ini dikirimkan secara otomatis, harap tidak membalas. Jika Anda memerlukan bantuan, silakan menghubungi layanan nasabah di 1500000.',
  '',
  'Hormat kami,',
  'PT. Bank Contoh Indonesia, Tbk',
];
const body = (separator: string) => [HEAD, '', ...LINES.map(([label, value]) => `${label}${separator}${value}`), ...FOOT].join('\n');

describe('a debit email written as label, colon, value', () => {
  it.each([
    ['a tab then a colon', '\t: '],
    ['spaces around the colon', ' : '],
    ['a colon right after the label', ': '],
    ['a tab, the colon, and a no-break space', '\t:\u00a0'],
  ])('reads %s', (_, separator) => {
    const reading = readCapture(email(body(separator)), WORDS, null);
    expect(reading.skipped).toBeNull();
    expect(reading.type.value).toBe('spent');
    expect(reading.amount?.value).toEqual({ minor: 245_500, currency: 'IDR' });
    expect(reading.occurredAt?.value).toBe('2026-11-05T14:07');
    expect(reading.name?.value).toBe('Toko Bunga Melati, Kebayo');
    expect(reading.accountHint).toBe('4821');
  });

  it('reads it without a subject too', () => {
    const reading = readCapture(email(body('\t: '), null), WORDS, null);
    expect(reading.name?.value).toBe('Toko Bunga Melati, Kebayo');
    expect(reading.amount?.value).toEqual({ minor: 245_500, currency: 'IDR' });
  });

  it('skips one whose status says it failed', () => {
    const failed = body('\t: ').replace('Status\t: Sukses', 'Status\t: Gagal');
    expect(readCapture(email(failed), WORDS, null).skipped).toBe('declined');
  });
});

/* A card issuer's email with "Label <tab> : <tab> value" lines and an empty label whose words fall to the next line. Invented. */
const cardEmail = (amount = 'Rp245.500,00') =>
  [
    'Yth. Pemegang Kartu Kredit Bank Contoh,',
    'Terima kasih telah bertransaksi menggunakan Kartu Kredit Bank Contoh:',
    'Nomor Customer\t: \t9876543210123456',
    'Nomor Kartu\t: \t543210XXXX2468',
    'Merchant / ATM\t: \tOVO QR * Toko Melati Ja',
    'Jenis Transaksi\t: \tE-COMMERCE',
    'Otentikasi\t: \t',
    'TRANSAKSI DENGAN OTP',
    'Pada Tanggal\t:\t14-10-2026 09:05:11 WIB',
    `Sejumlah\t:\t${amount}`,
    'Selalu jaga keamanan fisik kartu dan data pribadi seperti Nomor Kartu, PIN, OTP, CVV/CVC.',
    'Jika kartu hilang dan belum terblokir, transaksi yang terjadi adalah tanggung jawab Pemegang Kartu. Info lanjut hubungi 1500000.',
  ].join('\n');

describe('a card email whose merchant is labelled Merchant / ATM', () => {
  it.each([['with a subject', 'Transaksi Kartu Kredit'], ['without one', null]] as const)('reads it %s', (_, title) => {
    const reading = readCapture(email(cardEmail(), title), WORDS, null);
    expect(reading.skipped).toBeNull();
    expect(reading.type.value).toBe('spent');
    expect(reading.amount?.value).toEqual({ minor: 245_500, currency: 'IDR' });
    expect(reading.occurredAt?.value).toBe('2026-10-14T09:05');
    expect(reading.name?.value).toBe('OVO QR * Toko Melati Ja');
    expect(reading.accountHint).toBe('2468');
  });
});
