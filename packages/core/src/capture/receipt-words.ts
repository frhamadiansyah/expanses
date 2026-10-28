/**
 * The words a printed bill uses for what is not a dish: the total, the charges added to it, and the lines to pass
 * over. Data, in one place, lower-case, matched without case and only as whole words; adding a language is adding
 * to these lists. No merchant, bank or brand name belongs here.
 */

/** What kind of charge a line is. A `discount` takes money off the bill, so its figure is negative. */
export type ChargeKind = 'service' | 'tax' | 'tip' | 'rounding' | 'discount' | 'other';

export const CHARGE_WORDS: Record<Exclude<ChargeKind, 'other'>, readonly string[]> = {
  service: ['service charge', 'service', 'svc', 'biaya layanan', 'biaya service', 'layanan'],
  tax: ['restaurant tax', 'resto tax', 'pajak restoran', 'pajak', 'tax', 'ppn', 'pb1', 'pb 1', 'pb-1', 'vat', 'gst', 'sales tax'],
  tip: ['tip', 'gratuity'],
  rounding: ['pembulatan', 'rounding', 'round off'],
  discount: ['discount', 'diskon', 'potongan', 'voucher', 'disc'],
};

/** The line that says what the whole bill came to: the strong wordings first, the bare "total" last. */
export const TOTAL_WORDS: readonly (readonly string[])[] = [
  ['grand total', 'total bayar', 'total pembayaran', 'jumlah bayar', 'total tagihan', 'jumlah tagihan', 'amount due', 'total due', 'balance due', 'total harga', 'total belanja', 'net total'],
  ['total', 'jumlah'],
];

export const SUBTOTAL_WORDS: readonly string[] = ['sub total', 'sub-total', 'subtotal'];

/** A total that is only a count, or a sum of lines already printed: never the bill's total, never a charge. */
export const NOT_TOTAL_WORDS: readonly string[] = [
  'total item',
  'total items',
  'total qty',
  'total quantity',
  'jumlah item',
  'jumlah qty',
  'total disc',
  'total discount',
  'total diskon',
  'total hemat',
  'total potongan',
  'total savings',
];

/** Payment, change and the till's own housekeeping: lines that are not food, whatever figure they carry. */
export const PASS_OVER_WORDS: readonly string[] = [
  'cash',
  'tunai',
  'change',
  'kembali',
  'kembalian',
  'tendered',
  'card',
  'kartu',
  'visa',
  'mastercard',
  'debit',
  'credit',
  'kredit',
  'qris',
  'bayar',
  'paid',
  'payment',
  'pembayaran',
  'terima kasih',
  'thank you',
  'thanks',
  'table',
  'meja',
  'kasir',
  'cashier',
  'server',
  'waiter',
  'order',
  'invoice',
  'receipt',
  'struk',
  'nota',
  'bill no',
  'guest',
  'pax',
  'tel',
  'telp',
  'phone',
  'npwp',
  'wifi',
  'password',
  'dine in',
  'take away',
  'takeaway',
  'printed',
  'reprint',
];

/** An address line starts with one of these. */
export const ADDRESS_STARTS: readonly string[] = ['jl', 'jln', 'jalan', 'street', 'road', 'rd'];
