import { describe, expect, it } from 'vitest';
import { type CaptureLine, fingerprintOf, type RawCapture, sameSource } from '../src/index';

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
