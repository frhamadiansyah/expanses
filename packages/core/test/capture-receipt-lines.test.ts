import { describe, expect, it } from 'vitest';
import { readReceiptLines } from '../src/capture/receipt-lines';
import type { CaptureLine } from '../src/capture/types';

/** One row per text, a row apart, as Vision hands over a bill whose name and figure came out as one line. */
const rows = (texts: string[]): CaptureLine[] => texts.map((text, i) => ({ text, box: [0.1, 0.05 + i * 0.05, 0.8, 0.03], height: 0.03 }));

/** Name on the left and figure on the right of the same row: two Vision lines at one height. */
const columns = (pairs: [string, string][]): CaptureLine[] =>
  pairs.flatMap(([name, amount], i): CaptureLine[] => [
    { text: name, box: [0.08, 0.05 + i * 0.05, 0.4, 0.03], height: 0.03 },
    ...(amount ? [{ text: amount, box: [0.7, 0.05 + i * 0.05 + 0.002, 0.2, 0.03], height: 0.03 } as CaptureLine] : []),
  ]);

describe('a bill read line by line', () => {
  it('reads dishes, charges and the total, and they add up', () => {
    const r = readReceiptLines(
      rows(['WARUNG MELATI', 'Jl. Anggrek 4', '12/10/2026 19:40', 'Nasi goreng 45.000', 'Mie ayam 38.000', 'Sate (10) 60.000', 'Es teh x3 27.000', 'Subtotal 170.000', 'Service 5% 8.500', 'PPN 10% 17.850', 'TOTAL 196.350', 'TUNAI 200.000', 'KEMBALI 3.650']),
      'IDR',
    );
    expect(r.items).toEqual([
      { name: 'Nasi goreng', quantity: 1, amountMinor: 45_000 },
      { name: 'Mie ayam', quantity: 1, amountMinor: 38_000 },
      { name: 'Sate (10)', quantity: 1, amountMinor: 60_000 },
      { name: 'Es teh', quantity: 3, amountMinor: 27_000 },
    ]);
    expect(r.charges).toEqual([
      { label: 'Service 5%', kind: 'service', amountMinor: 8_500 },
      { label: 'PPN 10%', kind: 'tax', amountMinor: 17_850 },
    ]);
    expect(r.subtotal).toBe(170_000);
    expect(r.total).toBe(196_350);
    expect(r.mismatchMinor).toBe(0);
    expect(r.date).toBe('2026-10-12');
    expect(r.merchant).toBe('WARUNG MELATI');
    expect(r.unplaced).toEqual([]);
  });

  it('reads the name on the left and the figure on the right as one row', () => {
    const r = readReceiptLines(columns([['Bakso', 'Rp 22.000'], ['Teh tarik', 'Rp 9.500'], ['TOTAL', 'Rp 31.500']]), 'IDR');
    expect(r.items.map((i) => [i.name, i.amountMinor])).toEqual([['Bakso', 22_000], ['Teh tarik', 9_500]]);
    expect(r.total).toBe(31_500);
    expect(r.mismatchMinor).toBe(0);
  });

  it('reads a count as 2 x name, name x3, 3 name, name 3 x unit, and a count before the figure', () => {
    const r = readReceiptLines(rows(['2 x Es jeruk 18.000', '2xKopi susu 30.000', 'Teh botol x3 27.000', '3 Pisang bakar 45.000', 'Roti bakar 2 x 12.000 24.000', 'Air mineral 2 10.000']), 'IDR');
    expect(r.items.map((i) => [i.name, i.quantity, i.amountMinor])).toEqual([
      ['Es jeruk', 2, 18_000],
      ['Kopi susu', 2, 30_000],
      ['Teh botol', 3, 27_000],
      ['Pisang bakar', 3, 45_000],
      ['Roti bakar', 2, 24_000],
      ['Air mineral', 2, 10_000],
    ]);
  });

  it('puts a dish whose figure is on the next row back together, with its count and unit price', () => {
    const r = readReceiptLines(rows(['Ayam bakar', '45.000', 'Jus alpukat', '3 x 12.000   36.000', 'Kerupuk', '3 x 2.000', 'TOTAL 87.000']), 'IDR');
    expect(r.items.map((i) => [i.name, i.quantity, i.amountMinor])).toEqual([
      ['Ayam bakar', 1, 45_000],
      ['Jus alpukat', 3, 36_000],
      ['Kerupuk', 3, 6_000],
    ]);
    expect(r.mismatchMinor).toBe(0);
  });

  it('puts a charge whose figure is on the next row back together', () => {
    const r = readReceiptLines(rows(['Soto 30.000', 'PB1 10%', '3.000', 'Grand Total', '33.000']), 'IDR');
    expect(r.charges).toEqual([{ label: 'PB1 10%', kind: 'tax', amountMinor: 3_000 }]);
    expect(r.total).toBe(33_000);
    expect(r.mismatchMinor).toBe(0);
  });

  it('reads a discount as money off, whichever way it is written', () => {
    const r = readReceiptLines(rows(['Steak 150.000', 'Diskon 10% 15.000', 'Voucher -5.000', 'Rounding 100-', 'Tip 10.000', 'TOTAL 139.900']), 'IDR');
    expect(r.charges.map((c) => [c.kind, c.amountMinor])).toEqual([['discount', -15_000], ['discount', -5_000], ['rounding', -100], ['tip', 10_000]]);
    expect(r.mismatchMinor).toBe(0);
  });

  it('reads dots as thousands and commas as decimals, in any currency', () => {
    const idr = readReceiptLines(rows(['Kopi 1.250.000', 'TOTAL 1.250.000'], ), 'IDR');
    expect(idr.items[0]!.amountMinor).toBe(1_250_000);
    const usd = readReceiptLines(rows(['Burger 12,50', 'Fries 4,25', 'Tax 1,34', 'Total 18,09']), 'USD');
    expect(usd.items.map((i) => i.amountMinor)).toEqual([1250, 425]);
    expect(usd.charges[0]!.amountMinor).toBe(134);
    expect(usd.total).toBe(1809);
    expect(usd.mismatchMinor).toBe(0);
    const dinar = readReceiptLines(rows(['Kebab 3,500', 'Total 3,500']), 'KWD');
    expect(dinar.total).toBeGreaterThan(0);
  });

  it('flags items that do not add to the total with the difference', () => {
    const r = readReceiptLines(rows(['Nasi 20.000', 'Teh 5.000', 'TOTAL 30.000']), 'IDR');
    expect(r.mismatchMinor).toBe(5_000);
    const none = readReceiptLines(rows(['Nasi 20.000']), 'IDR');
    expect(none.total).toBeNull();
    expect(none.mismatchMinor).toBeNull();
  });

  it('passes over the address, phone, time, payment and change lines, and a count total', () => {
    const r = readReceiptLines(
      rows(['Kedai Kopi', 'Jalan Kenanga 9', 'Telp 021-5550123', 'Kasir: Budi', 'Meja 5', '14:05', 'Latte 32.000', 'Total Qty 1', 'Total 32.000', 'Visa 32.000', 'Cash 50.000', 'Change 18.000', 'Terima kasih']),
      'IDR',
    );
    expect(r.items.map((i) => i.name)).toEqual(['Latte']);
    expect(r.total).toBe(32_000);
    expect(r.mismatchMinor).toBe(0);
    expect(r.unplaced).toEqual([]);
  });

  it('keeps a "total tax" line a charge, not the total', () => {
    const r = readReceiptLines(rows(['Pasta 100.000', 'Total Tax 10.000', 'Total 110.000']), 'IDR');
    expect(r.charges.map((c) => c.kind)).toEqual(['tax']);
    expect(r.total).toBe(110_000);
  });

  it('lists a figure with no words beside it as unplaced instead of guessing', () => {
    const r = readReceiptLines(rows(['Nasi 20.000', '15.000', 'TOTAL 35.000']), 'IDR');
    expect(r.unplaced).toEqual(['15.000']);
    expect(r.mismatchMinor).toBe(15_000);
  });

  it('reads nothing from garbage or an empty picture', () => {
    for (const texts of [[], ['Selamat datang', 'Terima kasih'], ['@@##', '....', '12'], ['  ']]) {
      const r = readReceiptLines(rows(texts), 'IDR');
      expect(r.items).toEqual([]);
      expect(r.charges).toEqual([]);
      expect(r.total).toBeNull();
    }
  });
});
