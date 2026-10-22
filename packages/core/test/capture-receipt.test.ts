import { describe, expect, it } from 'vitest';
import { readReceipt } from '../src/capture/receipt';
import type { CaptureLine } from '../src/capture/types';

/** A receipt's lines top to bottom, each a line's height apart, as Vision hands them over. */
const lines = (texts: string[]): CaptureLine[] => texts.map((text, i) => ({ text, box: [0.1, 0.05 + i * 0.05, 0.8, 0.03], height: 0.03 }));

describe('a receipt photographed on the add form', () => {
  it('reads the total, the merchant and the day, in the form’s currency when the receipt names none', () => {
    const fill = readReceipt(
      lines(['SUPERMARKET MAWAR', 'Jl. Melati 12', '20/10/2026 14:22', 'Roti tawar 18.500', 'Susu 1L 22.800', 'TOTAL 41.300', 'TUNAI 50.000', 'KEMBALI 8.700']),
      'IDR',
      '2026-10-22T09:00:00+07:00',
    );
    expect(fill).not.toBeNull();
    expect(fill!.currency).toBe('IDR');
    expect(fill!.amountMinor).toBe(41_300);
    expect(fill!.date).toBe('2026-10-20');
    expect(fill!.name).toMatch(/MAWAR/i);
  });

  it('reads nothing from a picture with no figure', () => {
    expect(readReceipt(lines(['Terima kasih', 'Selamat datang']), 'IDR', '2026-10-22T09:00:00+07:00')).toBeNull();
  });
});

describe('a printed till receipt, figures without Rp', () => {
  it('takes the TOTAL line, never the subtotal, and keeps cents a currency with no minor unit cannot', () => {
    const fill = readReceipt(lines(['TOKO SEJAHTERA', 'SUBTOTAL 39.000', 'PPN 4.290', 'TOTAL 43.290', 'TUNAI 50.000']), 'IDR', '2026-10-22T09:00:00+07:00');
    expect(fill!.amountMinor).toBe(43_290);
    expect(fill!.name).toBe('TOKO SEJAHTERA');
    expect(readReceipt(lines(['CAFE', 'Grand Total', '12,50']), 'USD', '2026-10-22T09:00:00+07:00')!.amountMinor).toBe(1250);
    expect(readReceipt(lines(['WARUNG', 'TOTAL 12.500,30']), 'IDR', '2026-10-22T09:00:00+07:00')!.amountMinor).toBe(12_501);
  });
});
