import { type BillStateKind, sumToBase } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
import { freeToSpend, moneySummary, pocketsOf, SPENDABLE_KINDS } from '../accounts/pockets';
import { owedMinor } from '../networth/debt-rows';

type Rates = Readonly<Record<string, number>>;

/**
 * Wallet's Balance box, worked out from the rows it is read from: money kept for spending, less what goals and
 * sinking funds have set aside of it, less what the credit cards owe, less the bills still to pay this month.
 *
 * Paying a bill or a card never moves the figure: a bill paid from a bank leaves Spending money and Bills still to
 * pay by the same amount; paid with a card it moves from Bills still to pay into Owed on cards; a card paid from a
 * bank leaves Spending money and Owed on cards alike. Only spending and income move it.
 */

/** One bill's month, as the Recurring page reads it (`billsInMonth`): the fields Wallet needs of it. */
export interface BillMonthInput {
  id: string;
  name: string;
  categoryAccountId: string;
  /** YYYY-MM: the month this occurrence belongs to. */
  month: string;
  state: BillStateKind;
  /** YYYY-MM-DD the bill is due. */
  payBy: string;
  /** The fixed amount; null when it varies. */
  amountMinor: number | null;
  /** The fixed amount, else what it came to the last time it was paid. */
  estimateMinor: number | null;
  /** The currency both amounts are in: the bill's own, else its paying account's. */
  currency: string;
}

/** A sinking fund's saving on an account the box counts, by bill: already taken off with the other set-asides. */
export interface FundSaved {
  billId: string;
  minor: number;
  currency: string;
}

/** One bill still to pay, as the sheet lists it and the row adds it up. */
export interface BillToPay {
  id: string;
  name: string;
  categoryAccountId: string;
  payBy: string;
  currency: string;
  /** What is still to come out: its amount (or estimate), less what its sinking fund has already set aside. */
  minor: number;
  /** The amount varies, so `minor` is the last payment's figure. */
  about: boolean;
  /** What its sinking fund had set aside, already counted with the other set-asides; 0 for a bill without one. */
  setAsideMinor: number;
}

/** The months still owed: not paid (by a payment or a linked purchase), not skipped, not paused. */
const OWED: ReadonlySet<BillStateKind> = new Set(['upcoming', 'open', 'dueSoon', 'overdue']);

/**
 * The bills still to pay in `month`, soonest first. Only this month's occurrence counts — one already late from this
 * month does, an earlier month's does not. A bill whose amount varies counts at its estimate; one with neither an
 * amount nor a payment to go by has no figure, so it is left out.
 *
 * A bill saving up in a sinking fund on spending money already had that saving taken off as a set-aside: only what the
 * fund does not cover is counted here, and a bill its fund covers in full is not listed at all. A fund in another
 * currency than its bill is never made (the fund is refused), so only a fund in the bill's own currency is netted.
 */
export function billsToPay(rows: readonly BillMonthInput[], month: string, funds: readonly FundSaved[] = []): BillToPay[] {
  return rows
    .filter((row) => row.month === month && OWED.has(row.state))
    .flatMap((row) => {
      const figure = row.amountMinor ?? row.estimateMinor;
      if (figure === null || figure <= 0) return [];
      const saved = funds.filter((fund) => fund.billId === row.id && fund.currency === row.currency).reduce((sum, fund) => sum + Math.max(0, fund.minor), 0);
      const setAsideMinor = Math.min(saved, figure);
      const minor = figure - setAsideMinor;
      if (minor <= 0) return [];
      return [{ id: row.id, name: row.name, categoryAccountId: row.categoryAccountId, payBy: row.payBy, currency: row.currency, minor, about: row.amountMinor === null, setAsideMinor }];
    })
    .sort((a, b) => a.payBy.localeCompare(b.payBy) || a.name.localeCompare(b.name));
}

/** A set-aside on one account, as `setAsideViews` gives it: the total, and the sinking funds' part of it by bill. */
export interface AccountSetAsideInput {
  accountId: string;
  setAsideMinor: number;
  currency: string;
  funds: readonly { billId: string; promisedMinor: number }[];
}

