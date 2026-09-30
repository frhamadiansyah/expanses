import type { WordList } from '../types';

/** Indonesian: what its banks and wallets actually print. No institution's name appears here. */
export const ID: WordList = {
  spent: ['bayar', 'pembayaran', 'transfer ke', 'kirim', 'dikirim', 'debit', 'belanja', 'tarik tunai'],
  received: ['masuk', 'diterima', 'dana masuk', 'terima', 'kredit', 'transfer dari', 'refund'],
  topup: ['top up', 'topup', 'isi saldo', 'isi ulang'],
  refund: ['refund', 'pengembalian dana'],
  promo: ['diskon', 'cashback', 'voucher', 'promo', 'reward', 'kupon', 'poin'],
  balance: ['saldo', 'sisa saldo'],
  amountLabels: ['total', 'total bayar', 'jumlah', 'nominal', 'total pembayaran'],
  nameLabels: ['merchant', 'penerima', 'nama penerima', 'toko', 'pengirim'],
  nameLeadIns: ['ke', 'di', 'dari'],
  thousand: ['rb', 'ribu'],
  million: ['jt', 'juta'],
};
