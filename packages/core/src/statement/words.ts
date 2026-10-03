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
  /** Markers after an amount that mean money in. */
  inMarkers: string[];
  /** Markers after an amount that mean money out. */
  outMarkers: string[];
  /** A month's first three letters, in either language, to its number. */
  months: Record<string, number>;
}

export const STATEMENT_WORDS: StatementWords = {
  closing: ['new balance', 'closing balance', 'saldo akhir', 'tagihan baru', 'total tagihan', 'outstanding', 'current balance'],
  previous: ['previous balance', 'saldo sebelumnya', 'tagihan sebelumnya', 'last statement balance'],
  fee: ['fee', 'biaya', 'materai', 'stamp duty', 'interest', 'bunga', 'annual', 'iuran', 'late charge', 'denda'],
  inMarkers: ['cr', 'k', 'kredit', 'credit'],
  outMarkers: ['db', 'd', 'debit'],
  months: {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mei: 5, jun: 6, jul: 7, aug: 8, agu: 8, ags: 8, sep: 9, oct: 10, okt: 10,
    nov: 11, dec: 12, des: 12,
  },
};
