import {
  CURRENCIES,
  currencyInfo,
  equalShares,
  evaluateAmount,
  exchangeLines,
  expenseLines,
  incomeLines,
  isoDate,
  minorToMajorString,
  parseMajor,
  type PostingLine,
  splitExpenseLines,
  transferLines,
  yourShare,
} from '@expanses/core';
import type { AccountRow, PostTransactionInput, RecordTradeInput, SplitBillInput, TaggedTransferInput, TransactionView } from '@expanses/db';
import { emptyPurchaseDraft, type PurchaseDraft, purchaseDraftToInput } from './buy-in-form';
import { classify } from './classify';
import { isEditable } from './draft';

export type FormMode = 'expense' | 'income' | 'transfer' | 'trade';

export interface SplitRow {
  categoryId: string;
  amount: string;
}

export interface WithRow {
  /** An account already open under Lend & borrow; '' when the person is being named for the first time. */
  debtAccountId: string;
  name: string;
  amount: string;
}

/**
 * Everything one transaction screen holds, whichever screen it is. Amounts are the user's typed strings.
 *
 * `with` is a reserved word in JavaScript but a legal property name and a legal destructuring target
 * (`const { with: withPeople } = draft`). It is called With because §2's field map calls the field With and
 * the row is labelled With — do not "fix" it to `withPeople`, which would silently break `extraRows` and
 * every screen that spreads a draft.
 */
export interface FormDraft {
  mode: FormMode;
  bookId: string; // the workspace row
  occurredOn: string;
  description: string; // the Note row
  moneyId: string;
  cardId: string;
  toId: string;
  categoryId: string;
  amount: string; // typed, in `currency`
  currency: string; // what the flag says
  chargedAmount: string; // "Charged in <account currency>", '' when the currencies match
  toAmount: string;
  splits: SplitRow[];
  mcc: string;
  rememberPattern: string;
  eventId: string;
  channel: '' | 'online' | 'offline';
  excluded: boolean;
  photoIds: string[];
  with: WithRow[];
  withEqually: boolean;
  goalId: string;
  manualRate: string;
  /** True while correcting a transaction rather than adding one: With is not offered on an edit (§15.6). */
  editing: boolean;
  purchase: PurchaseDraft; // buy-in-form.ts, unchanged
}

export function emptyForm(bookId: string, today: string = isoDate()): FormDraft {
  return {
    mode: 'expense',
    bookId,
    occurredOn: today,
    description: '',
    moneyId: '',
    cardId: '',
    toId: '',
    categoryId: '',
    amount: '',
    currency: '',
    chargedAmount: '',
    toAmount: '',
    splits: [],
    mcc: '',
    rememberPattern: '',
    eventId: '',
    channel: '',
    excluded: false,
    photoIds: [],
    with: [],
    withEqually: false,
    goalId: '',
    manualRate: '',
    editing: false,
    purchase: emptyPurchaseDraft('', '', today),
  };
}

const accountOf = (draft: FormDraft, accounts: readonly AccountRow[]) => accounts.find((a) => a.id === draft.moneyId);

/** The currency the flag shows: what was typed, or — until something is typed — the paying account's own. */
export const typedCurrency = (draft: FormDraft, accounts: readonly AccountRow[]) => draft.currency || accountOf(draft, accounts)?.currency || '';

/**
 * Whether the "Charged in <account currency>" row applies: the figure was typed in one currency and the
 * account settles in another, so the posting cannot be read off the typed figure alone.
 */
export function chargedInNeeded(draft: FormDraft, accounts: readonly AccountRow[]): boolean {
  const account = accountOf(draft, accounts);
  if (!account?.currency || !draft.currency) return false;
  return draft.currency !== account.currency;
}

export type ExtraRow = 'event' | 'split' | 'with' | 'goal' | 'mcc' | 'channel' | 'photos' | 'exclude' | 'rate';

/**
 * The rows under "Add more details", in the order they are drawn.
 *
 * MCC is a card's fact, so it is offered only on a card. With is offered only while adding, because sharing a
 * bill posts through `splitBill`, which builds a differently shaped transaction than the one being corrected
 * (§15.6). A goal is the transfer's equivalent and is likewise add-only. The rate row is last and appears only
 * when `resolveRates` came back without one.
 */
