import { type AccountRow, spendingSwitchOn } from '@expanses/db';
import { keptForSpending } from '../../lib/account-types';
import { spendingBook } from '../accounts/pockets';
import { faceFor, type FaceKind, type FaceRef, prepaidFaceOf, tieredKey } from '../cards/debit-art/faces';

/**
 * Which cards Wallet holds, and in what order: everything money is spent from or owed on.
 *
 * Money first, as it is spent — the bank accounts a debit card draws on (current and saving accounts alike), then
 * cash, then digital wallets and electronic money cards, then any other cash equivalent — and the credit cards last, so the card in front is the
 * one most often reached for. Within a kind, the order the ledger lists accounts in.
 *
 * Only money kept for spending is here. An account switched off "For spending" is savings: it stays on Net worth's
 * Assets with its own page, and a transfer still names it, but it is not a card in Wallet. Nor is anything that can
 * never be paid from — a deposit, a broker's cash — and nor are money lent to a person, a loan or money owed to a
 * person: each of those is read on Net worth (Receivables under Assets; Loans and Payables under Liabilities).
 */
const MONEY_RANK: Record<string, number> = { bank: 0, savings: 0, cash: 1, ewallet: 2, emoney: 2, other_cash: 3 };

/**
 * The money cards: one per account kept for spending, an account with pockets once (its pockets are never cards) —
 * and only while one of its pockets is kept for spending: with every pocket switched off it leaves, as an account
 * switched off does (`spendingBook`).
 */
export function walletMoney(accounts: readonly AccountRow[]): AccountRow[] {
  return spendingBook(accounts)
    .filter((a) => a.archivedAt === null && a.parentId === null && keptForSpending(a))
    .map((account, index) => ({ account, index }))
    .sort((a, b) => MONEY_RANK[a.account.subtype]! - MONEY_RANK[b.account.subtype]! || a.index - b.index)
    .map(({ account }) => account);
}

/** The credit cards, still open, in the ledger's order. */
export function walletCredit(accounts: readonly AccountRow[]): AccountRow[] {
  return accounts.filter((a) => a.archivedAt === null && a.kind === 'liability' && a.subtype === 'credit_card' && spendingSwitchOn(a));
}

/**
 * The credit card open on its page that Wallet does not hold because it is switched off "For spending" (owner,
 * 22 Nov 2026): reached from Net worth's Liabilities, Debts or its own Settings, it is raised as a Wallet card is — the
 * bar with ✕ and ⚙, the big face that turns over, its page under it — and it is still in none of Wallet's views, its
 * Balance box, filters or totals. An archived card, or anything that is not a credit card, is not one.
 */
export function walletAsideCredit(accounts: readonly AccountRow[], id: string | undefined): AccountRow | undefined {
  if (id === undefined) return undefined;
  return accounts.find((a) => a.id === id && a.archivedAt === null && a.kind === 'liability' && a.subtype === 'credit_card' && !spendingSwitchOn(a));
}

/**
 * Every Wallet card, in the order all three views draw them — the stack top to bottom, the grid left to right, the
 * carousel first to last.
 *
 * Until the cards have been put in an order by hand (Reorder cards), it is the default: the money (`walletMoney`),
 * then the credit cards (`walletCredit`). Once any card carries a place (`sortOrder` above 0), the cards are one
 * mixed list in that order — a credit card may stand in front of a bank account — and a card still at 0, added since,
 * goes after them, the ones at 0 in the default order among themselves.
 */
export function walletOrder(accounts: readonly AccountRow[]): AccountRow[] {
  const cards = [...walletMoney(accounts), ...walletCredit(accounts)];
  if (!cards.some((card) => card.sortOrder > 0)) return cards;
  const placed = cards.filter((card) => card.sortOrder > 0);
  const unplaced = cards.filter((card) => card.sortOrder <= 0);
  // A stable sort: two cards at one place (written on two devices, say) keep the default order between them.
  return [...placed.map((card, index) => ({ card, index })).sort((a, b) => a.card.sortOrder - b.card.sortOrder || a.index - b.index).map(({ card }) => card), ...unplaced];
}

/**
 * The words on a money card's chip: what it is. A current or saving account is the debit card that spends from it —
 * named by the account number's last four digits when they were given, and plainly an account when they were not.
 */
export function moneyChip(account: Pick<AccountRow, 'subtype'>, numberLast4?: string | null): string {
  if (account.subtype === 'cash') return 'Cash';
  if (account.subtype === 'ewallet') return 'E-wallet';
  if (account.subtype === 'emoney') return 'E-money';
  if ((account.subtype === 'bank' || account.subtype === 'savings') && numberLast4) return `Debit ···· ${numberLast4}`;
  return 'Account';
}

/**
 * Which drawn faces money of each kind may be given. A bank account is only ever a bank's debit card: "Dana darurat"
 * is savings, not the DANA wallet. A digital wallet is its app, or a prepaid card recorded as one (before electronic
 * money was a kind of its own); electronic money is a prepaid card and nothing else; cash and other cash equivalents
 * can be a prepaid card. Nothing here is ever a PayLater line, which is a credit account.
 */
export function faceKindsOf(subtype: string): readonly FaceKind[] {
  switch (subtype) {
    case 'bank':
    case 'savings':
      return ['debit'];
    case 'ewallet':
      return ['ewallet', 'emoney'];
    case 'emoney':
    case 'cash':
    case 'other_cash':
      return ['emoney'];
    default:
      return [];
  }
}

/**
 * A money card's drawn face: its bank's (the tax report's Nama institusi), else whatever its own name names — a
 * wallet's app, a prepaid card — and electronic money whose name names no card is the card its bank issues
 * (`prepaidFaceOf`); at its tier (0087), the bank's first card when it has none. The one rule for an own account and a
 * partner's joint one (whose bank and tier its holder's summary carries), so both phones draw the same face. Null keeps
 * the plain face.
 */
export function moneyFaceOf(bank: string | null | undefined, name: string, subtype: string, tier: string | null | undefined): FaceRef | null {
  const face = faceFor([bank, name], faceKindsOf(subtype)) ?? (subtype === 'emoney' ? prepaidFaceOf(bank) : null);
  return face ? { key: tieredKey(face, tier), kind: face.kind, mark: face.mark } : null;
}

/**
 * The bank an account is at, as the tax report keeps it (Nama institusi): its own profile's, or — for an account with
 * pockets, whose profiles are the pockets' — the first pocket's that names one. Null when none does.
 */
export function bankOf(accountId: string, accounts: readonly Pick<AccountRow, 'id' | 'parentId'>[], profiles: readonly { accountId: string; coretaxFields: Record<string, string> }[]): string | null {
  const inst = (id: string) => profiles.find((profile) => profile.accountId === id)?.coretaxFields.inst?.trim() || null;
  return inst(accountId) ?? accounts.filter((a) => a.parentId === accountId).map((pocket) => inst(pocket.id)).find((name) => name !== null) ?? null;
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
