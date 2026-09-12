import type { PostingLine } from '../ledger/types';
import { formatMinor } from '../money/money';

export type DebtDirection = 'lent' | 'borrowed';

export type DebtErrorCode = 'AMOUNT_NOT_POSITIVE' | 'OVER_REPAYMENT' | 'CURRENCY_MISMATCH' | 'SPLIT_MISMATCH';

export class DebtError extends Error {
  readonly code: DebtErrorCode;

  constructor(code: DebtErrorCode, message: string) {
    super(message);
    this.name = 'DebtError';
    this.code = code;
  }
}

export interface DebtAccounts {
  /** The receivable or payable account for this person. */
  debtAccountId: string;
  /** Bank, cash, or the credit card that funded it. */
  moneyAccountId: string;
  /** Interest received on money lent. Seeded key `income.other`. */
  otherIncomeAccountId: string;
  /** Interest paid on money borrowed. Seeded key `fees.interest`. */
  interestAccountId: string;
  /** Where a forgiven balance goes. Seeded key `gifts_donations`, or the owner's choice. */
  forgivenessAccountId: string;
}

export interface DebtAmount {
  amountMinor: number;
  currency: string;
}

export interface RepaymentAmount extends DebtAmount {
  /** Interest on top of the principal. Zero for the usual loan between friends. */
  interestMinor: number;
  /** What is still owed before this repayment, so too large a one can be refused. */
  balanceMinor: number;
  personName: string;
}

export interface SplitShare {
  debtAccountId: string;
  amountMinor: number;
}

export interface SplitBill {
  totalMinor: number;
  ownCategoryId: string;
  /** Your own part of the bill, which is spending. Zero when you only paid for others. */
  ownShareMinor: number;
  shares: SplitShare[];
  currency: string;
}

const line = (accountId: string, amountMinor: number, currency: string): PostingLine => ({ accountId, amountMinor, currency });

function assertPositive(amountMinor: number, what: string): void {
  if (!(amountMinor > 0)) throw new DebtError('AMOUNT_NOT_POSITIVE', `${what} needs an amount greater than zero`);
}

function assertNotNegative(amountMinor: number, what: string): void {
  if (amountMinor < 0) throw new DebtError('AMOUNT_NOT_POSITIVE', `${what} cannot be negative`);
}

/** Money handed over: the person owes it, and the money account is lighter. */
export function lendPostings(input: DebtAmount, accounts: DebtAccounts): PostingLine[] {
  assertPositive(input.amountMinor, 'A loan');
  return [
    line(accounts.debtAccountId, input.amountMinor, input.currency),
    line(accounts.moneyAccountId, -input.amountMinor, input.currency),
  ];
}

/**
 * Money received back. The principal lowers what the person owes; interest is income of its own,
 * so a repayment can never quietly turn interest into principal.
 */
export function repaymentPostings(input: RepaymentAmount, accounts: DebtAccounts): PostingLine[] {
  assertPositive(input.amountMinor, 'A repayment');
  assertNotNegative(input.interestMinor, 'Interest');
  if (input.amountMinor > input.balanceMinor) {
    throw new DebtError('OVER_REPAYMENT', `${input.personName} owes ${formatMinor(input.balanceMinor, input.currency)}`);
  }
  const lines = [
    line(accounts.moneyAccountId, input.amountMinor + input.interestMinor, input.currency),
    line(accounts.debtAccountId, -input.amountMinor, input.currency),
  ];
  if (input.interestMinor > 0) lines.push(line(accounts.otherIncomeAccountId, -input.interestMinor, input.currency));
  return lines;
}

/** Money taken from a person: the bank rises and the payable rises with it. */
export function borrowPostings(input: DebtAmount, accounts: DebtAccounts): PostingLine[] {
  assertPositive(input.amountMinor, 'A loan');
  return [
    line(accounts.moneyAccountId, input.amountMinor, input.currency),
    line(accounts.debtAccountId, -input.amountMinor, input.currency),
  ];
}

/** Paying a person back. Interest is spending, kept apart from the principal. */
export function repayBorrowedPostings(input: RepaymentAmount, accounts: DebtAccounts): PostingLine[] {
  assertPositive(input.amountMinor, 'A repayment');
  assertNotNegative(input.interestMinor, 'Interest');
  if (input.amountMinor > input.balanceMinor) {
    throw new DebtError('OVER_REPAYMENT', `${input.personName} is owed ${formatMinor(input.balanceMinor, input.currency)}`);
  }
  const lines = [
    line(accounts.debtAccountId, input.amountMinor, input.currency),
    line(accounts.moneyAccountId, -(input.amountMinor + input.interestMinor), input.currency),
  ];
  if (input.interestMinor > 0) lines.push(line(accounts.interestAccountId, input.interestMinor, input.currency));
  return lines;
}

/** Writing off what is left: the receivable goes, and the amount becomes a gift. */
export function forgivePostings(input: { balanceMinor: number; currency: string }, accounts: DebtAccounts): PostingLine[] {
  assertPositive(input.balanceMinor, 'Forgiving a debt');
  return [
    line(accounts.forgivenessAccountId, input.balanceMinor, input.currency),
    line(accounts.debtAccountId, -input.balanceMinor, input.currency),
  ];
}

/**
 * A bill paid in full by one account, where the others owe their share. Your own part is spending;
 * each friend's part waits in their own receivable until they pay it back.
 */
export function splitBillPostings(input: SplitBill, accounts: Pick<DebtAccounts, 'moneyAccountId'>): PostingLine[] {
  assertPositive(input.totalMinor, 'A bill');
  assertNotNegative(input.ownShareMinor, 'Your share');
  for (const share of input.shares) assertPositive(share.amountMinor, "A friend's share");
  const shared = input.shares.reduce((total, share) => total + share.amountMinor, 0);
  const counted = input.ownShareMinor + shared;
  if (counted !== input.totalMinor) {
    throw new DebtError('SPLIT_MISMATCH', `The bill is ${formatMinor(input.totalMinor, input.currency)} but the split adds up to ${formatMinor(counted, input.currency)}`);
  }
  const lines: PostingLine[] = [line(input.ownCategoryId, input.ownShareMinor, input.currency)];
  for (const share of input.shares) lines.push(line(share.debtAccountId, share.amountMinor, input.currency));
  lines.push(line(accounts.moneyAccountId, -input.totalMinor, input.currency));
  return lines;
}

export type DebtAction = 'lend' | 'repayment' | 'borrow' | 'repay' | 'forgive';

const DESCRIPTIONS: Record<DebtAction, (personName: string) => string> = {
  lend: (person) => `Lent to ${person}`,
  repayment: (person) => `Repayment from ${person}`,
  borrow: (person) => `Borrowed from ${person}`,
  repay: (person) => `Repaid ${person}`,
  forgive: (person) => `Forgave what ${person} owed`,
};

export function debtDescription(action: DebtAction, personName: string): string {
  return DESCRIPTIONS[action](personName);
}
