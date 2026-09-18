import type { AccountSubtype } from '@expanses/db';

/**
 * The kinds of account someone can open, and what each is called. Pure data, so the list the Accounts page
 * offers and the label every screen prints stay one thing.
 *
 * A fund account is money held at a broker or fund manager ready to invest — an Indonesian RDN, a brokerage
 * cash account. A digital wallet is GoPay, OVO, DANA or ShopeePay. Both hold money and both pay and receive,
 * so both are money accounts, not holdings: what they are worth is what the ledger says.
 */
export const ACCOUNT_TYPES: { subtype: AccountSubtype; kind: 'asset' | 'liability' }[] = [
  { subtype: 'bank', kind: 'asset' },
  { subtype: 'cash', kind: 'asset' },
  { subtype: 'savings', kind: 'asset' },
  { subtype: 'ewallet', kind: 'asset' },
  { subtype: 'fund', kind: 'asset' },
  { subtype: 'credit_card', kind: 'liability' },
  { subtype: 'investment', kind: 'asset' },
  { subtype: 'property', kind: 'asset' },
  { subtype: 'vehicle', kind: 'asset' },
  { subtype: 'receivable', kind: 'asset' },
  { subtype: 'loan', kind: 'liability' },
  { subtype: 'payable', kind: 'liability' },
];

export const SUBTYPE_LABELS: Record<string, string> = {
  bank: 'Current account',
  cash: 'Cash',
  savings: 'Saving account',
  fund: 'Fund account',
  ewallet: 'Digital wallet',
  investment: 'Investment',
  property: 'Property',
  vehicle: 'Vehicle',
  receivable: 'Money owed to me',
  credit_card: 'Credit card',
  loan: 'Loan',
  payable: 'Money I owe',
};
