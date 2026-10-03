import { describe, expect, it } from 'vitest';
import { namesCard, type RawCapture, readCapture, WORDS } from '../src/index';

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

  it('reads an offer for its money when the owner brings it back', () => {
    const reading = readCapture(notification('Cashback Rp5.000 masuk! Pakai voucher'), WORDS, null, { skipPromos: false });
    expect(reading.skipped).toBeNull();
    expect(reading.amount?.value).toEqual({ minor: 5_000, currency: 'IDR' });
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

  it('does not take a wallet ID or a phone number for an account', () => {
    expect(readCapture(notification('Pembayaran Rp38.000 berhasil. KANTONG ID 0811•••9159'), WORDS, null).accountHint).toBeNull();
    expect(readCapture(notification('Pembayaran Rp38.000 berhasil. No. HP 0811****9159'), WORDS, null).accountHint).toBeNull();
    expect(readCapture(notification('Payment $12.00 sent. Phone ••••9159'), WORDS, null).accountHint).toBeNull();
  });

  it('does not take a figure in brackets for an account outside the payment method', () => {
    const reading = readCapture(notification('Pembayaran Rp38.000 ke TOKO ABC (2026) berhasil'), WORDS, null);
    expect(reading.accountHint).toBeNull();
    expect(reading.paymentMethod).toBeNull();
  });

  describe('the payment method', () => {
    const screen = (lines: [string, number][]): RawCapture => ({
      ...image([]),
      lines: lines.map(([text, y], index) => ({
        text,
        box: [index % 2 === 0 ? 0.08 : 0.55, y, 0.4, 0.03] as [number, number, number, number],
        height: 0.03,
      })),
    });

    it('reads the label and its value on one line', () => {
      const reading = readCapture(image(['Total Payment', 'Rp295.000', 'Payment Method Credit Card NUSA (6175)']), WORDS, null);
      expect(reading.paymentMethod).toEqual({ text: 'Credit Card NUSA (6175)', last4: '6175' });
      expect(reading.accountHint).toBe('6175');
    });

    it('reads the label and its value side by side, as two lines', () => {
      const reading = readCapture(
        screen([
          ['KANTONG ID 0811•••9159', 0.14],
          ['Total Payment', 0.3],
          ['Rp295.000', 0.3],
          ['Payment Method', 0.36],
          ['Credit Card NUSA (6175)', 0.36],
        ]),
        WORDS,
        null,
      );
      expect(reading.paymentMethod).toEqual({ text: 'Credit Card NUSA (6175)', last4: '6175' });
      expect(reading.accountHint).toBe('6175');
    });

    it('reads the last four digits however they are masked', () => {
      const last4 = (value: string) => readCapture(image(['Total Bayar Rp38.000', `Metode Pembayaran ${value}`]), WORDS, null).paymentMethod?.last4;
      expect(last4('Kartu Kredit (6175)')).toBe('6175');
      expect(last4('Kartu •••• 6175')).toBe('6175');
      expect(last4('Card **** 6175')).toBe('6175');
      expect(last4('Card xx6175')).toBe('6175');
      expect(last4('Visa ending 6175')).toBe('6175');
      expect(last4('Kartu akhiran 6175')).toBe('6175');
    });

    it('keeps a method that prints no digits, with none', () => {
      const reading = readCapture(image(['Total Bayar Rp38.000', 'Sumber Dana', 'Saldo Dompet']), WORDS, null);
      expect(reading.paymentMethod).toEqual({ text: 'Saldo Dompet', last4: null });
    });

    it('says whether the method is a card', () => {
      expect(namesCard('Credit Card NUSA (6175)')).toBe(true);
      expect(namesCard('Kartu Debit •••• 6175')).toBe(true);
      expect(namesCard('Saldo Dompet')).toBe(false);
      expect(namesCard('Transfer Bank')).toBe(false);
    });

    it('is nothing when the capture names no payment method', () => {
      expect(readCapture(notification('Pembayaran Rp38.000 ke KOPI KENANGAN berhasil'), WORDS, null).paymentMethod).toBeNull();
    });
  });
});
