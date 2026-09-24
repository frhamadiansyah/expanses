import type { AccountRow, AccountSubtype } from '@expanses/db';

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
  receivable: 'Receivables',
  credit_card: 'Credit card',
  loan: 'Loan',
  payable: 'Payables',
  category: 'Category',
  equity: 'Equity',
};

/**
 * Accounts money can be **paid from**: cash, a bank, a savings account, a wallet, other cash equivalents. Every
 * "pay with" list asks this — a transaction, a bill, a card, an instalment, a person.
 *
 * A broker's cash is deliberately not here. An RDN cannot be spent from: the money is moved to a current or
 * savings account first, so it is not offered behind "Paid with" and no card or shop can be charged to it. It is
 * money all the same — see `MONEY_SUBTYPES` — and a test holds this list in step with the ledger's.
 *
 * A time deposit is left out on purpose: it cannot be paid from, and the money leaves by a transfer when it
 * matures. Other cash equivalents — a cheque, a wesel, commercial paper — can be spent.
 */
export const SPENDABLE_SUBTYPES: readonly AccountSubtype[] = ['bank', 'cash', 'savings', 'ewallet', 'other_cash'];

/**
 * Money the ledger can move that nobody can spend: cash at a broker.
 *
 * Asked where the question is “can money come out of this, or go into it” rather than “can this be charged”: the
 * cash side of a trade (a buy is paid out of the broker's own cash, which is the whole point of parking there) and
 * money set aside for a goal (a goal may wait at a broker). Nothing else — a deposit's opening balance cannot come
 * from here and its payout cannot land here.
 */
export const MONEY_SUBTYPES: readonly AccountSubtype[] = [...SPENDABLE_SUBTYPES, 'fund'];

/** What can pay a bill: money the owner holds, or a card that will be settled later. */
export const WALLET_SUBTYPES: readonly AccountSubtype[] = [...SPENDABLE_SUBTYPES, 'credit_card'];

/**
 * The accounts a **transfer** moves money between: money you hold, a deposit, and the person-shaped pair.
 *
 * Deliberately not every account. A thing you own — shares, gold, a car, a house — is not money and never takes a
 * transfer, and a debt has flows of its own: a card is paid, an instalment is paid, a loan's money arrives when the
 * loan is opened. Offering "KPR BCA" or "ANTAM gold bar" as somewhere to transfer from was what this list exists
 * to stop.
 */
export const TRANSFER_SUBTYPES: readonly AccountSubtype[] = [...MONEY_SUBTYPES, 'time_deposit', 'receivable', 'payable'];

/**
 * May a transfer name this account on either side?
 *
 * `current` is kept, as `canPayWith` keeps it: a transfer recorded against an account this list no longer offers
 * must still open the way it was saved, or editing it would silently move the money.
 */
export function canTransferWith(account: Pick<AccountRow, 'id' | 'kind' | 'subtype'>, current?: string | null): boolean {
  if (current && account.id === current) return true;
  return TRANSFER_SUBTYPES.includes(account.subtype);
}

/**
 * May this account be offered as a way to pay, or as somewhere money is received? Every "pay with", "paid from"
 * and "received into" list asks this, because holding a balance is not the same as being spendable.
 *
 * An asset has to be money the owner can move: a time deposit is locked until it matures, and a house or a
 * holding of shares is not money at all, however much it is worth. A liability is the other way round — a card,
 * a loan or money owed to someone is settled later rather than held now, and every one of them can be charged.
 *
 * `current` is the account the field being drawn already names, and it is always kept. Narrowing what may be
 * chosen is a rule about new choices; applying it to a transaction already recorded would only hide the truth —
 * a purchase posted against a property account years ago would open with an empty cell reading as an error,
 * and saving the row again would silently move the money. So the list is strict for everything but what is
 * already there.
 */
export function canPayWith(account: Pick<AccountRow, 'id' | 'kind' | 'subtype'>, current?: string | null): boolean {
  if (current && account.id === current) return true;
  // An asset has to be money you can spend from; of the liabilities, only a card can be charged. A loan and a
  // person's account cannot pay for anything — an instalment is paid, and a person is settled, through their own
  // doors — and a transfer is asked of neither.
  return account.kind === 'asset' ? SPENDABLE_SUBTYPES.includes(account.subtype) : account.subtype === 'credit_card';
}

/**
 * May a transaction's money be **received into** this account?
 *
 * Money you hold, and a broker's cash is one of them: a dividend or a coupon lands in the RDN, which is the one
 * thing that set can do that the payable one cannot. Never a thing you own — a house receives nothing — and never a
 * card, a loan or a person's account.
 *
 * `current` is kept for the same reason `canPayWith` keeps it: an old row must open as it was saved.
 */
export function canReceiveInto(account: Pick<AccountRow, 'id' | 'kind' | 'subtype'>, current?: string | null): boolean {
  if (current && account.id === current) return true;
  return account.kind === 'asset' && MONEY_SUBTYPES.includes(account.subtype);
}
