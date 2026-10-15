import type { PostingLine } from '../ledger/types';
import { type ExpenseRecord, type SettlementRecord, SharedEventError, sharesOf, toEvent } from './split';

/*
 * What a shared event's record puts in one phone's own books (spec §5's table). Every line is in its own currency; the
 * currency exchange account balances each currency to zero, as `exchangeLines` does for a conversion, so a euro dinner
 * in a lira trip paid from a rupiah card is one posting. The trip balance moves by exactly this person's figure in
 * `balances` — the converted shares of the others when this person paid, minus their own converted share when someone
 * else did — so the account and the Balances tab never disagree (Review Focus 2).
 */

export interface MyLineAccounts {
  /** This phone's local copy of the event category, an expense account in no workspace book. */
  shareAccountId: string;
  /** The trip balance: an `event_balance` asset in the event currency. */
  eventBalanceAccountId: string;
  /** The currency exchange equity account. */
  exchangeAccountId: string;
}

/** The account this person paid from, and what it was charged in its own currency (ruling R5). */
export interface PaidFromAccount {
  accountId: string;
  currency: string;
  chargedMinor: number;
  /** On a card: the category the card earns by (ruling R12). */
  spendCategoryId?: string | null;
}

export type MyLines = { kind: 'none' } | { kind: 'needs-account' } | { kind: 'lines'; lines: PostingLine[] };

/** Drops zero lines and balances every currency through the exchange account, currencies in code order. */
function throughExchange(lines: PostingLine[], exchangeAccountId: string): PostingLine[] {
  const kept = lines.filter((line) => line.amountMinor !== 0);
  const sums = new Map<string, number>();
  for (const line of kept) sums.set(line.currency, (sums.get(line.currency) ?? 0) + line.amountMinor);
  const out = [...kept];
  for (const [currency, sum] of [...sums].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (sum !== 0) out.push({ accountId: exchangeAccountId, amountMinor: -sum, currency });
  }
  return out;
}

export function myExpenseLines(input: { expense: ExpenseRecord; eventCurrency: string; me: string; accounts: MyLineAccounts; paidFrom: PaidFromAccount | null }): MyLines {
  const { expense, eventCurrency, me, accounts, paidFrom } = input;
  if (expense.voided) return { kind: 'none' };
  const shares = sharesOf(expense);
  const mine = shares.find((share) => share.personId === me)?.minor ?? 0;
  const lines: PostingLine[] = [];
  if (expense.payerPersonId === me) {
    // Ruling R6: "I paid" lands on a money account only when this phone holds it.
    if (!paidFrom) return { kind: 'needs-account' };
    if (!Number.isSafeInteger(paidFrom.chargedMinor) || paidFrom.chargedMinor <= 0) throw new SharedEventError('BAD_AMOUNT', 'What the account was charged is above zero');
    lines.push({ accountId: paidFrom.accountId, amountMinor: -paidFrom.chargedMinor, currency: paidFrom.currency, ...(paidFrom.spendCategoryId ? { spendCategoryId: paidFrom.spendCategoryId } : {}) });
    lines.push({ accountId: accounts.shareAccountId, amountMinor: mine, currency: expense.currency });
    const others = shares.filter((share) => share.personId !== me).reduce((sum, share) => sum + toEvent(share.minor, expense.currency, expense.rateToEvent, eventCurrency), 0);
    lines.push({ accountId: accounts.eventBalanceAccountId, amountMinor: others, currency: eventCurrency });
  } else {
    if (mine === 0) return { kind: 'none' };
    lines.push({ accountId: accounts.shareAccountId, amountMinor: mine, currency: expense.currency });
    lines.push({ accountId: accounts.eventBalanceAccountId, amountMinor: -toEvent(mine, expense.currency, expense.rateToEvent, eventCurrency), currency: eventCurrency });
  }
  return { kind: 'lines', lines: throughExchange(lines, accounts.exchangeAccountId) };
}

export function mySettlementLines(input: {
  settlement: SettlementRecord;
  eventCurrency: string;
  me: string;
  eventBalanceAccountId: string;
  exchangeAccountId: string;
  account: { accountId: string; currency: string; amountMinor: number } | null;
}): MyLines {
  const { settlement, eventCurrency, me, account } = input;
  if (settlement.fromPersonId === settlement.toPersonId) throw new SharedEventError('BAD_SETTLEMENT', 'A settlement is between two people');
  if (settlement.voided) return { kind: 'none' };
  const paying = settlement.fromPersonId === me;
  if (!paying && settlement.toPersonId !== me) return { kind: 'none' };
  if (!account) return { kind: 'needs-account' };
  if (!Number.isSafeInteger(account.amountMinor) || account.amountMinor <= 0) throw new SharedEventError('BAD_AMOUNT', 'What the account paid or received is above zero');
  const sign = paying ? 1 : -1;
  return {
    kind: 'lines',
    lines: throughExchange(
      [
        { accountId: account.accountId, amountMinor: -sign * account.amountMinor, currency: account.currency },
        { accountId: input.eventBalanceAccountId, amountMinor: sign * settlement.amountMinor, currency: eventCurrency },
      ],
      input.exchangeAccountId,
    ),
  };
}
