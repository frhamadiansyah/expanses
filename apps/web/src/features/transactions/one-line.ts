import { convertMinor, matchCategory, minorToMajorString, type CategoryOption, type ExpenseLineReading, type PaymentOption } from '@expanses/core';
import { pastMarkDefault, type PastMark } from '@expanses/db';
import type { ListRow } from './list-model';
import { paymentKey, shortDate } from './quick-row';
import { emptyForm, estimatedChargeMinor, suggestedRate, type FormDraft } from './tx-form';

/**
 * One line's screen model: a typed line, as `readExpenseLine` read it, turned into the row it will be saved as.
 *
 * What the line does not say is filled in from the sitting (the day and the paid-with kept from the last save) and
 * then the Add form's Default Paid with; a part filled in that way, or guessed from a word, reads as unsure until it
 * is picked. The save is the Add form's own: `lineDraft` is a `FormDraft`, posted through `formToPost`.
 */

export type LinePart = 'category' | 'paid' | 'day' | 'amount';

/** Parts picked from the preview: they read as sure. Cleared after each save, and as the line changes (`choicesAfterTyping`). */
export interface LineChoices {
  categoryId?: string;
  paid?: PaymentOption;
  occurredOn?: string;
  amountMinor?: number;
}

export interface CategoryGuess {
  id: string;
  from: 'history' | 'word';
}

export interface LineContext {
  today: string;
  /** The day kept from the last save in this sitting; `today` at the start. */
  sittingDay: string;
  /** The last paid-with saved in this sitting. */
  lastPaid: PaymentOption | null;
  /** The Add form's Default Paid with, resolved. */
  defaultPaid: PaymentOption | null;
  options: readonly PaymentOption[];
  category: CategoryGuess | null;
}

export interface LinePreview {
  description: string;
  occurredOn: string;
  amountMinor: number | null;
  currency: string;
  paid: PaymentOption | null;
  categoryId: string | null;
  unsure: ReadonlySet<LinePart>;
  /** What keeps Save dimmed: 'amount' while none is read, 'paid' while nothing pays. */
  missing: readonly ('amount' | 'paid')[];
}

/**
 * The option a paid-with read from the line stands for. The reader names an account, and its card when it could tell
 * which: an account whose cards it could not tell apart is still the account, offered with no card rather than a guess.
 */
function optionFor(payment: { accountId: string; cardId: string | null }, options: readonly PaymentOption[]): PaymentOption | null {
  const key = paymentKey(payment.accountId, payment.cardId);
  const exact = options.find((o) => paymentKey(o.accountId, o.cardId) === key);
  if (exact) return exact;
  const same = options.filter((o) => o.accountId === payment.accountId);
  if (same.length === 1) return same[0]!;
  if (same.length === 0) return null;
  return { accountId: payment.accountId, cardId: null, accountName: same[0]!.accountName, last4: null, holderName: null };
}

/** A day read from the line further than this from today reads unsure. */
const FAR_DAYS = 31;

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!) / 86_400_000;
};
const daysBetween = (a: string, b: string): number => dayNumber(a) - dayNumber(b);

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const samePayment = (a: ExpenseLineReading['payment'], b: ExpenseLineReading['payment']) =>
  a === b || (!!a && !!b && a.accountId === b.accountId && a.cardId === b.cardId);

/**
 * What is still picked once the line is typed over: nothing once the field is emptied, and a pick only while the
 * part of the reading it stands over is unchanged — so a picked 25.000 does not outlive "kopi 20rb" being retyped as
 * "kopi 30rb", nor a picked category a different shop.
 */
export function choicesAfterTyping(choices: LineChoices, was: ExpenseLineReading, now: ExpenseLineReading, text: string): LineChoices {
  if (!text.trim()) return {};
  const kept: LineChoices = { ...choices };
  if (was.amountMinor !== now.amountMinor || was.currency !== now.currency) delete kept.amountMinor;
  if (!sameText(was.description, now.description)) delete kept.categoryId;
  if (!samePayment(was.payment, now.payment)) delete kept.paid;
  if (was.occurredOn !== now.occurredOn) delete kept.occurredOn;
  return kept;
}

/** The words a save stops with when a rate it needs is missing; the line stays in the field. */
export const missingRateMessage = (from: string, to: string, day: string): string => `No ${from}→${to} rate for ${day}. Record it from the Add screen.`;

export function previewOf(reading: ExpenseLineReading, context: LineContext, choices: LineChoices): LinePreview {
  const unsure = new Set<LinePart>();

  const occurredOn = choices.occurredOn ?? reading.occurredOn ?? context.sittingDay;

  const picked = choices.amountMinor ?? null;
  const read = picked ?? reading.amountMinor;
  const amountMinor = read !== null && read > 0 ? read : null;
  // Read two ways, or tiny (Paste a list's small rule: a dropped zero or a quantity), until picked.
  if ((reading.ambiguous || reading.small) && picked === null && amountMinor !== null) unsure.add('amount');
  // A day read from the line far from today is more likely a quantity ("1/2 kg") than a date, until picked.
  if (choices.occurredOn === undefined && reading.occurredOn !== null && Math.abs(daysBetween(reading.occurredOn, context.today)) > FAR_DAYS) unsure.add('day');

  let paid: PaymentOption | null = choices.paid ?? (reading.payment ? optionFor(reading.payment, context.options) : null);
  if (!paid) {
    paid = context.lastPaid ?? context.defaultPaid;
    if (paid) unsure.add('paid');
  }

  const categoryId = choices.categoryId ?? context.category?.id ?? null;
  if (choices.categoryId === undefined && context.category?.from === 'word') unsure.add('category');

  const missing: ('amount' | 'paid')[] = [];
  if (amountMinor === null) missing.push('amount');
  if (!paid) missing.push('paid');

  return { description: reading.description, occurredOn, amountMinor, currency: reading.currency, paid, categoryId, unsure, missing };
}

