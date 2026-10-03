/**
 * The words a statement prints, in English and Indonesian, lowercase.
 *
 * They are general statement vocabulary — no bank's name and no merchant's — so a statement from any card in either
 * language reads the same way.
 */
export interface StatementWords {
  /** Labels of the closing (new) balance. */
  closing: string[];
  /** Labels of the previous statement's balance. */
  previous: string[];
  /** Words that make a row a fee or a charge. */
  fee: string[];
  /** Words that make a credit row the card holder's payment, never a shop's refund. */
  paymentWords: string[];
  /** Markers after an amount that mean money in. */
  inMarkers: string[];
  /** Markers after an amount that mean money out. */
  outMarkers: string[];
  /** A month's three-letter form, in either language, to its number. */
  months: Record<string, number>;
  /** A month's full name, in either language, to its number. A month word is one of these or of `months`, exactly. */
  monthNames: Record<string, number>;
  /**
   * City and country words a card network appends to a merchant's name — geography, not brands — dropped from the
   * end of a description so two branches of one shop read as one merchant.
   */
  trailingPlaces: string[];
}

export const STATEMENT_WORDS: StatementWords = {
  closing: ['new balance', 'closing balance', 'saldo akhir', 'tagihan baru', 'total tagihan', 'outstanding', 'current balance'],
  previous: ['previous balance', 'saldo sebelumnya', 'tagihan sebelumnya', 'last statement balance'],
  fee: ['fee', 'biaya', 'materai', 'stamp duty', 'interest', 'biaya bunga', 'bunga kartu', 'annual', 'iuran', 'late charge', 'denda'],
  paymentWords: ['payment', 'pembayaran', 'terima kasih', 'thank you', 'autodebet', 'autodebit', 'autopay', 'transfer'],
  inMarkers: ['cr', 'k', 'kredit', 'credit'],
  outMarkers: ['db', 'd', 'debit'],
  months: {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, ags: 8, sep: 9, oct: 10, okt: 10,
    nov: 11, dec: 12, des: 12,
  },
  monthNames: {
    january: 1, januari: 1, february: 2, februari: 2, march: 3, maret: 3, april: 4, may: 5, mei: 5, june: 6, juni: 6,
    july: 7, juli: 7, august: 8, agustus: 8, september: 9, october: 10, oktober: 10, november: 11, december: 12,
    desember: 12,
  },
  trailingPlaces: [
    'id', 'idn', 'jkt', 'jakarta', 'jakarta slt', 'jakarta selat', 'jakarta pusat', 'jakarta barat', 'jakarta timur',
    'jakarta utara', 'tangerang', 'tangerang kab', 'bandung', 'surabaya', 'bali', 'sg', 'my', 'us',
  ],
};
