/**
 * Notifications that print a label on one line and its value on the next, as a wallet or a bank's app does. None is
 * a transaction table, and each must read as it did before the table reader existed (`capture-label-lines.test.ts`).
 * Every name, figure and digit is invented.
 */
export const LABEL_LINES: readonly { name: string; title: string | null; body: string }[] = [
  { name: 'a transfer out with Nominal and Penerima', title: 'Transfer Berhasil', body: 'Nominal\nRp 150.000\nPenerima\nSITI CONTOH\nBank Tujuan\nBANK CONTOH' },
  { name: 'money in with Jumlah and Pengirim', title: null, body: 'Jumlah\nRp 500.000\nPengirim\nBUDI SANTOSO\nDana telah masuk ke rekening Anda.' },
  { name: 'a payment with Merchant, Total and Tanggal', title: 'Pembayaran Berhasil', body: 'Merchant\nKOPI CONTOH\nTotal\nRp 38.000\nTanggal\n03 Nov 2026 09:41' },
  { name: 'a top-up with its balance after', title: 'Top Up Berhasil', body: 'Jumlah\nRp 200.000\nSaldo\nRp 1.250.000' },
  { name: 'a refund with Merchant and Jumlah', title: 'Refund diterima', body: 'Merchant\nTOKO CONTOH\nJumlah\nRp 75.000' },
  { name: 'money in, in English', title: 'Payment received', body: 'Amount\n$12.50\nSender\nJOHN CONTOH' },
  { name: 'a bare Total and Merchant', title: null, body: 'Total\nRp38.000\nMerchant\nKOPI CONTOH' },
  { name: 'a shared card message with its labels', title: 'Transaksi Kartu Kredit', body: 'No. Kartu\n****5512\nMerchant\nTOKO ROTI\nJumlah\nIDR 48.300,00\nTgl\n03/09/26' },
  { name: 'money in, with Status', title: 'Dana Masuk', body: 'Jumlah\nRp 320.000\nDari\nANDI CONTOH\nStatus\nBerhasil' },
  { name: 'a wallet payment with Status and Waktu', title: null, body: 'Pembayaran ke WARUNG CONTOH\nTotal Bayar\nRp 27.500\nWaktu\n12 Okt 2026 18:20\nStatus\nSukses' },
];
