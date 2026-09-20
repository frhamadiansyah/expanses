import {
  convertMinor,
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

/** One money field of the amount row: what it is called, what is in it, and the currency it is read in. */
export interface MoneyFieldSpec {
  which: 'amount' | 'charged';
  label: string;
  value: string;
  /** Never empty: the workspace's own currency stands in until an account is chosen. */
  currency: string;
}

/**
 * The amount row's money fields, each carrying the currency it is read in.
 *
 * **Which currency a figure is read in is decided here, once.** The desktop input, the phone's button and the
 * keypad all take the same record, so no two readers of one field can disagree about its scale — and a keypad
 * handed the account's currency while the field above it shows the typed one is a 100x error on a path no test
 * walks. That is the same fault as a second copy of the arithmetic, one layer over: `settledAmount` made the
 * *reading* single, and this makes the *units* single.
 *
 * The typed figure is in whatever the flag says; the "Charged in …" figure is always in the account's own
 * currency, because that is the one that posts. The charged field is absent unless the two differ.
 */
export function amountFields(draft: FormDraft, accounts: readonly AccountRow[], baseCurrency: string): { amount: MoneyFieldSpec; charged: MoneyFieldSpec | null } {
  const settled = accountOf(draft, accounts)?.currency ?? '';
  const amount: MoneyFieldSpec = { which: 'amount', label: 'Amount', value: draft.amount, currency: typedCurrency(draft, accounts) || baseCurrency };
  if (!chargedInNeeded(draft, accounts)) return { amount, charged: null };
  return {
    amount,
    charged: { which: 'charged', label: `Charged in ${settled}`, value: draft.chargedAmount, currency: settled || baseCurrency },
  };
}

export type ExtraRow = 'event' | 'split' | 'with' | 'mcc' | 'channel' | 'photos' | 'exclude' | 'rate';

/**
 * The rows under "Add more details", in the order they are drawn — §4's table, and only what is in it.
 *
 * Event belongs to money that left for the outside world, so §4 scopes it to Expense and Income, as it does
 * Channel. MCC is a card's fact, so it is offered only on a card. With is offered only while adding, because
 * sharing a bill posts through `splitBill`, which builds a differently shaped transaction than the one being
 * corrected (§15.6). A goal is deliberately **not** here: §3.5 and §3.6 put For goal on the second card of a
 * transfer and of a buy or sell, where it belongs to the mode rather than to the extras. The rate row is last
 * and appears only when `resolveRates` came back without one.
 */
export function extraRows(
  draft: FormDraft,
  accounts: readonly AccountRow[],
  { missingRate }: { missingRate: { from: string; to: string; onDate: string } | null },
): ExtraRow[] {
  const outward = draft.mode === 'expense' || draft.mode === 'income';
  const rows: ExtraRow[] = outward ? ['event'] : [];
  if (draft.mode === 'expense') {
    rows.push('split');
    if (!draft.editing) rows.push('with');
    if (accountOf(draft, accounts)?.subtype === 'credit_card') rows.push('mcc');
  }
  // Online or offline is how money left for the outside world; it says nothing about money moved between your
  // own accounts, and a trade is recorded as units rather than as a purchase.
  if (outward) rows.push('channel');
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
 * A split by category, read once. The lines are built from these rows and the total is their sum, so the split
 * is parsed in one place rather than once for the lines and once for the figure that posts.
 *
 * The rows are read in `currency` — the account's own, because that is what posts. A split has no second row
 * to carry what the merchant charged, so §3.3's original pair has nowhere to live and a figure typed in
 * another currency is refused in words here, before `parseMajor` answers a USD figure on an IDR account with
 * "IDR allows 0 decimal places": a core error about exponents, where what the user chose was a currency.
 */
function splitRowsOf(draft: FormDraft, currency: string, typed: string): { categoryAccountId: string; amountMinor: number }[] {
  if (typed && typed !== currency) {
    throw new Error(`A split is entered in ${currency}. Change the currency back to ${currency}, or remove the split.`);
  }
  return draft.splits.map((row, i) => {
    if (!row.categoryId) throw new Error(`Choose a category for split ${i + 1}`);
    return { categoryAccountId: row.categoryId, amountMinor: positive(row.amount, currency, `Split ${i + 1} amount`) };
  });
}

/** Whether this draft spends one figure across several categories, which is where the total comes from instead. */
const splitByCategory = (draft: FormDraft) => draft.mode === 'expense' && draft.splits.length > 0;

/**
 * What the rows of a split add up to, in the account's own currency.
 *
 * `evaluateAmount` is the kit's one reader of a typed figure — the same one the amount row, the keypad and
 * `formToPost` go through — so the running total cannot drift into an arithmetic of its own. A row that cannot be
 * read yet counts as nothing rather than throwing the total away, because a half-typed figure is the normal state
 * of a row being typed into.
 *
 * It is a display total only. What posts is `formToPost`'s own sum of the same rows, which refuses a row it cannot
 * read instead of skipping it. It lives here rather than in `SplitSheet.tsx` because `billMinor` needs the same
 * sum, and a second copy of it in this file is a second place for a split's total to drift.
 */
export function splitTotalMinor(splits: readonly SplitRow[], currency: string): number {
  return splits.reduce((sum, row) => sum + (row.amount.trim() ? (evaluateAmount(row.amount, currency) ?? 0) : 0), 0);
}

/**
 * The figure a shared bill is divided from, read in the paying account's own currency — null when there is
 * nothing readable to divide yet.
 *
 * It asks the same question `amounts` asks at Save, off the same fields: a split by category is the sum of its
 * rows, a figure typed in another currency is what the account was charged, and anything else is the amount row.
 * `WithSheet`'s summary card is read *while* those fields are being typed, so an unreadable figure is null here
 * instead of an error; Save still refuses it, through `amounts`, which is the one that posts.
 */
export function billMinor(draft: FormDraft, accounts: readonly AccountRow[]): number | null {
  const settled = accountOf(draft, accounts)?.currency;
  if (!settled) return null;
  if (splitByCategory(draft)) return splitTotalMinor(draft.splits, settled);
  const typed = typedCurrency(draft, accounts);
  return evaluateAmount(!typed || typed === settled ? draft.amount : draft.chargedAmount, settled);
}

/**
 * The figure that posts, and the pair that records what was typed instead.
 *
 * The posting is always in the account's own currency: when the typed currency differs, the "Charged in …" row
 * is the posting and the typed figure becomes the original pair. That pair is no longer a card's privilege —
 * a bank account charged in CNY carries it too — but an amount typed in the account's own currency is not an
 * original currency and clears the pair, exactly as before.
 *
 * A split by category has no single typed figure: its rows are already in the account's own currency and the
 * total is their sum, so the amount row is never required — that is what `draftToLines` did by reaching the
 * split branch before it asked for an amount. A figure typed anyway must agree with the rows rather than be
 * dropped in silence.
 */
function amounts(
  draft: FormDraft,
  account: AccountRow,
  typed: string,
  splitTotalMinor: number | null,
): { amountMinor: number; originalCurrency: string | null; originalAmountMinor: number | null } {
  const settled = account.currency!;
  if (splitTotalMinor !== null) {
    // `splitRowsOf` has already refused a split typed in another currency, so the figure here is in `settled`.
    // The kit's one reader, not a second weaker one. `parseMajor` cannot read `250000+150000`, which the amount
    // row is built to accept, so a sum that agrees perfectly well was refused with a raw `MoneyError`.
    if (draft.amount.trim() && evaluateAmount(draft.amount, settled) !== splitTotalMinor) {
      throw new Error('The splits must add up to the amount');
    }
    return { amountMinor: splitTotalMinor, originalCurrency: null, originalAmountMinor: null };
  }
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

function expenseOrIncomeLines(
  draft: FormDraft,
  account: AccountRow,
  amountMinor: number,
  splits: { categoryAccountId: string; amountMinor: number }[] | null,
): PostingLine[] {
  const currency = account.currency!;
  if (draft.mode === 'income') {
    if (!draft.categoryId) throw new Error('Choose a category');
    return incomeLines({ incomeAccountId: draft.categoryId, depositAccountId: account.id, amountMinor, currency });
  }
  if (splits) return splitExpenseLines({ paymentAccountId: account.id, currency, splits });
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

/** One shared bill worked out: who is on it, what each of them owes, and what is left as your own. */
export interface WithShares {
  /** The rows that name somebody — a blank row being typed into is not yet a person on the bill. */
  people: WithRow[];
  /** What each of `people` owes, in the same order. */
  each: number[];
  /** What is left as your own spending. Null only when their shares already come to more than the bill. */
  ownShareMinor: number | null;
}

/**
 * Everyone's share of a shared bill and what is left as your own — worked out once, for both readers.
 *
 * `WithSheet`'s summary card and `formToPost` have to agree to the rupiah: the card is what the user reads
 * before pressing Save, and a card totalling a bill one way while the save divides it another is a promise the
 * app then breaks. So there is one function, and `lenient` is the *only* difference between the two callers —
 * the sheet reads figures that are half typed and shows them as nothing, while the save refuses a figure it
 * cannot read rather than quietly posting a share of zero.
 *
 * The division itself is `equalShares` and `yourShare` from the core kit, never re-derived here: the remainder
 * rule (floored shares, the odd units left with you, the shares adding back to the bill exactly) is theirs.
 */
export function withShares(draft: FormDraft, currency: string, totalMinor: number, options: { lenient: false }): WithShares & { ownShareMinor: number };
export function withShares(draft: FormDraft, currency: string, totalMinor: number, options: { lenient: boolean }): WithShares;
export function withShares(draft: FormDraft, currency: string, totalMinor: number, { lenient }: { lenient: boolean }): WithShares {
  const people = draft.with.filter((row) => row.debtAccountId || row.name.trim());
  if (people.length === 0) {
    if (!lenient) throw new Error('Say who owes you');
    // Nobody named yet: the whole bill is still yours, which is what the card should say while it fills up.
    return { people, each: [], ownShareMinor: totalMinor };
  }
  if (draft.withEqually) {
    const { yours, each } = equalShares(totalMinor, people.length);
    return { people, each, ownShareMinor: yours };
  }
  const each = people.map((row, i) =>
    lenient ? (row.amount.trim() ? (evaluateAmount(row.amount, currency) ?? 0) : 0) : positive(row.amount, currency, `Share ${i + 1}`),
  );
  if (!lenient) return { people, each, ownShareMinor: yourShare(totalMinor, each) };
  try {
    return { people, each, ownShareMinor: yourShare(totalMinor, each) };
  } catch {
    // Typed past the bill. The card says so in words rather than showing a share below zero, and Save still
    // refuses it — through the very same `yourShare`, on the strict path above.
    return { people, each, ownShareMinor: null };
  }
}

/** Everyone's share of a shared bill, and what is left as your own, in the shape `splitBill` takes. */
function sharesOf(draft: FormDraft, currency: string, totalMinor: number): { ownShareMinor: number; shares: SplitBillInput['shares'] } {
  const { people, each, ownShareMinor } = withShares(draft, currency, totalMinor, { lenient: false });
  const person = (row: WithRow) =>
    row.debtAccountId ? { debtAccountId: row.debtAccountId } : { person: { name: row.name.trim(), currency } };
  return { ownShareMinor, shares: people.map((row, i) => ({ ...person(row), amountMinor: each[i]! })) };
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
          // §4: Photos and Exclude from report appear "always". Tagging the transfer to a goal cannot be what
          // throws them away — the untagged branch below carries the same three facts.
          excludedFromReport: draft.excluded,
          eventId: draft.eventId || null,
          photoIds: draft.photoIds,
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

  // The split is read before the figure is asked for, because on a split the rows *are* the figure — the order
  // `draftToLines` had, and losing it is what made a split impossible to save.
  const splits = splitByCategory(draft) ? splitRowsOf(draft, account.currency, typed) : null;
  const splitTotalMinor = splits ? splits.reduce((sum, row) => sum + row.amountMinor, 0) : null;
  const { amountMinor, originalCurrency, originalAmountMinor } = amounts(draft, account, typed, splitTotalMinor);

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
        // §4: Photos appear "always". Adding Andi to the bill cannot be what loses the receipt.
        photoIds: draft.photoIds,
      },
    };
  }

  return {
    kind: 'post',
    input: {
      occurredOn: draft.occurredOn,
      description: draft.description,
      lines: expenseOrIncomeLines(draft, account, amountMinor, splits),
      // §3.3: the original pair is kept for any expense **or income** whose chosen currency differs from the
      // paying account's. An MCC and a card are still a purchase's alone, so income clears those two and
      // editing an expense into income cannot leave a card's facts behind on it.
      originalCurrency,
      originalAmountMinor,
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
 * What a typed expression settles to, written the way `parseMajor` will read it again — null when it cannot be
 * read at all.
 *
 * This is the **one** reader of a typed figure in the whole kit. The desktop field's blur and Enter and the
 * phone's DONE all come through here, so the keypad cannot drift into a second, weaker arithmetic of its own:
 * a copy of these two lines is exactly how a 100x error lives on a path no test walks.
 */
export function settledAmount(value: string, currency: string): string | null {
  const minor = evaluateAmount(value, currency);
  return minor === null ? null : minorToMajorString(minor, currency);
}

/**
 * The desktop amount field's Enter: work the expression out, and hold the save back until it stops changing.
 *
 * An expression that cannot be read leaves what was typed alone rather than clearing it, the same bargain DONE
 * makes on the phone, and lets the form submit so a plainly typed figure is never trapped behind an Enter that
 * does nothing.
 */
export function amountAfterEnter(value: string, currency: string): { text: string; submit: boolean } {
  const text = settledAmount(value, currency);
  if (text === null) return { text: value, submit: true };
  return { text, submit: text === value };
}

/**
 * The keypad's DONE: a readable expression writes the row and closes the dock; one that cannot be read leaves
 * both alone, so the expression stays on screen to be fixed rather than the figure being thrown away.
 *
 * `close` is not `amountAfterEnter`'s `submit`: a figure already in its final form — `100000` — must still
 * close the dock, where on a desktop the same figure means "nothing changed, so let the form save".
 */
export function amountAfterDone(value: string, currency: string): { text: string; close: boolean } {
  const text = settledAmount(value, currency);
  return text === null ? { text: value, close: false } : { text, close: true };
}

/** The dock's keys, read left to right, top to bottom. DONE spans two rows; there is deliberately no Save. */
export const KEYPAD_KEYS = ['C', '÷', '×', '⌫', '7', '8', '9', '−', '4', '5', '6', '+', '1', '2', '3', 'DONE', '0', '000', '00'] as const;

export type KeypadKey = (typeof KEYPAD_KEYS)[number];

/** What one key does to the typed text. DONE is not here; `amountAfterDone` is what DONE does. */
export function keypadPress(value: string, key: Exclude<KeypadKey, 'DONE'>): string {
  if (key === 'C') return '';
  if (key === '⌫') return value.slice(0, -1);
  return value + key;
}

/**
 * What any one key does to the dock: the row's new text, and whether the dock is finished.
 *
 * The whole decision lives here rather than in the component, so `Keypad.tsx` holds no arithmetic of its own —
 * it holds one call. A keypad that decides anything for itself is a second money path, and a second money path
 * is where a 100x error sits untested for as long as nobody mounts it.
 */
export function keypadAction(value: string, currency: string, key: KeypadKey): { text: string; close: boolean } {
  if (key === 'DONE') return amountAfterDone(value, currency);
  return { text: keypadPress(value, key), close: false };
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
 * §3.3's pre-fill: the typed figure at the day's rate, written in the account's own currency.
 *
 * Null when there is nothing to convert or no rate to convert it at — the row is then left empty to be typed,
 * because an estimate built on a rate nobody has is worse than no estimate at all. `evaluateAmount` reads the
 * figure, so `120+8` in the amount row estimates from 128 rather than from nothing.
 */
export function estimatedCharge({
  amount,
  currency,
  accountCurrency,
  rate,
}: {
  amount: string;
  currency: string;
  accountCurrency: string;
  rate: number | null;
}): string | null {
  if (rate === null || !currency || !accountCurrency || currency === accountCurrency) return null;
  const minor = evaluateAmount(amount, currency);
  if (minor === null || minor <= 0) return null;
  const charged = convertMinor(minor, currency, accountCurrency, rate);
  if (charged <= 0) return null;
  return minorToMajorString(charged, accountCurrency);
}

/**
 * The quiet line under "Charged in …": what a rate for the day suggests, and whose figure overrules it.
 *
 * Numbers are rendered the way `ratePreview` (lib/rates.ts) already renders a rate, so the app shows one
 * number style rather than two. A rate `resolveRates` marked stale did not come from `onDate` at all, so the
 * line must not claim it did.
 */
export function chargedHint({
  rate,
  currency,
  accountCurrency,
  onDate,
  accountName,
  stale = false,
  locale = 'id-ID',
}: {
  rate: number | null;
  currency: string;
  accountCurrency: string;
  onDate: string;
  accountName: string;
  stale?: boolean;
  /** Told, not assumed: the app is country-neutral, and `formatMinor` takes its locale the same way. */
  locale?: string;
}): string {
  if (rate === null) return `No ${currency}→${accountCurrency} rate is known for ${onDate}. Enter what ${accountName} charged.`;
  const shown = rate.toLocaleString(locale, { maximumFractionDigits: 4 });
  const source = stale ? `the last ${currency}→${accountCurrency} rate known` : `suggested from ${onDate}`;
  return `≈ ${shown} per 1 ${currency} · ${source}, change it to what ${accountName} charged`;
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
