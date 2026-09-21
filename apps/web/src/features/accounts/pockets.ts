import { CURRENCIES, currencyInfo, evaluateAmount, exchangeCost, type ExchangeCost, formatMinor, impliedRate, isoDate, parseMajor, sumToBase } from '@expanses/core';
import type { AccountRow } from '@expanses/db';
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
 * Otherwise the row takes the currency and keeps its text, re-read in the new currency when saved (spec §5).
 */
export function choosePocketCurrency(rows: readonly PocketDraft[], index: number, currency: string): PocketDraft[] {
  const other = rows.findIndex((row, j) => j !== index && row.currency === currency);
  if (other === -1) return rows.map((row, j) => (j === index ? { ...row, currency } : row));
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
 * A new From or To. Both figures were typed in the old pockets' currencies, so both are cleared; choosing the pocket
 * already on the other side swaps the two rather than moving money into itself.
 */
export function withPockets(draft: FormDraft, patch: { moneyId?: string; toId?: string }): FormDraft {
  let moneyId = patch.moneyId ?? draft.moneyId;
  let toId = patch.toId ?? draft.toId;
  if (moneyId === toId) {
    if (patch.moneyId !== undefined) toId = draft.moneyId;
    else moneyId = draft.toId;
  }
  return { ...draft, moneyId, toId, amount: '', toAmount: '' };
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

export const moveDescription = (parent: AccountRow, from: AccountRow, to: AccountRow) => `${parent.name}: ${from.currency} → ${to.currency}`;

export const currencyName = (code: string) => currencyInfo(code).name;
