import { describe, expect, it } from 'vitest';
import { appNameOfScreen, type CaptureLine, fingerprintOf, type RawCapture, sameSource } from '../src/index';

/** A screen, with its lines' places: the first three sit in the band a source is read from. */
const shot = (texts: string[]): RawCapture => ({
  id: 's1',
  kind: 'screen',
  capturedAt: '2026-09-29T08:12:00+07:00',
  app: null,
  title: null,
  body: null,
  lines: texts.map((text, index) => ({ text, box: [0.08, 0.04 + index * 0.04, 0.84, 0.03] as [number, number, number, number], height: 0.03 })) as CaptureLine[],
  imageFile: 'x.png',
});

const walletScreen = (amount: string, merchant = 'Kopi Kenangan') => shot(['Transaksi Berhasil', amount, 'Pembayaran ke', merchant, 'Total Bayar', amount]);

describe('fingerprintOf', () => {
  it('is the same words for two screens of one app, whatever they are about', () => {
    const one = fingerprintOf(walletScreen('Rp38.000'));
    const two = fingerprintOf(walletScreen('Rp45.000', 'Warung Sate'));
    expect(one).toEqual(two);
    expect(sameSource(one, two)).toBe(true);
  });

  it('is not the same for two different apps', () => {
    const wallet = fingerprintOf(walletScreen('Rp38.000'));
    const qris = fingerprintOf(shot(['QRIS', 'Merchant:', 'WARUNG SATE PAK ALI', 'Total Bayar', 'Rp45.500']));
    expect(sameSource(wallet, qris)).toBe(false);
  });

  it('carries the masked digits, so two cards of one app are two sources', () => {
    const card = (mask: string) => shot(['Kartu Kredit', `···· ${mask}`, 'Pembayaran', 'Rp38.000']);
    expect(fingerprintOf(card('1234'))).toContain('digits:1234');
    expect(sameSource(fingerprintOf(card('1234')), fingerprintOf(card('1234')))).toBe(true);
    expect(sameSource(fingerprintOf(card('1234')), fingerprintOf(card('5678')))).toBe(false);
  });

  it('reads the words a notification carries when it has no lines of its own', () => {
    const note = (body: string): RawCapture => ({ id: 'n1', kind: 'notification', capturedAt: '2026-09-29T08:12:00+07:00', app: 'Wallet', title: null, body, lines: [], imageFile: null });
    expect(fingerprintOf(note('Kartu ···· 1234 dipakai Rp38.000'))).toEqual(['digits:1234']);
  });
});

/** A wallet's transaction detail as the phone reads it: a title, the merchant's logo, the date beside the wallet ID. */
const detail = (logo: string, date: string, merchant: string, figure: string, extra: [string, number][] = []): RawCapture => {
  const placed: [string, number, number][] = [
    ['Transaction Detail', 0.06, 0.3],
    [logo, 0.11, 0.42],
    [date, 0.14, 0.08],
    ['KANTONG ID 0811•••9159', 0.14, 0.6],
    ['Transaction success!', 0.2, 0.3],
    [`Payment to ${merchant}`, 0.24, 0.2],
    ['Total Payment', 0.3, 0.08],
    [figure, 0.3, 0.7],
    ['Payment Method', 0.34, 0.08],
    ['Credit Card NUSA (6175)', 0.34, 0.6],
    ...extra.map(([text, y]): [string, number, number] => [text, y, 0.4]),
  ];
  return {
    id: `s-${merchant}`,
    kind: 'screen',
    capturedAt: '2026-10-02T21:40:00+07:00',
    app: null,
    title: null,
    body: null,
    lines: placed.map(([text, y, x]) => ({ text, box: [x, y, 0.3, 0.025] as [number, number, number, number], height: 0.025 })),
    imageFile: 'x.png',
  };
};

describe('a wallet screen whose top shows the merchant', () => {
  const lazada = detail('Lazada', '02 Oct 2026 • 21:35', 'Lazada Indonesia', 'Rp1.010.000');
  const qris = detail('QRIS', '01 Oct 2026 • 11:06', 'Logitek Digital Nusantara', 'Rp295.000');

  it('is one source, whichever merchant’s logo and whichever day it shows', () => {
    expect(fingerprintOf(lazada)).toEqual(fingerprintOf(qris));
    expect(sameSource(fingerprintOf(lazada), fingerprintOf(qris))).toBe(true);
  });

  it('stays one source in another month', () => {
    const later = detail('Lazada', '15 Nov 2026 • 09:00', 'Lazada Indonesia', 'Rp50.000');
    expect(sameSource(fingerprintOf(lazada), fingerprintOf(later))).toBe(true);
  });

  it('does not carry the wallet ID or the paying card as the account', () => {
    expect(fingerprintOf(lazada).some((word) => word.startsWith('digits:'))).toBe(false);
  });
});

describe('appNameOfScreen', () => {
  it('is the word the wallet ID is printed under', () => {
    expect(appNameOfScreen(detail('Lazada', '02 Oct 2026 • 21:35', 'Lazada Indonesia', 'Rp1.010.000'))).toBe('KANTONG');
  });

  it('is the watermark the screen repeats', () => {
    const marked = shot(['Transaksi Berhasil', 'DOMPETKU', 'Pembayaran ke', 'Kopi Kenangan', 'DOMPETKU', 'Total Bayar Rp38.000', 'DOMPETKU']);
    expect(appNameOfScreen(marked)).toBe('DOMPETKU');
  });

  it('is nothing when the screen names no app it can be sure of', () => {
    expect(appNameOfScreen(walletScreen('Rp38.000'))).toBeNull();
    expect(appNameOfScreen(shot(['Lazada', 'Payment to Lazada Indonesia', 'Total Rp38.000']))).toBeNull();
  });
});
