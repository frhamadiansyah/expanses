import type { AccountSubtype } from '@expanses/db';

/**
 * The kinds of account someone can open, and what each is called. Pure data, so the list the Accounts page
 * offers and the label every screen prints stay one thing.
 *
 * A fund account is money held at a broker or fund manager ready to invest — an Indonesian RDN, a brokerage
 * cash account. A digital wallet is GoPay, OVO, DANA or ShopeePay. Both hold money and both pay and receive,
 * so both are money accounts, not holdings: what they are worth is what the ledger says. So are a time
 * deposit, which holds money the bank keeps until it matures, and other cash equivalents — a cheque, a
 * wesel, commercial paper.
 */
export const ACCOUNT_TYPES: { subtype: AccountSubtype; kind: 'asset' | 'liability' }[] = [
  { subtype: 'bank', kind: 'asset' },
  { subtype: 'cash', kind: 'asset' },
  { subtype: 'savings', kind: 'asset' },
  { subtype: 'ewallet', kind: 'asset' },
  { subtype: 'fund', kind: 'asset' },
  { subtype: 'time_deposit', kind: 'asset' },
  { subtype: 'other_cash', kind: 'asset' },
  { subtype: 'credit_card', kind: 'liability' },
  { subtype: 'investment', kind: 'asset' },
  { subtype: 'property', kind: 'asset' },
  { subtype: 'vehicle', kind: 'asset' },
  { subtype: 'receivable', kind: 'asset' },
  { subtype: 'loan', kind: 'liability' },
  { subtype: 'payable', kind: 'liability' },
];

/**
 * Every subtype needs a name here, so adding one to the ledger without naming it does not compile. The last
 * two are the ledger's own and never offered: a category, and the system equity accounts.
 */
export const SUBTYPE_LABELS: Record<AccountSubtype, string> = {
  bank: 'Current account',
  cash: 'Cash',
  savings: 'Saving account',
  fund: 'Fund account',
  ewallet: 'Digital wallet',
  time_deposit: 'Time deposit',
  other_cash: 'Other cash equivalents',
  investment: 'Investment',
  property: 'Property',
  vehicle: 'Vehicle',
  receivable: 'Money owed to me',
  credit_card: 'Credit card',
  loan: 'Loan',
  payable: 'Money I owe',
  category: 'Category',
  equity: 'Equity',
};

/**
 * Accounts that hold money the owner can move: what a screen offers when it asks where money comes from or
 * goes — a repayment, a loan payment, the cash side of a trade, money set aside for a goal. The ledger keeps
 * the same list for what can be earmarked; a test holds the two in step.
 */
export const SPENDABLE_SUBTYPES: readonly AccountSubtype[] = ['bank', 'cash', 'savings', 'fund', 'ewallet'];

/** What can pay a bill: money the owner holds, or a card that will be settled later. */
export const WALLET_SUBTYPES: readonly AccountSubtype[] = [...SPENDABLE_SUBTYPES, 'credit_card'];
