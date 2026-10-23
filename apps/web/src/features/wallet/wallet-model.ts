import type { AccountRow } from '@expanses/db';
import { keptForSpending } from '../../lib/account-types';

/**
 * Which cards Wallet holds, and in what order: everything money is spent from or owed on.
 *
 * Money first, as it is spent — the bank accounts a debit card draws on (current and saving accounts alike), then
 * cash, then digital wallets, then any other cash equivalent — and the credit cards last, so the card in front is the
 * one most often reached for. Within a kind, the order the ledger lists accounts in.
 *
 * Only money kept for spending is here. An account switched off "For spending" is savings: it stays on Net worth's
 * Assets with its own page, and a transfer still names it, but it is not a card in Wallet. Nor is anything that can
 * never be paid from — a deposit, a broker's cash — and nor are money lent to a person, a loan or money owed to a
 * person: each of those is read on Net worth (Receivables under Assets; Loans and Payables under Liabilities).
 */
const MONEY_RANK: Record<string, number> = { bank: 0, savings: 0, cash: 1, ewallet: 2, other_cash: 3 };

/** The money cards: one per account kept for spending, an account with pockets once (its pockets are never cards). */
export function walletMoney(accounts: readonly AccountRow[]): AccountRow[] {
  return accounts
    .filter((a) => a.archivedAt === null && a.parentId === null && keptForSpending(a))
    .map((account, index) => ({ account, index }))
    .sort((a, b) => MONEY_RANK[a.account.subtype]! - MONEY_RANK[b.account.subtype]! || a.index - b.index)
    .map(({ account }) => account);
}

/** The credit cards, still open, in the ledger's order. */
export function walletCredit(accounts: readonly AccountRow[]): AccountRow[] {
  return accounts.filter((a) => a.archivedAt === null && a.kind === 'liability' && a.subtype === 'credit_card');
}

/**
 * The words on a money card's chip: what it is. A current or saving account is the debit card that spends from it —
 * named by the account number's last four digits when they were given, and plainly an account when they were not.
 */
export function moneyChip(account: Pick<AccountRow, 'subtype'>, numberLast4?: string | null): string {
  if (account.subtype === 'cash') return 'Cash';
  if (account.subtype === 'ewallet') return 'E-wallet';
  if ((account.subtype === 'bank' || account.subtype === 'savings') && numberLast4) return `Debit ···· ${numberLast4}`;
  return 'Account';
}

/** Where Wallet's Balance box is remembered as hidden: one device's choice, never synced. */
export const BALANCE_HIDDEN_KEY = 'wallet.balance-hidden';

/** Whether this device hid the Balance box. Storage that cannot be read (a private window) reads as shown. */
export function readBalanceHidden(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): boolean {
  try {
    return storage?.getItem(BALANCE_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remembers the choice; storage that cannot be written leaves it for this visit only. */
export function writeBalanceHidden(hidden: boolean, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): void {
  try {
    if (hidden) storage?.setItem(BALANCE_HIDDEN_KEY, '1');
    else storage?.removeItem(BALANCE_HIDDEN_KEY);
  } catch {
    /* Nothing to do: the box still hides, it is only not remembered. */
  }
}