export function extraRows(
  draft: FormDraft,
  accounts: readonly AccountRow[],
  { missingRate }: { missingRate: { from: string; to: string; onDate: string } | null },
): ExtraRow[] {
  const rows: ExtraRow[] = ['event'];
  if (draft.mode === 'expense') {
    rows.push('split');
    if (!draft.editing) rows.push('with');
    if (accountOf(draft, accounts)?.subtype === 'credit_card') rows.push('mcc');
  }
  if (draft.mode === 'transfer' && !draft.editing) rows.push('goal');
  // Online or offline is how money left for the outside world; it says nothing about money moved between your
  // own accounts, and a trade is recorded as units rather than as a purchase.
  if (draft.mode === 'expense' || draft.mode === 'income') rows.push('channel');
  rows.push('photos', 'exclude');
  if (missingRate) rows.push('rate');
  return rows;
}

function positive(value: string, currency: string, label: string): number {
  const minor = parseMajor(value, currency);
  if (minor <= 0) throw new Error(`${label} must be greater than zero`);
  return minor;
}

/**
 * The figure that posts, and the pair that records what was typed instead.
 *
 * The posting is always in the account's own currency: when the typed currency differs, the "Charged in …" row
 * is the posting and the typed figure becomes the original pair. That pair is no longer a card's privilege —
 * a bank account charged in CNY carries it too — but an amount typed in the account's own currency is not an
 * original currency and clears the pair, exactly as before.
 */
function amounts(
  draft: FormDraft,
  account: AccountRow,
  typed: string,
): { amountMinor: number; originalCurrency: string | null; originalAmountMinor: number | null } {
  const settled = account.currency!;
  if (!typed || typed === settled) {
    return { amountMinor: positive(draft.amount, settled, 'Amount'), originalCurrency: null, originalAmountMinor: null };
  }
  if (!draft.chargedAmount.trim()) throw new Error(`Enter the amount charged in ${settled}`);
  return {
    amountMinor: positive(draft.chargedAmount, settled, `Amount charged in ${settled}`),
    originalCurrency: typed,
    originalAmountMinor: positive(draft.amount, typed, 'Amount'),
  };
}

function typedMcc(draft: FormDraft): string | null {
  const mcc = draft.mcc.trim();
  if (!mcc) return null;
  // Checked whatever it was typed on, so a four-digit slip is caught where it was made rather than dropped
  // silently when the payment moves off a card.
  if (!/^\d{4}$/.test(mcc)) throw new Error('An MCC is four digits, like 5814');
  // A remembered merchant supplies the MCC, so the purchase itself stays untyped.
  return draft.rememberPattern.trim() ? null : mcc;
}

/** The merchant memory entry to save with a card expense, when the user chose to remember its MCC. */
export function formToMemory(draft: FormDraft, accounts: readonly AccountRow[]): { pattern: string; mcc: string } | null {
  if (draft.mode !== 'expense' || accountOf(draft, accounts)?.subtype !== 'credit_card') return null;
  const pattern = draft.rememberPattern.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!pattern) return null;
  const mcc = draft.mcc.trim();
  if (!mcc) throw new Error('Choose the MCC to remember for this merchant');
  if (!/^\d{4}$/.test(mcc)) throw new Error('An MCC is four digits, like 5814');
  return { pattern, mcc };
}

function expenseOrIncomeLines(draft: FormDraft, account: AccountRow, amountMinor: number): PostingLine[] {
  const currency = account.currency!;
  if (draft.mode === 'income') {
    if (!draft.categoryId) throw new Error('Choose a category');
    return incomeLines({ incomeAccountId: draft.categoryId, depositAccountId: account.id, amountMinor, currency });
  }
  if (draft.splits.length > 0) {
    const splits = draft.splits.map((row, i) => {
      if (!row.categoryId) throw new Error(`Choose a category for split ${i + 1}`);
      return { categoryAccountId: row.categoryId, amountMinor: positive(row.amount, currency, `Split ${i + 1} amount`) };
    });
    return splitExpenseLines({ paymentAccountId: account.id, currency, splits });
  }
  if (!draft.categoryId) throw new Error('Choose a category');
  return expenseLines({ categoryAccountId: draft.categoryId, paymentAccountId: account.id, amountMinor, currency });
}

/**
 * The To account of a transfer, checked. One function rather than a copy per branch: a message duplicated is a
 * message only one branch is ever tested for, and the goal branch was exactly that copy.
 */
function toAccountOf(draft: FormDraft, accounts: readonly AccountRow[], from: AccountRow): { id: string; currency: string } {
  const to = accounts.find((a) => a.id === draft.toId);
  if (!to?.currency) throw new Error('Choose the To account');
  if (to.id === from.id) throw new Error('From and To must differ');
  return { id: to.id, currency: to.currency };
}

