import type { WordList } from '../types';

/** English: the same shape, in the words a notification in English uses. */
export const EN: WordList = {
  spent: ['paid', 'payment', 'sent', 'debit', 'purchase', 'spent', 'withdrawal'],
  received: ['received', 'credited', 'credit', 'incoming', 'deposit'],
  topup: ['top up', 'top-up', 'topup', 'reload'],
  refund: ['refund', 'refunded'],
  notDirection: ['credit card', 'credit-card'],
  promo: ['discount', 'cashback', 'voucher', 'promo', 'reward', 'coupon', 'points'],
  balance: ['balance', 'available balance', 'remaining'],
  amountLabels: ['total', 'amount', 'grand total', 'total paid'],
  nameLabels: ['merchant', 'recipient', 'payee', 'to account', 'sender', 'store'],
  nameLeadIns: ['to', 'at', 'from'],
  paymentLabels: ['payment method', 'paid with', 'pay with', 'source of funds', 'funding source', 'card used'],
  cardWords: ['credit card', 'debit card', 'card'],
  idLabels: ['id', 'user id', 'phone', 'phone number', 'mobile number'],
  thousand: ['k'],
  million: ['m'],
};
