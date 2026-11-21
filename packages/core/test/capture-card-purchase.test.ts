import { describe, expect, it } from 'vitest';
import { type RawCapture, readCapture, WORDS } from '../src/index';

/*
 * A card purchase email is spending: it lists the card's number and the merchant. The "Kredit" of "Kartu Kredit" is
 * the card's name, wherever the email breaks or spaces it, and words of money arriving near the table do not make it
 * money in either. Only a refund, a reversal or a top-up does. Every figure, digit, code and address here is invented.
 */

/** The email's words as the Mail automation hands them over, one cell to a line. */
const LINES = [
  'Hi Pemegang Kartu Kredit Maybank,',
  'Anda baru saja melakukan transaksi dengan',
  'Maybank Kartu Kredit',
  'Nomor Kartu',
  'Jenis Kartu',
  'Merchant',
  '**** **** **** 4321',
  'VISA',
  'Grab* A-ZZ9EXAMPLE01',
  'Waktu Transaksi',
  'Mata Uang',
  'Jumlah',
  '02 Nov 26 09:41',
  'IDR',
  '57,300',
  'Status',
  'Sukses/Approved',
  'Apabila Anda tidak melakukan transaksi',
  'segera hubungi Maybank Customer Care',
  '1500611 atau +622100000000 (dari luar negeri)',
];
const BODY = LINES.join('\n');

const mail = (body: string, title: string | null = null): RawCapture => ({
  id: 'mail-card',
  kind: 'notification',
  capturedAt: '2026-11-18T13:16:00+07:00',
  app: 'Kartu Kredit <notifikasi@kartu.example.com>',
  title,
  body,
  lines: [],
  imageFile: null,
});

const expectPurchase = (body: string, title: string | null = null) => {
  const reading = readCapture(mail(body, title), WORDS, null);
  expect(reading.skipped).toBeNull();
  expect(reading.type.value).toBe('spent');
  expect(reading.amount?.value).toEqual({ minor: 57_300, currency: 'IDR' });
  expect(reading.name?.value).toBe('Grab* A-ZZ9EXAMPLE01');
  expect(reading.accountHint).toBe('4321');
  expect(reading.occurredAt?.value).toBe('2026-11-02T09:41');
};

describe('a card purchase email', () => {
  it.each([
    ['without a subject', null],
    ['with its subject', 'Maybank Credit Card Transaction Notification (do not reply)'],
  ])('is spending on the card it names, %s', (_, title) => {
    expectPurchase(BODY, title);
  });

  it.each([
    ['"Kartu Kredit" broken over two lines', BODY.replace(/Kartu Kredit/g, 'Kartu\nKredit')],
    ['"Kredit" left on a line of its own', BODY.replace('Hi Pemegang Kartu Kredit Maybank,', 'Hi Pemegang Kartu\nKredit\nMaybank,')],
    ['"Kartu Kredit" with an HTML space Mail left as text', BODY.replace(/Kartu Kredit/g, 'Kartu&nbsp;Kredit')],
    ['"Kartu Kredit" apart by a mark the reader does not clear', BODY.replace(/Kartu Kredit/g, 'Kartu᠎Kredit')],
    ['words of money arriving above the table', BODY.replace('Anda baru saja melakukan transaksi dengan', 'Dana masuk: Anda baru saja melakukan transaksi dengan')],
    ['words of money arriving right under the table', BODY.replace('Apabila Anda tidak melakukan transaksi', 'Kredit poin masuk dalam 2 hari kerja.')],
  ])('is spending with %s', (_, body) => {
    expectPurchase(body);
  });

  it('is spending in English, its "credit" the card’s', () => {
    const body = ['Card Number\tMerchant\tCurrency\tAmount', 'XXXX 4321\tKEDAICONTOH\tSGD\t18.40', 'Status\tApproved', '', 'Credited points will follow.'].join('\n');
    expect(readCapture(mail(body, 'Credit\nCard Transaction'), WORDS, null).type.value).toBe('spent');
  });

  it.each([
    ['a refund', 'Pengembalian dana berhasil.'],
    ['a refund, in English', 'This refund has been credited to your card.'],
    ['a reversal', 'This transaction has been reversed.'],
    ['a reversal, as a word of its own', 'Reversal'],
  ])('is money back when the email names %s', (_, words) => {
    const body = BODY.replace('Apabila Anda tidak melakukan transaksi', words);
    expect(readCapture(mail(body), WORDS, null).type.value).toBe('refund');
  });

  it('is skipped when its status says it was declined', () => {
    expect(readCapture(mail(BODY.replace('Sukses/Approved', 'Ditolak/Declined')), WORDS, null).skipped).toBe('declined');
  });

  it('leaves a table that names no card or merchant read as its words say', () => {
    const body = ['Mata Uang', 'Jumlah', 'IDR', '500,000', 'Dana telah masuk ke rekening Anda.'].join('\n');
    expect(readCapture(mail(body, 'Notifikasi'), WORDS, null).type.value).toBe('received');
  });
});