function transferPostingLines(draft: FormDraft, account: AccountRow, accounts: readonly AccountRow[], amountMinor: number): PostingLine[] {
  const to = toAccountOf(draft, accounts, account);
  const currency = account.currency!;
  if (to.currency === currency) return transferLines({ fromAccountId: account.id, toAccountId: to.id, amountMinor, currency });
  const exchange = accounts.find((a) => a.systemKey === 'currency_exchange');
  if (!exchange) throw new Error('Currency exchange account missing');
  return exchangeLines({
    fromAccountId: account.id,
    fromAmountMinor: amountMinor,
    fromCurrency: currency,
    toAccountId: to.id,
    toAmountMinor: positive(draft.toAmount, to.currency, 'Received amount'),
    toCurrency: to.currency,
    exchangeAccountId: exchange.id,
  });
}

/** Everyone's share of a shared bill, and what is left as your own. */
function sharesOf(draft: FormDraft, currency: string, totalMinor: number): { ownShareMinor: number; shares: SplitBillInput['shares'] } {
  const people = draft.with.filter((row) => row.debtAccountId || row.name.trim());
  if (people.length === 0) throw new Error('Say who owes you');
  const person = (row: WithRow) =>
    row.debtAccountId ? { debtAccountId: row.debtAccountId } : { person: { name: row.name.trim(), currency } };
  if (draft.withEqually) {
    const { yours, each } = equalShares(totalMinor, people.length);
    return { ownShareMinor: yours, shares: people.map((row, i) => ({ ...person(row), amountMinor: each[i]! })) };
  }
  const amounts = people.map((row, i) => positive(row.amount, currency, `Share ${i + 1}`));
  return { ownShareMinor: yourShare(totalMinor, amounts), shares: people.map((row, i) => ({ ...person(row), amountMinor: amounts[i]! })) };
}

export type FormPost =
  | { kind: 'post'; input: PostTransactionInput }
  | { kind: 'split'; input: SplitBillInput }
  | { kind: 'transfer-goal'; input: TaggedTransferInput }
  | { kind: 'trade'; input: RecordTradeInput };

/**
 * Validates the draft and builds what the screen has to send, and to whom. Throws a user-readable Error on
 * invalid input, with the words the old form used.
 */
export function formToPost(draft: FormDraft, accounts: readonly AccountRow[]): FormPost {
  if (draft.mode === 'trade') {
    const currency = accounts.find((a) => a.id === draft.purchase.accountId)?.currency ?? draft.currency;
    return { kind: 'trade', input: purchaseDraftToInput(draft.purchase, currency, isoDate()) };
  }

  const account = accountOf(draft, accounts);
  if (!account?.currency) throw new Error(draft.mode === 'transfer' ? 'Choose the From account' : 'Choose an account');
  const typed = typedCurrency(draft, accounts);
  const onCard = draft.mode === 'expense' && account.subtype === 'credit_card';
  const mcc = typedMcc(draft);

  if (draft.mode === 'transfer') {
    const amountMinor = positive(draft.amount, account.currency, 'Amount');
    if (draft.goalId && !draft.editing) {
      const to = toAccountOf(draft, accounts, account);
      return {
        kind: 'transfer-goal',
        input: {
          occurredOn: draft.occurredOn,
          description: draft.description || 'Transfer',
          amountMinor,
          fromAccountId: account.id,
          toAccountId: to.id,
          goalId: draft.goalId,
        },
      };
    }
    return {
      kind: 'post',
      input: {
        occurredOn: draft.occurredOn,
        description: draft.description || 'Transfer',
        lines: transferPostingLines(draft, account, accounts, amountMinor),
        originalCurrency: null,
        originalAmountMinor: null,
        mcc: null,
        cardId: null,
        channel: null,
        excludedFromReport: draft.excluded,
        eventId: draft.eventId || null,
        photoIds: draft.photoIds,
      },
    };
  }

  const { amountMinor, originalCurrency, originalAmountMinor } = amounts(draft, account, typed);

  if (draft.mode === 'expense' && draft.with.length > 0 && !draft.editing) {
    if (!draft.categoryId) throw new Error('Choose a category');
    const { ownShareMinor, shares } = sharesOf(draft, account.currency, amountMinor);
    return {
      kind: 'split',
      input: {
        occurredOn: draft.occurredOn,
        description: draft.description || 'Split bill',
        totalMinor: amountMinor,
        moneyAccountId: account.id,
        ownCategoryId: draft.categoryId,
        ownShareMinor,
        shares,
        spendCategoryId: onCard ? draft.categoryId : null,
        mcc: onCard ? mcc : null,
        channel: draft.channel || null,
        excludedFromReport: draft.excluded,
        eventId: draft.eventId || null,
      },
    };
  }

  return {
    kind: 'post',
    input: {
      occurredOn: draft.occurredOn,
      description: draft.description,
      lines: expenseOrIncomeLines(draft, account, amountMinor),
      // An original pair, an MCC and a card only belong to a purchase; income clears all three, so editing an
      // expense into income cannot leave a card's facts behind on it.
      originalCurrency: draft.mode === 'expense' ? originalCurrency : null,
      originalAmountMinor: draft.mode === 'expense' ? originalAmountMinor : null,
      mcc: onCard ? mcc : null,
      cardId: onCard ? draft.cardId.trim() || null : null,
      channel: draft.channel || null,
      excludedFromReport: draft.excluded,
      eventId: draft.eventId || null,
      photoIds: draft.photoIds,
    },
  };
}