/**
 * The mark a saved line starts with, by the Add form's date rule: dated before the day its payer is counted from, a
 * money account's is a past purchase and a credit card's paid off (`pastMarkDefault`). A line has no switch of its own,
 * so this is what it posts with; the receipt or the statement changes it after.
 */
export function lineMark(payer: { kind: string; subtype: string } | undefined, openedOn: string | null, day: string): PastMark {
  return pastMarkDefault(payer, openedOn, day);
}

export const canSaveLine = (preview: LinePreview): boolean => preview.missing.length === 0;

/** History first; else the first description word (≥ 3 letters) that matchCategory files under exactly one category. */
export function categoryGuess(historyId: string | null, description: string, options: readonly CategoryOption[]): CategoryGuess | null {
  if (historyId) return { id: historyId, from: 'history' };
  for (const word of description.split(/[^\p{L}]+/u)) {
    if (word.length < 3) continue;
    const id = matchCategory(word, options);
    if (id) return { id, from: 'word' };
  }
  return null;
}

/** Each option without digits takes its account's own (bank number or wallet phone) when known. */
export function withAccountDigits(options: readonly PaymentOption[], digits: Readonly<Record<string, string>>): PaymentOption[] {
  return options.map((o) => (o.last4 || !digits[o.accountId] ? o : { ...o, last4: digits[o.accountId]! }));
}

/** The day before an ISO day, by the calendar alone. */
function dayBefore(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
}

/** "Today", "Yesterday", else shortDate. */
export function previewDay(iso: string, today: string): string {
  if (iso === today) return 'Today';
  if (iso === dayBefore(today)) return 'Yesterday';
  return shortDate(iso, today);
}

/**
 * The charge in the payer's currency for a foreign amount, at the day's rates; null when no rate reaches it. `rates`
 * is `resolveRates`' result (units of `base` per one of each code), crossed through `base` when neither side is it.
 * Never a figure at a made-up rate: with no rate, the screen stops the save and says which pair is missing.
 */
export function foreignCharge({
  amountMinor,
  currency,
  payerCurrency,
  base,
  rates,
}: {
  amountMinor: number;
  currency: string;
  payerCurrency: string;
  base: string;
  rates: Record<string, number>;
}): { text: string; minor: number } | null {
  if (currency === payerCurrency) return { minor: amountMinor, text: minorToMajorString(amountMinor, payerCurrency) };
  const rate = suggestedRate({ rates, from: currency, to: payerCurrency, base });
  const minor = estimatedChargeMinor({ minor: amountMinor, currency, accountCurrency: payerCurrency, rate });
  return minor === null ? null : { minor, text: minorToMajorString(minor, payerCurrency) };
}

/** The Add form's draft for this preview: Expense, one category ('' = Choose later), the typed currency and its charge. */
export function lineDraft(preview: LinePreview, bookId: string, chargedText: string): FormDraft {
  return {
    ...emptyForm(bookId, preview.occurredOn),
    mode: 'expense',
    description: preview.description,
    amount: preview.amountMinor === null ? '' : minorToMajorString(preview.amountMinor, preview.currency),
    currency: preview.currency,
    chargedAmount: chargedText,
    moneyId: preview.paid?.accountId ?? '',
    cardId: preview.paid?.cardId ?? '',
    categoryId: preview.categoryId ?? '',
  };
}

/** What the Cashflow list would count: the settled figure in the workspace's currency. */
export function baseOf(settledMinor: number, payerCurrency: string, base: string, ratesToBase: Record<string, number>): number {
  if (payerCurrency === base) return settledMinor;
  const rate = ratesToBase[payerCurrency];
  // `ratesForSave` refuses a save without the rate, so this is only reached by a caller that skipped it.
  return rate !== undefined && rate > 0 ? convertMinor(settledMinor, payerCurrency, base, rate) : 0;
}

/** A list row standing for the preview (or a saved line), for TransactionRow. */
export function previewRow(preview: LinePreview, id: string, categoryName: string | null): ListRow {
  const paid = preview.paid;
  return {
    kind: 'tx',
    id,
    date: preview.occurredOn,
    description: preview.description,
    amountMinor: preview.amountMinor ?? 0,
    currency: preview.currency,
    baseMinor: 0,
    spentMinor: 0,
    earnedMinor: 0,
    type: 'expense',
    categoryId: preview.categoryId,
    categoryName: preview.categoryId ? categoryName : null,
    parentName: null,
    accountIds: paid ? [paid.accountId] : [],
    accountLabel: paid?.accountName ?? '',
    cardId: paid?.cardId ?? null,
    last4: paid?.last4 ?? null,
    holderName: paid?.holderName ?? null,
    deleted: false,
    excluded: false,
    needs: [],
    needsCategory: !preview.categoryId,
  };
}

/** What the sitting keeps after a save: the day and the paid-with. */
export function afterSave(context: LineContext, saved: LinePreview): Pick<LineContext, 'sittingDay' | 'lastPaid'> {
  return { sittingDay: saved.occurredOn, lastPaid: saved.paid ?? context.lastPaid };
}
