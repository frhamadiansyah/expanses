import { describe, expect, it } from 'vitest';
import { accountHintOf, namesCard, type RawCapture, readCapture, WORDS } from '../src/index';

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
  it.each([
    ['a ride descriptor with a star after the brand', 'Terima kasih utk trx kartukredit XXXX5512 tgl 03-09-2026 10:15:00 di Ojek* B-7QWERTY12 IDR48.500,00. Jika trx tidak Anda kenal, hub 10000', 'Ojek* B-7QWERTY12'],
    ['a processor prefix with a star before the shop', 'Pembayaran Rp50.000 di PAYPAL *CONTOHSTORE berhasil', 'PAYPAL *CONTOHSTORE'],
  ])('keeps the star of %s in the name', (_, body, name) => {
    expect(readCapture(notification(body), WORDS, null).name?.value).toBe(name);
  });

  it('reads a card SMS that names the shop right after the amount and the date, with no word before it', () => {
    const reading = readCapture(
      notification('Terimakasih telah bertransaksi KKXXXX8421 IDR 254300 03/09/26 Toko Contoh ID 2.Ubah cicilan klik https://example.test/cicilan hub 1500000'),
      WORDS,
      null,
    );
    expect(reading.skipped).toBeNull();
    expect(reading.amount?.value).toEqual({ minor: 254_300, currency: 'IDR' });
    expect(reading.type.value).toBe('spent');
    expect(reading.name?.value).toBe('Toko Contoh ID');
    expect(reading.accountHint).toBe('8421');
    expect(reading.occurredAt?.value).toBe('2026-09-03');
  });

  it('reads the card from its plain last four digits after the card words, with the bank between', () => {
    const reading = readCapture(
      notification('Nsb Yth. Transaksi Kartu Kredit Contoh 4821 di TOKO CONTOH +62 2100000000 ID sebesar IDR 250.000,00 pada 03/09/26 10:15:00 telah berhasil. Info: 1500000/+620000000000(LN)'),
      WORDS,
      null,
    );
    expect(reading.amount?.value).toEqual({ minor: 250_000, currency: 'IDR' });
    expect(reading.name?.value).toBe('TOKO CONTOH');
    expect(reading.occurredAt?.value).toBe('2026-09-03T10:15');
    expect(reading.accountHint).toBe('4821');
  });

  it('reads a card SMS with a US-style amount and a two-digit year closing the sentence', () => {
    const reading = readCapture(
      notification('Terima kasih telah bertransaksi dg KK Contoh xx5512 sebesar IDR45,500.00 di Toko Contoh 02100000000 tgl 07/03/26.Jika bukan trx Anda hub 1500000'),
      WORDS,
      null,
    );
    expect(reading.amount?.value).toEqual({ minor: 45_500, currency: 'IDR' });
    expect(reading.name?.value).toBe('Toko Contoh');
    expect(reading.occurredAt?.value).toBe('2026-03-07');
    expect(reading.accountHint).toBe('5512');
    expect(reading.type.value).toBe('spent');
  });

  it.each([
    ['an amount after the card words', 'Tagihan kartu kredit IDR 7342 jatuh tempo'],
    ['a longer number', 'Kartu Kredit Contoh 48210 aktif'],
    ['digits too far from the card words', 'Kartu kredit Anda untuk belanja online 4821'],
  ])('reads no card from %s', (_, text) => expect(accountHintOf(text)).toBeNull());

  it('names nothing after the amount when what follows is the sentence, not a name', () => {
    expect(readCapture(notification('Pembayaran Rp38.000 berhasil'), WORDS, null).name).toBeNull();
  });

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
    const reading = readCapture(notification('Cashback Rp5.000 masuk! Pakai voucher'), WORDS, null, { offers: 'read' });
    expect(reading.skipped).toBeNull();
    expect(reading.amount?.value).toEqual({ minor: 5_000, currency: 'IDR' });
  });

  it('skips a rewards notification that reports a purchase, until the source is opened to offers', () => {
    const rewards = notification(
      "You earned 15 Livin'poin from your credit card EDC transaction of Rp 102.700,00 on 14 October 2026.",
      "Yay, You've Just Earned More Livin'poin!",
    );
    // Every sentence of it holds a promo word, so by default there is nothing left and it is an offer.
    expect(readCapture(rewards, WORDS, null).skipped).toBe('promo');

    // Opened to offers, the sentence reporting the purchase stays: the amount is the purchase, never the 15 points,
    // because a bare number is not money. No merchant is named, so none is invented.
    const read = readCapture(rewards, WORDS, null, { offers: 'transactions' });
    expect(read.skipped).toBeNull();
    expect(read.amount?.value).toEqual({ minor: 102_700, currency: 'IDR' });
    expect(read.occurredAt?.value).toBe('2026-10-14');
    expect(read.type.value).toBe('spent');
    expect(read.name).toBeNull();
  });

  it('still skips an offer that reports no purchase, however the source is set', () => {
    for (const offers of ['skip', 'transactions'] as const) {
      expect(readCapture(notification('Cashback Rp5.000 masuk! Pakai voucher'), WORDS, null, { offers }).skipped).toBe('promo');
      expect(readCapture(notification('Diskon 50% di merchant pilihan! Belanja sekarang.'), WORDS, null, { offers }).skipped).toBe('promo');
    }
  });

  it('names the merchant and stops there, rather than running on into the words after it', () => {
    const reading = readCapture(notification('Pembayaran Rp102.700 ke INDOMARET berhasil dengan Kartu Kredit 1234.'), WORDS, null);
    expect(reading.name?.value).toBe('INDOMARET');
  });

  it('reads a bank message end to end: the card, the day and time, the merchant and the amount', () => {
    const reading = readCapture(
      notification('Terima kasih utk trx kartukredit XXXX5512 tgl 03-09-2026 10:15:42 di TOKO ROTI CONTOH IDR48.300,00. Jika trx tidak Anda kenal, hub 10000', 'BANKCONTOH'),
      WORDS,
      null,
    );
    expect(reading.skipped).toBeNull();
    expect(reading.amount?.value).toEqual({ minor: 48_300, currency: 'IDR' });
    // Day first with hyphens, the order a bank's message writes, and the seconds are not part of the stamp.
    expect(reading.occurredAt?.value).toBe('2026-09-03T10:15');
    expect(reading.name?.value).toBe('TOKO ROTI CONTOH');
    // The masked number is the card, so a workspace holding more than one files it on the right one.
    expect(reading.accountHint).toBe('5512');
    // "Terima kasih" is thanks, not money received.
    expect(reading.type.value).toBe('spent');
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

describe('readCapture on a figure with cents in a currency with no minor unit', () => {
  it('carries the exact figure on the reading, beside the rounded minor, for the draft to round by direction', () => {
    const spent = readCapture(notification('Pembayaran Rp12.500,30 ke KOPI KENANGAN berhasil'), WORDS, null);
    expect(spent.amount?.value).toEqual({ minor: 12_500, currency: 'IDR', exactHundredths: 1_250_030 });
    const received = readCapture(notification('Dana masuk Rp 12.345,67 dari PT MAJU JAYA'), WORDS, null);
    expect(received.amount?.value).toEqual({ minor: 12_346, currency: 'IDR', exactHundredths: 1_234_567 });
  });

  it('carries the exact figure through a learned template too', () => {
    const lines = image(['Transaksi Berhasil', 'Nilai Kirim', 'Rp12.500,30', 'Biaya layanan', 'Rp250.000']);
    const reading = readCapture(lines, WORDS, { amount: { label: 'Nilai Kirim', region: null } });
    expect(reading.amount?.confidence).toBe(95);
    expect(reading.amount?.value).toEqual({ minor: 12_500, currency: 'IDR', exactHundredths: 1_250_030 });
  });

  it('adds nothing to a whole figure', () => {
    const reading = readCapture(notification('Pembayaran Rp38.000 ke KOPI KENANGAN berhasil'), WORDS, null);
    expect(reading.amount?.value).toStrictEqual({ minor: 38_000, currency: 'IDR' });
  });
});