/**
 * Whether the edit sheet can hold this transaction, or the full form has to open instead.
 *
 * The sheet carries one category, one account and one figure. A split has several categories, a transfer has
 * two money accounts and no category, and a foreign purchase carries a second figure the sheet has no row for.
 */
export function canEditInSheet(tx: TransactionView): boolean {
  if (!isEditable(tx)) return false;
  if (tx.originalCurrency && tx.originalAmountMinor !== null) return false;
  const c = classify(tx);
  if (c.type === 'transfer') return false;
  return c.categoryIds.length === 1;
}

/** A transaction reopened as a draft: the typed currency is what the merchant charged, when there was one. */
export function formFromTransaction(tx: TransactionView, accounts: readonly AccountRow[], bookId = ''): FormDraft {
  const c = classify(tx);
  const money = tx.entries.filter((e) => e.accountKind === 'asset' || e.accountKind === 'liability');
  const base: FormDraft = {
    ...emptyForm(bookId, tx.occurredOn),
    description: tx.description,
    mcc: tx.mcc ?? '',
    cardId: tx.cardId ?? '',
    eventId: tx.eventId ?? '',
    channel: tx.channel ?? '',
    excluded: tx.excluded ?? false,
    goalId: tx.goalId ?? '',
    editing: true,
  };
  const foreign = (payment: { accountId: string }, amountMinor: number) => {
    const settled = accounts.find((a) => a.id === payment.accountId)?.currency ?? '';
    if (!tx.originalCurrency || tx.originalAmountMinor === null) {
      return { currency: settled, amount: minorToMajorString(amountMinor, settled || 'IDR'), chargedAmount: '' };
    }
    return {
      currency: tx.originalCurrency,
      amount: minorToMajorString(tx.originalAmountMinor, tx.originalCurrency),
      chargedAmount: minorToMajorString(amountMinor, settled || 'IDR'),
    };
  };

  if (c.type === 'expense' || c.type === 'income') {
    const payment = money[0]!;
    const category = tx.entries.filter((e) => e.accountKind === c.type);
    if (c.type === 'expense' && category.length > 1) {
      return {
        ...base,
        moneyId: payment.accountId,
        currency: accounts.find((a) => a.id === payment.accountId)?.currency ?? '',
        splits: category.map((e) => ({ categoryId: e.accountId, amount: minorToMajorString(e.amountMinor, e.currency) })),
      };
    }
    const only = category[0]!;
    const total = c.type === 'expense' ? only.amountMinor : -only.amountMinor;
    return { ...base, mode: c.type, moneyId: payment.accountId, categoryId: only.accountId, ...foreign(payment, total) };
  }

  const from = money.find((e) => e.amountMinor < 0);
  const to = money.find((e) => e.amountMinor > 0);
  return {
    ...base,
    mode: 'transfer',
    moneyId: from?.accountId ?? '',
    toId: to?.accountId ?? '',
    currency: from ? (accounts.find((a) => a.id === from.accountId)?.currency ?? '') : '',
    amount: from ? minorToMajorString(-from.amountMinor, from.currency) : '',
    toAmount: to && from && to.currency !== from.currency ? minorToMajorString(to.amountMinor, to.currency) : '',
  };
}