export interface WalletBoxInput {
  /** The accounts Wallet reads (`spendingBook`). */
  book: readonly AccountRow[];
  balances: Readonly<Record<string, number>>;
  /** The credit cards Wallet holds (`walletCredit`). */
  credit: readonly AccountRow[];
  baseCurrency: string;
  rates: Rates;
  setAsides: readonly AccountSetAsideInput[];
  bills: readonly BillMonthInput[];
  /** YYYY-MM: the calendar month whose bills are still to pay. */
  month: string;
  /** The partner's joint money and joint cards Wallet holds (`walletJoint`), from their summaries. */
  joint?: readonly JointBoxInput[];
}

/**
 * A partner's joint item as the box counts it: money adds what it holds to Spending money, a card what it owes to Owed
 * on cards. The figure is the latest its owner's phone sent, however old: it is the latest balance known.
 */
export interface JointBoxInput {
  key: string;
  side: 'money' | 'credit';
  /** In `currency`: what the money holds, or what the card owes. */
  minor: number;
  currency: string;
  /** Money only, in `currency`: what its holder's phone set aside of it, taken off Spending money as an own set-aside is. */
  setAsideMinor?: number;
}

export interface WalletBox {
  /** Spending money: what is kept for spending, less what is set aside of it. Null when a rate is missing. */
  spendingMinor: number | null;
  /** Owed on cards: every credit card's whole balance. */
  cardsMinor: number | null;
  /** Bills still to pay this month, less what their funds already set aside. */
  billsMinor: number | null;
  /** Balance: Spending money less Owed on cards less Bills still to pay. */
  balanceMinor: number | null;
  /** The bills the third row is made of, for its sheet. */
  bills: BillToPay[];
  /** The currencies no rate reaches, named once; every figure above is null while any is. */
  missing: string[];
  /** Whether any figure came from another currency, so the Balance is shown as an estimate. */
  estimated: boolean;
  /** How many accounts the box counts; no box is drawn over none. */
  accounts: number;
}

/** The whole box, from the rows it is read from (see the file's head). */
export function walletBox({ book, balances, credit, baseCurrency, rates, setAsides, bills, month, joint = [] }: WalletBoxInput): WalletBox {
  const own = moneySummary(book, balances, baseCurrency, rates, SPENDABLE_KINDS);
  // The partner's joint money is spending money too: converted as own money is, a missing rate named the same way.
  const jointMoney = joint.filter((item) => item.side === 'money').map((item) => ({ minor: item.minor, currency: item.currency }));
  const shared = sumToBase({ amounts: jointMoney, baseCurrency, ratesToBase: rates });
  const spendable = {
    totalMinor: own.totalMinor === null || shared.totalMinor === null ? null : own.totalMinor + shared.totalMinor,
    missing: [...new Set([...own.missing, ...shared.missing])].sort(),
    converted: own.converted || jointMoney.some((amount) => amount.currency !== baseCurrency),
    accounts: own.accounts + jointMoney.length,
  };
  const counted = new Set(book.filter((a) => a.kind === 'asset' && SPENDABLE_KINDS.has(a.subtype)).map((a) => a.id));
  const kept = setAsides.filter((row) => counted.has(row.accountId));
  // The partner's joint money's set-asides, as its holder's phone sent them: off Spending money here as on the holder's.
  const promiseAmounts = kept
    .map((row) => ({ minor: row.setAsideMinor, currency: row.currency }))
    .concat(joint.flatMap((item) => (item.side === 'money' && (item.setAsideMinor ?? 0) > 0 ? [{ minor: item.setAsideMinor!, currency: item.currency }] : [])));
  const promised = sumToBase({ amounts: promiseAmounts, baseCurrency, ratesToBase: rates });
  const askedAmounts = credit.flatMap((card) => {
    const owes = owedMinor(balances, card.id);
    return owes > 0 ? [{ minor: owes, currency: card.currency ?? baseCurrency }] : [];
  }).concat(joint.flatMap((item) => (item.side === 'credit' && item.minor > 0 ? [{ minor: item.minor, currency: item.currency }] : [])));
  const asked = sumToBase({ amounts: askedAmounts, baseCurrency, ratesToBase: rates });
  const funds = kept.flatMap((row) => row.funds.map((fund) => ({ billId: fund.billId, minor: fund.promisedMinor, currency: row.currency })));
  const owed = billsToPay(bills, month, funds);
  const billAmounts = owed.map((bill) => ({ minor: bill.minor, currency: bill.currency }));
  const billed = sumToBase({ amounts: billAmounts, baseCurrency, ratesToBase: rates });

  const unclaimed = freeToSpend(spendable, promised, { totalMinor: 0, missing: [] });
  const due = {
    totalMinor: asked.totalMinor === null || billed.totalMinor === null ? null : asked.totalMinor + billed.totalMinor,
    missing: [...asked.missing, ...billed.missing],
  };
  const free = freeToSpend(spendable, promised, due);
  const missing = free.missing;
  const known = (minor: number | null) => (missing.length > 0 ? null : minor);
  return {
    spendingMinor: known(unclaimed.freeMinor),
    cardsMinor: known(asked.totalMinor),
    billsMinor: known(billed.totalMinor),
    balanceMinor: free.freeMinor,
    bills: owed,
    missing,
    estimated: spendable.converted || [...promiseAmounts, ...askedAmounts, ...billAmounts].some((amount) => amount.currency !== baseCurrency),
    accounts: spendable.accounts,
  };
}

