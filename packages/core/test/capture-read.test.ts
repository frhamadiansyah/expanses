import { describe, expect, it } from 'vitest';
import { type RawCapture, readCapture, WORDS } from '../src/index';

const notification = (body: string, title: string | null = null): RawCapture => ({
  id: 'c1',
  kind: 'notification',
  capturedAt: '2026-09-30T08:12:00+07:00',
  app: 'Wallet',
  title,
  body,
  lines: [],
  imageFile: null,
});

/** A screen, read off an image: each line with its place, and one of them set in larger type. */
const image = (texts: string[], tall: number[] = []): RawCapture => ({
  id: 'c2',
  kind: 'screen',
  capturedAt: '2026-09-30T08:12:00+07:00',
  app: null,
  title: null,
  body: null,
  lines: texts.map((text, index) => ({
    text,
    box: [0.08, 0.06 + index * 0.05, 0.84, 0.04] as [number, number, number, number],
    height: tall.includes(index) ? 0.09 : 0.04,
  })),
  imageFile: 'capture.png',
});

describe('readCapture', () => {
  it('never reads the balance as the amount', () => {
    const reading = readCapture(notification('Pembayaran Rp38.000 ke KOPI KENANGAN berhasil. Saldo Rp1.212.000'), WORDS, null);
    expect(reading.skipped).toBeNull();
    expect(reading.amount?.value).toEqual({ minor: 38_000, currency: 'IDR' });
    expect(reading.type.value).toBe('spent');
    expect(reading.name?.value).toBe('KOPI KENANGAN');
  });

  it('skips an offer rather than reading money out of it', () => {
    const reading = readCapture(notification('Cashback Rp5.000 masuk! Pakai voucher'), WORDS, null);
    expect(reading.skipped).toBe('promo');
    expect(reading.amount).toBeNull();
    expect(reading.name).toBeNull();
  });

  it('reads money received, and who sent it', () => {
    const reading = readCapture(notification('Dana masuk Rp 5.000.000 dari PT MAJU JAYA'), WORDS, null);
    expect(reading.skipped).toBeNull();
    expect(reading.amount?.value).toEqual({ minor: 5_000_000, currency: 'IDR' });
    expect(reading.type.value).toBe('received');
    expect(reading.name?.value).toBe('PT MAJU JAYA');
  });

  it('reads a top-up as a top-up', () => {
    const reading = readCapture(notification('Top up saldo Rp200.000 berhasil'), WORDS, null);
    expect(reading.amount?.value).toEqual({ minor: 200_000, currency: 'IDR' });
    expect(reading.type.value).toBe('topup');
  });

  it('reads an image by the label over the figure, and finds the name on the line under the lead-in', () => {
    const reading = readCapture(
      image(['Transaksi Berhasil', 'Pembayaran ke', 'Kopi Kenangan', 'Total Bayar', 'Rp38.000', 'Saldo Rp1.212.000', 'Waktu 29 Sep 2026 08:12'], [4]),
      WORDS,
      null,
    );
    expect(reading.skipped).toBeNull();
    expect(reading.amount?.value).toEqual({ minor: 38_000, currency: 'IDR' });
    expect(reading.amount?.line).toBe(4);
    expect(reading.name?.value).toBe('Kopi Kenangan');
    expect(reading.type.value).toBe('spent');
    expect(reading.occurredAt?.value).toBe('2026-09-29T08:12');
  });

  it('says nothing was read when an image holds no figure at all', () => {
    const reading = readCapture(image(['Selamat datang', 'Aktifkan notifikasi untuk transaksi']), WORDS, null);
    expect(reading.skipped).toBe('unreadable');
    expect(reading.amount).toBeNull();
  });

  it('looks where the source learned to look before reading the page itself', () => {
    const lines = image(['Transaksi Berhasil', 'Nilai Kirim', 'Rp38.000', 'Biaya layanan', 'Rp250.000']);
    const reading = readCapture(lines, WORDS, { amount: { label: 'Nilai Kirim', region: null } });
    expect(reading.amount?.value).toEqual({ minor: 38_000, currency: 'IDR' });
    expect(reading.amount?.confidence).toBe(95);

    // The same page with nothing learned about it: the biggest figure that is not a balance is what is read.
    const general = readCapture(lines, WORDS, null);
    expect(general.amount?.value).toEqual({ minor: 250_000, currency: 'IDR' });
  });

  it('reads the masked digits of an account, however the mask is written', () => {
    expect(readCapture(notification('Rekening **1234 didebit Rp38.000'), WORDS, null).accountHint).toBe('1234');
    expect(readCapture(notification('Kartu ···· 5678 dipakai Rp38.000'), WORDS, null).accountHint).toBe('5678');
  });
});