/**
 * The desktop amount field's Enter: work the expression out, and hold the save back until it stops changing.
 *
 * `evaluateAmount` is the one reader of a typed figure, on a desktop exactly as on a phone — the keyboard is
 * not a second, weaker route into the same field. An expression that cannot be read leaves what was typed
 * alone rather than clearing it, the same bargain DONE makes on the phone, and lets the form submit so a
 * plainly typed figure is never trapped behind an Enter that does nothing.
 */
export function amountAfterEnter(value: string, currency: string): { text: string; submit: boolean } {
  const minor = evaluateAmount(value, currency);
  if (minor === null) return { text: value, submit: true };
  const text = minorToMajorString(minor, currency);
  return { text, submit: text === value };
}

/** The dock's keys, read left to right, top to bottom. DONE spans two rows; there is deliberately no Save. */
export const KEYPAD_KEYS = ['C', '÷', '×', '⌫', '7', '8', '9', '−', '4', '5', '6', '+', '1', '2', '3', 'DONE', '0', '000', '00'] as const;

export type KeypadKey = (typeof KEYPAD_KEYS)[number];

/**
 * What one key does to the typed text. DONE is not here: it is `evaluateAmount`, and the row keeps what it had
 * when that comes back null.
 */
export function keypadPress(value: string, key: Exclude<KeypadKey, 'DONE'>): string {
  if (key === 'C') return '';
  if (key === '⌫') return value.slice(0, -1);
  return value + key;
}

/**
 * Units of `to` per 1 major unit of `from`, from a `resolveRates` result — which holds rates against the base
 * currency only, so a pair that does not involve the base is crossed through it.
 *
 * Null when either leg is unknown: an estimate built on a rate nobody has is worse than no estimate at all.
 */
export function suggestedRate({ rates, from, to, base }: { rates: Record<string, number>; from: string; to: string; base: string }): number | null {
  if (!from || !to) return null;
  if (from === to) return 1;
  const leg = (code: string) => (code === base ? 1 : (rates[code] ?? null));
  const a = leg(from);
  const b = leg(to);
  if (a === null || b === null || !(b > 0)) return null;
  return a / b;
}

/**
 * The quiet line under "Charged in …": what a rate for the day suggests, and whose figure overrules it.
 *
 * Numbers are rendered the way `ratePreview` (lib/rates.ts) already renders a rate, so the app shows one
 * number style rather than two.
 */
export function chargedHint({
  rate,
  currency,
  accountCurrency,
  onDate,
  accountName,
}: {
  rate: number | null;
  currency: string;
  accountCurrency: string;
  onDate: string;
  accountName: string;
}): string {
  if (rate === null) return `No ${currency}→${accountCurrency} rate is known for ${onDate}. Enter what ${accountName} charged.`;
  return `≈ ${rate.toLocaleString('id-ID', { maximumFractionDigits: 4 })} per 1 ${currency} · suggested from ${onDate}, change it to what ${accountName} charged`;
}

/** Where the currency sheet keeps the last few codes chosen by hand. */
export const RECENT_CURRENCY_KEY = 'expanses.currency.recent';

/**
 * The Recent block: the paying account's currency, the workspace's, then up to three chosen lately. Codes no
 * longer in `CURRENCIES` are dropped rather than offered as a row that cannot be picked.
 */
export function recentCurrencies({
  accountCurrency,
  baseCurrency,
  stored,
}: {
  accountCurrency: string;
  baseCurrency: string;
  stored: readonly string[];
}): string[] {
  const known = (code: string) => !!code && CURRENCIES.some((c) => c.code === code);
  const head = [accountCurrency, baseCurrency].filter(known);
  const rest = stored.filter((code) => known(code) && !head.includes(code)).slice(0, 3);
  return [...new Set([...head, ...rest])];
}

/** Reads the recent list a browser kept, tolerating a blocked or corrupt store. */
export function readRecentCurrencies(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_CURRENCY_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((code): code is string => typeof code === 'string') : [];
  } catch {
    return [];
  }
}

/** Remembers a code chosen by hand, most recent first, five at most. */
export function rememberCurrency(code: string): void {
  try {
    const next = [code, ...readRecentCurrencies().filter((c) => c !== code)].slice(0, 5);
    localStorage.setItem(RECENT_CURRENCY_KEY, JSON.stringify(next));
  } catch {
    // A browser that refuses storage still gets a working sheet; it just does not remember.
  }
}

/** The flag on the amount row. An unknown code shows a globe rather than throwing the screen away. */
export function currencyFlag(code: string): string {
  try {
    return currencyInfo(code).flag;
  } catch {
    return '🌐';
  }
}
