import { describe, expect, it } from 'vitest';
import { type RawCapture, readCapture, WORDS } from '../src/index';
import { LABEL_LINES } from './fixtures/capture-label-lines';

/*
 * What the reader made of each of these before it learned to read a labelled table (main at f8a26cc9, recorded by
 * running it). A notification that prints a label over its value is not a transaction table, and the table reader must
 * leave every one of them exactly as it was.
 */
const BEFORE: Record<string, unknown> = {
  'a transfer out with Nominal and Penerima': { skipped: null, amount: { minor: 150000, currency: 'IDR' }, type: 'spent', name: 'SITI CONTOH', occurredAt: null, accountHint: null },
  'money in with Jumlah and Pengirim': { skipped: null, amount: { minor: 500000, currency: 'IDR' }, type: 'received', name: 'BUDI SANTOSO', occurredAt: null, accountHint: null },
  'a payment with Merchant, Total and Tanggal': { skipped: null, amount: { minor: 38000, currency: 'IDR' }, type: 'spent', name: 'KOPI CONTOH', occurredAt: '2026-11-03T09:41', accountHint: null },
  'a top-up with its balance after': { skipped: null, amount: { minor: 1250000, currency: 'IDR' }, type: 'topup', name: null, occurredAt: null, accountHint: null },
  'a refund with Merchant and Jumlah': { skipped: null, amount: { minor: 75000, currency: 'IDR' }, type: 'refund', name: 'TOKO CONTOH', occurredAt: null, accountHint: null },
  'money in, in English': { skipped: null, amount: { minor: 1250, currency: 'USD' }, type: 'spent', name: 'JOHN CONTOH', occurredAt: null, accountHint: null },
  'a bare Total and Merchant': { skipped: null, amount: { minor: 38000, currency: 'IDR' }, type: 'spent', name: 'KOPI CONTOH', occurredAt: null, accountHint: null },
  'a shared card message with its labels': { skipped: null, amount: { minor: 48300, currency: 'IDR' }, type: 'spent', name: 'TOKO ROTI', occurredAt: '2026-09-03', accountHint: '5512' },
  'money in, with Status': { skipped: null, amount: { minor: 320000, currency: 'IDR' }, type: 'received', name: 'ANDI CONTOH', occurredAt: null, accountHint: null },
  'money in on an account number': { skipped: null, amount: { minor: 500000, currency: 'IDR' }, type: 'received', name: null, occurredAt: null, accountHint: null },
  'a wallet payment with Status and Waktu': { skipped: null, amount: { minor: 27500, currency: 'IDR' }, type: 'spent', name: 'WARUNG CONTOH', occurredAt: '2026-10-12T18:20', accountHint: null },
};

const notification = (title: string | null, body: string): RawCapture => ({
  id: 'n1',
  kind: 'notification',
  capturedAt: '2026-11-03T09:42:10+07:00',
  app: 'com.example.pay',
  title,
  body,
  lines: [],
  imageFile: null,
});

describe('a notification with a label over each value', () => {
  it.each(LABEL_LINES.map((sample) => [sample.name, sample] as const))('reads %s as it did before the table reader', (name, sample) => {
    const reading = readCapture(notification(sample.title, sample.body), WORDS, null);
    expect({
      skipped: reading.skipped,
      amount: reading.amount?.value ?? null,
      type: reading.type.value,
      name: reading.name?.value ?? null,
      occurredAt: reading.occurredAt?.value ?? null,
      accountHint: reading.accountHint,
    }).toEqual(BEFORE[name]);
  });
});