/** Which row of the box the grid is filtered to: the accounts that make up Spending money, or the credit cards. */
export type WalletFilter = 'spending' | 'cards';

/** A tap on a filter row: that row's filter, or none when it was already the one in force. */
export function toggleFilter(current: WalletFilter | null, tapped: WalletFilter): WalletFilter | null {
  return current === tapped ? null : tapped;
}

/**
 * The cards the grid shows under a filter, in the grid's own order: every money card for Spending money (the same
 * accounts its figure counts), every credit card for Owed on cards — a card that owes nothing too. No filter: all.
 */
export function filteredCards<T extends { key: string }>(cards: readonly T[], filter: WalletFilter | null, money: readonly Pick<AccountRow, 'id'>[], credit: readonly Pick<AccountRow, 'id'>[]): T[] {
  if (filter === null) return [...cards];
  const ids = new Set((filter === 'spending' ? money : credit).map((account) => account.id));
  return cards.filter((card) => ids.has(card.key));
}

/**
 * The two sets the filter rows keep, own and the partner's together: the money cards (`walletMoney` and the joint money)
 * for Spending money, the credit cards (`walletCredit` and the joint cards) for Owed on cards — as `filteredCards` takes them.
 */
export function walletFilterSets(
  money: readonly Pick<AccountRow, 'id'>[],
  credit: readonly Pick<AccountRow, 'id'>[],
  joint: readonly Pick<JointBoxInput, 'key' | 'side'>[],
): [Pick<AccountRow, 'id'>[], Pick<AccountRow, 'id'>[]] {
  const of = (side: JointBoxInput['side']) => joint.filter((item) => item.side === side).map((item) => ({ id: item.key }));
  return [[...money, ...of('money')], [...credit, ...of('credit')]];
}

/** What a money card's figure is, in the base currency: its balance, or its pockets' for an account with pockets. */
export function moneyCardMinor(account: AccountRow, book: readonly AccountRow[], balances: Readonly<Record<string, number>>, baseCurrency: string, rates: Rates): number | null {
  const pockets = pocketsOf(account.id, book);
  const held = pockets.length > 0 ? pockets : [account];
  return sumToBase({ amounts: held.map((a) => ({ minor: balances[a.id] ?? 0, currency: a.currency! })), baseCurrency, ratesToBase: rates }).totalMinor;
}
