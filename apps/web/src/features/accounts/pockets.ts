import { CASH_ITEMS, CURRENCIES, currencyInfo, evaluateAmount, exchangeCost, type ExchangeCost, formatMinor, impliedRate, isoDate, parseMajor, sumToBase } from '@expanses/core';
import { type AccountRow, SPENDABLE_SUBTYPES, pocketParentIds } from '@expanses/db';
import { amountFields, emptyForm, type FormDraft, type MoneyFieldSpec, receivedField } from '../transactions/tx-form';

type Rates = Readonly<Record<string, number>>;

/**
 * An account's open pockets, in the order they were added: sort_order, then id. Not id alone — pockets opened
 * together share a millisecond, and uuidv7 here has no counter to order them within it.
 */
export const pocketsOf = (parentId: string, accounts: readonly AccountRow[]): AccountRow[] =>
  accounts
    .filter((a) => a.parentId === parentId && a.kind === 'asset' && a.archivedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

/** The parent's figure: its pockets added up in the base currency, or none, naming what is missing. */
export function parentTotal(pockets: readonly AccountRow[], balances: Readonly<Record<string, number>>, baseCurrency: string, ratesToBase: Rates) {
  return sumToBase({ amounts: pockets.map((p) => ({ minor: balances[p.id] ?? 0, currency: p.currency! })), baseCurrency, ratesToBase });
}

export interface PocketDraft {
  currency: string;
  balance: string;
  rate: string;
}

/**
 * Each opening balance read by `parseMajor` in its own pocket's currency — the reader the account forms use. How
 * many pockets and whether one repeats is the repository's rule (`openPocketedAccount`), not restated here.
 */
export function readPockets(rows: readonly PocketDraft[]): { currency: string; openingBalanceMinor: number; typedRate: string }[] {
  return rows.map((row) => ({ currency: row.currency, openingBalanceMinor: row.balance.trim() ? parseMajor(row.balance, row.currency) : 0, typedRate: row.rate }));
}

/**
 * Pocket `index` given `currency`. When another pocket already holds it the two rows swap places, each keeping its
 * own balance and rate, so a balance is never re-read at another currency's scale and no currency is listed twice.
 * Otherwise the row takes the currency and keeps its balance text, re-read in the new currency when saved (spec §5),
 * and loses its rate, which was per 1 unit of the old currency.
 */
export function choosePocketCurrency(rows: readonly PocketDraft[], index: number, currency: string): PocketDraft[] {
  const other = rows.findIndex((row, j) => j !== index && row.currency === currency);
  // A typed rate is per 1 unit of the old currency, so it is dropped; the balance text stays, re-read when saved.
  if (other === -1) return rows.map((row, j) => (j === index ? { ...row, currency, rate: '' } : row));
  return rows.map((row, j) => (j === index ? rows[other]! : j === other ? rows[index]! : row));
}

export const nextPocketCurrency = (rows: readonly PocketDraft[]): string => CURRENCIES.find((c) => !rows.some((row) => row.currency === c.code))?.code ?? CURRENCIES[0]!.code;

/** An ordinary transfer draft: the Move screen saves through `formToPost` like the Transfer tab. */
export const moveDraft = (bookId: string, from: AccountRow, to: AccountRow, today: string = isoDate()): FormDraft => ({
  ...emptyForm(bookId, today),
  mode: 'transfer',
  moneyId: from.id,
  toId: to.id,
});

/**
 * A new From or To. Both figures, and any rate typed for the old pair, were for the old pockets, so all are cleared; choosing the pocket
 * already on the other side swaps the two rather than moving money into itself.
 */
export function withPockets(draft: FormDraft, patch: { moneyId?: string; toId?: string }): FormDraft {
  let moneyId = patch.moneyId ?? draft.moneyId;
  let toId = patch.toId ?? draft.toId;
  if (moneyId === toId) {
    if (patch.moneyId !== undefined) toId = draft.moneyId;
    else moneyId = draft.toId;
  }
  return { ...draft, moneyId, toId, amount: '', toAmount: '', manualRate: '' };
}

export interface MoveView {
  leaves: MoneyFieldSpec;
  arrives: MoneyFieldSpec | null;
  bankRate: number | null;
  cost: ExchangeCost | null;
}

/** What the Move screen draws — every figure from the kit's own field records, read by `evaluateAmount`. */
export function moveView(draft: FormDraft, accounts: readonly AccountRow[], baseCurrency: string, ratesToBase: Rates): MoveView {
  const leaves = amountFields(draft, accounts, baseCurrency).amount;
  const arrives = receivedField(draft, accounts);
  const out = evaluateAmount(leaves.value, leaves.currency);
  const into = arrives ? evaluateAmount(arrives.value, arrives.currency) : null;
  if (!arrives || out === null || into === null) return { leaves, arrives, bankRate: null, cost: null };
  const legs = { fromMinor: out, fromCurrency: leaves.currency, toMinor: into, toCurrency: arrives.currency };
  return { leaves, arrives, bankRate: impliedRate(legs), cost: exchangeCost({ ...legs, baseCurrency, ratesToBase }) };
}

export const bankRateText = (rate: number | null, from: string, to: string, locale = 'id-ID') =>
  rate === null ? '—' : `1 ${from} = ${rate.toLocaleString(locale, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} ${to}`;

/** The spread in words. The sign picks the words; the figure is the cost, negated once when it is a gain. */
export function spreadLine(cost: ExchangeCost | null, baseCurrency: string): { title: string; figure: string } | null {
  if (!cost) return null;
  if (cost.costMinor === 0) return { title: 'The bank’s rate matched the day’s rate', figure: formatMinor(0, baseCurrency) };
  if (cost.costMinor > 0) return { title: 'The bank’s rate cost you', figure: formatMinor(cost.costMinor, baseCurrency) };
  return { title: 'The bank’s rate gained you', figure: formatMinor(-cost.costMinor, baseCurrency) };
}

/** "1 pocket", "3 pockets". */
export const pocketCount = (n: number) => `${n} ${n === 1 ? 'pocket' : 'pockets'}`;

export const moveDescription = (parent: AccountRow, from: AccountRow, to: AccountRow) => `${parent.name}: ${from.currency} → ${to.currency}`;

export const currencyName = (code: string) => currencyInfo(code).name;

const MONEY_KINDS = new Set<string>(CASH_ITEMS.map((item) => item.id));

/**
 * The kinds of money that can be spent straight out of the account — what the ledger calls spendable, and the same
 * set the picker behind "Paid with" offers. A time deposit is deliberately not one: it holds money it cannot be
 * paid from, and the money leaves by a transfer when it matures. Nor is a broker's cash: an RDN cannot be spent
 * from, so a transaction paid with it would be a transaction the bank would refuse.
 */
export const SPENDABLE_KINDS = new Set<string>(SPENDABLE_SUBTYPES);

/** One side of the arithmetic below: a figure in the base currency, or the rate it is missing. */
interface BaseTotal {
  totalMinor: number | null;
  missing: readonly string[];
}

/** What is left to spend, and the three parts it is read from, so a screen can show its own arithmetic. */
export interface FreeToSpend {
  /** Money that can be moved, before anything is promised or due. */
  spendableMinor: number | null;
  /** What goals have claimed of it. */
  setAsideMinor: number | null;
  /** What the debts ask before the month is out: a card's billed bill, a loan's next instalment. */
  dueMinor: number | null;
  /** Spendable, less what is set aside, less what is due — null when a rate is missing, never a partial sum. */
  freeMinor: number | null;
  /** The currencies no rate could be found for, named once. */
  missing: string[];
}

/**
 * What is left to spend: the money that can be moved, less what is promised to goals, less what each debt asks for
 * before the month is out.
 *
 * Two things are deliberately not in it: money that cannot be moved — a deposit until it matures — and the long part
 * of a debt, which is a balance-sheet fact rather than a claim on this month. What `due` holds is what the debts ask
 * of you: each loan's instalment, each card's whole balance (billed or not, because that money is already spent), and
 * what you owe people.
 *
 * One rate short and there is no figure: the missing currency is named instead, as every other total in the app
 * does. Adding up the rest and calling it free to spend would be the one answer that is certainly wrong.
 */
export function freeToSpend(spendable: BaseTotal, setAside: BaseTotal, due: BaseTotal): FreeToSpend {
  const missing = [...new Set([...spendable.missing, ...setAside.missing, ...due.missing])].sort();
  const left = (a: number | null, b: number | null) => (a === null || b === null ? null : a - b);
  return {
    spendableMinor: spendable.totalMinor,
    setAsideMinor: setAside.totalMinor,
    dueMinor: due.totalMinor,
    freeMinor: missing.length > 0 ? null : left(left(spendable.totalMinor, setAside.totalMinor), due.totalMinor),
    missing,
  };
}

/** What one account holds for spending, once the goals that claimed part of it have had their share. */
export interface AccountFree {
  /** Balance less what is promised of it. Null when a rate is missing — never a partial subtraction. */
  freeMinor: number | null;
  /** What it holds: the figure its row drew before. */
  balanceMinor: number | null;
  /** What goals have claimed of this account, and of the pockets under it. */
  setAsideMinor: number | null;
  /** The currency both figures are in: the account's own, or the base for a pocket parent. */
  currency: string;
}

/**
 * Free to spend on one account: what it holds, less what goals have claimed of it.
 *
 * A plain account is read in its own currency and needs no rate at all — its balance and its promises are already in
 * the same money. A pocket parent adds its pockets up, as its row already does, so it reads in the base currency and
 * needs one for every currency under it; a rate missing gives a null free figure rather than a partial one, and the
 * row goes on drawing the ≈ total it drew before.
 */
export function freeOn(
  account: AccountRow,
  pockets: readonly AccountRow[],
  balances: Readonly<Record<string, number>>,
  setAside: Readonly<Record<string, { setAsideMinor: number }>>,
  baseCurrency: string,
  ratesToBase: Rates,
): AccountFree {
  const promised = (id: string) => setAside[id]?.setAsideMinor ?? 0;
  if (pockets.length === 0) {
    const balanceMinor = balances[account.id] ?? 0;
    const setAsideMinor = promised(account.id);
    return { freeMinor: balanceMinor - setAsideMinor, balanceMinor, setAsideMinor, currency: account.currency ?? baseCurrency };
  }
  const holds = sumToBase({ amounts: pockets.map((pocket) => ({ minor: balances[pocket.id] ?? 0, currency: pocket.currency ?? baseCurrency })), baseCurrency, ratesToBase });
  const claimed = sumToBase({ amounts: [account, ...pockets].map((row) => ({ minor: promised(row.id), currency: row.currency ?? baseCurrency })), baseCurrency, ratesToBase });
  return {
    freeMinor: holds.totalMinor === null || claimed.totalMinor === null ? null : holds.totalMinor - claimed.totalMinor,
    balanceMinor: holds.totalMinor,
    setAsideMinor: claimed.totalMinor,
    currency: baseCurrency,
  };
}

/**
 * The Money tile: every money account and every pocket in the base currency, or no figure with the missing rate
 * named. An account with pockets is one account; its pockets are the amounts. Holdings and debts are not money here.
 *
 * `kinds` lets a caller ask the same question over a narrower set of money: the Accounts page reads its *spending*
 * money with `SPENDABLE_KINDS`, which leaves out the deposits it cannot spend from.
 */
export function moneySummary(accounts: readonly AccountRow[], balances: Readonly<Record<string, number>>, baseCurrency: string, ratesToBase: Rates, kinds: ReadonlySet<string> = MONEY_KINDS) {
  const parents = pocketParentIds(accounts);
  const tops = accounts.filter((a) => a.kind === 'asset' && a.archivedAt === null && a.parentId === null && kinds.has(a.subtype));
  const held = tops.flatMap((a) => (parents.has(a.id) ? pocketsOf(a.id, accounts) : [a]));
  const amounts = held.map((a) => ({ minor: balances[a.id] ?? 0, currency: a.currency! }));
  /* Whether any of it came from another currency: money held only in the base currency adds up exactly, and the
   * screen above should not question a figure that no rate touched. */
  const converted = amounts.some((amount) => amount.currency !== baseCurrency);
  return { ...sumToBase({ amounts, baseCurrency, ratesToBase }), accounts: tops.length, currencies: new Set(amounts.map((a) => a.currency)).size, converted };
}
