import {
  convertMinor,
  CURRENCIES,
  currencyInfo,
  equalShares,
  evaluateAmount,
  evaluateExact,
  exchangeLines,
  expenseLines,
  incomeLines,
  isoDate,
  minorToMajorString,
  parseMajor,
  type PostingLine,
  refundLines,
  type RoundDirection,
  splitExpenseLines,
  transferLines,
  yourShare,
} from '@expanses/core';
import { NetWorthError, type AccountRow, type MemberTransferInput, type PaidFrom, type PostTransactionInput, type RecordTradeInput, type SplitBillInput, type TaggedTransferInput, type TransactionView } from '@expanses/db';
import { emptyPurchaseDraft, type PurchaseDraft, purchaseDraftToInput } from './buy-in-form';
import { classify } from './classify';
import { isEditable } from './draft';
import { postedAgainstPlaceholder } from '../sharing/sharing-copy';

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
  /**
   * Joint net worth §7.1: the partner's shared item Paid with names (`moneyId` is then the partner's placeholder), null
   * once one of this person's own accounts is picked, and undefined — "as the purchase already says" — until either.
   */
  paidFrom?: PaidFrom | null;
  /**
   * Joint net worth §7.2: on the Transfer tab, the partner's shared item the money goes to (`side: 'to'`, To names it
   * and `toId` is unused) or came from (`side: 'from'`, From names it and `moneyId` is unused); null or absent — none.
   */
  partner?: PartnerItem | null;
  /**
   * The figure as the form was opened on a transaction (an edit, or a Duplicate of one), with the exact figure of an
   * amount once typed with cents. While the amount reads as it opened, the save leaves the stored figure alone (an
   * edit) or copies it (a Duplicate); once the amount, the charged row, the currency or the tab changes, the save
   * says what the new figure is instead — never this one, which no longer describes it. Absent on a new form.
   */
  opened?: OpenedFigure;
}

/**
 * What `FormDraft.opened` holds: the figure as read when the form opened — the tab, the amount and the charged figure
 * in whole minor units (null where a row is empty), the currencies they are read in, and the exact hundredths (null
 * when whole). Readings rather than texts, so "12501" and "12.501" are the same amount, and currencies as resolved
 * rather than as the flag holds them, so a tab that blanks the flag and gives it back changes nothing.
 */
export interface OpenedFigure {
  mode: FormMode;
  amountMinor: number | null;
  chargedMinor: number | null;
  /** The currency the amount row is read in (`typedCurrency`). */
  typedCurrency: string;
  /** The paying account's own currency: what the posting is in. */
  settledCurrency: string;
  exactHundredths: number | null;
}

/** A partner's shared item one side of a transfer names (§7.2), with the currency the transfer must then be in. */
export interface PartnerItem {
  side: 'to' | 'from';
  owner: string;
  itemId: string;
  currency: string;
}

/** This person's own account in a transfer with a partner: From when the money goes to them, To when it came from them. */
export function ownTransferAccountId(draft: Pick<FormDraft, 'partner' | 'moneyId' | 'toId'>): string {
  return draft.partner?.side === 'from' ? draft.toId : draft.moneyId;
}

/**
 * A transfer with a partner as the form holds it (§7.2), checked, in the shape `recordMemberTransfer` takes: this person's
 * own account — `ownItemId`, its shared item, is the caller's to name (`itemIdOf`) — the partner's item, one currency, the
 * figure. Throws a user-readable Error when a row is missing or the two sides' currencies differ.
 */
export function memberTransferOf(draft: FormDraft, accounts: readonly AccountRow[], me: string, ownItemId: string): MemberTransferInput {
  const partner = draft.partner;
  if (draft.mode !== 'transfer' || !partner) throw new Error('Choose who the transfer is with');
  const own = accounts.find((a) => a.id === ownTransferAccountId(draft));
  if (!own?.currency) throw new Error(partner.side === 'to' ? 'Choose the From account' : 'Choose the To account');
  if (own.currency !== partner.currency) throw new Error(`Pick an account in ${partner.currency}`);
  const amountMinor = positive(draft.amount, own.currency, 'Amount');
  const mine = { owner: me, itemId: ownItemId };
  const theirs = { owner: partner.owner, itemId: partner.itemId };
  return {
    occurredOn: draft.occurredOn,
    amountMinor,
    currency: own.currency,
    from: partner.side === 'to' ? mine : theirs,
    to: partner.side === 'to' ? theirs : mine,
    description: draft.description.trim() || null,
  };
}

/** The typed figure of a transfer with a partner being corrected, in minor units of its currency (§7.2). */
export function transferFigure(draft: Pick<FormDraft, 'amount'>, currency: string): number {
  return positive(draft.amount, currency, 'Amount');
}

/**
 * The form's words for a save refused because Paid with names a partner's item that has stopped being shared (§7.1):
 * the item by the name the row shows, "Rina Card ···· 1234 is no longer shared", else the refusal's own words.
 */
export function sayPaidWithError(error: unknown, itemName: string | null | undefined): unknown {
  if (error instanceof NetWorthError && error.code === 'item-not-shared' && itemName) return new Error(`${itemName} is no longer shared. Pick another way to pay.`);
  return error;
}

/** What the ledger is told about Paid with (§5.3): the choice when one was made in this form, else nothing. */
export function paidFromHint(draft: Pick<FormDraft, 'mode' | 'paidFrom'>): { paidFrom?: PaidFrom | null } {
  return draft.mode === 'expense' && draft.paidFrom !== undefined ? { paidFrom: draft.paidFrom } : {};
}

/**
 * The partner's shared item this form pays with (§7.1), or null for this person's own accounts: the one picked here,
 * else — until something is picked — the one the edited purchase was paid from, when this person paid it from an
 * item that is not their own (`saved`, the purchase's payer as `purchasePayers` reads it).
 */
export function sharedPaymentOf(
  draft: Pick<FormDraft, 'mode' | 'paidFrom'>,
  saved: { paidBy: string; mine: boolean; paidFrom: PaidFrom | null } | null | undefined,
): PaidFrom | null {
  if (draft.mode !== 'expense') return null;
  if (draft.paidFrom !== undefined) return draft.paidFrom;
  return saved?.mine && saved.paidFrom && saved.paidFrom.owner !== saved.paidBy ? saved.paidFrom : null;
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

/**
 * What a new transaction's opener already knows, filled in before the form opens: an account's page knows the
 * account, an event's Add spending knows the event, and a plan item's "Buy it now" knows the note, the figure and
 * the category as well. Ids this device does not hold are dropped (`seeded`); the event is the opener's to check,
 * because the events are read owner-wide and not from `accounts`.
 */
export interface CardSeed {
  moneyId?: string;
  toId?: string;
  eventId?: string;
  categoryId?: string;
  description?: string;
  amount?: string;
}

/**
 * The opener's seed as form fields, keeping only ids this device holds: an address typed or kept from another
 * workspace names nothing, and fills nothing in. A category must also be a spending one — the only kind an opener seeds — so a stray id cannot open Expense on an
 * account that is not a category at all.
 */
export function seeded(seed: CardSeed | undefined, accounts: readonly AccountRow[]): Partial<FormDraft> {
  const known = (id: string | undefined) => (id && accounts.some((a) => a.id === id) ? id : '');
  const category = seed?.categoryId && accounts.some((a) => a.id === seed.categoryId && a.kind === 'expense') ? seed.categoryId : '';
  return {
    moneyId: known(seed?.moneyId),
    toId: known(seed?.toId),
    ...(seed?.eventId ? { eventId: seed.eventId } : {}),
    ...(category ? { categoryId: category } : {}),
    ...(seed?.description ? { description: seed.description } : {}),
    ...(seed?.amount ? { amount: seed.amount } : {}),
  };
}

const accountOf = (draft: FormDraft, accounts: readonly AccountRow[]) => accounts.find((a) => a.id === draft.moneyId);

/**
 * Whether this draft may be saved with its category left for later, and so which kind's Uncategorised it is filed
 * under — null when it has its category, or when a category has to be chosen now: a transfer has none, every line
 * of a split names its own, and a bill shared with someone files your share under the one category chosen for it.
 */
export function categoryLater(draft: FormDraft): 'expense' | 'income' | null {
  if (draft.categoryId) return null;
  if (draft.mode === 'income') return 'income';
  if (draft.mode !== 'expense' || draft.splits.length > 0) return null;
  if (peopleOn(draft).length > 0 && !draft.editing) return null;
  return 'expense';
}

/** The draft with "Choose later" answered: filed under `uncategorisedId` when its category was left for later. */
export function withCategoryLater(draft: FormDraft, uncategorisedId: string): FormDraft {
  return categoryLater(draft) ? { ...draft, categoryId: uncategorisedId } : draft;
}

/** Who filled Category: chosen by hand (or opened already holding one), filled from the note's history, or nobody yet. */
export type CategorySource = 'hand' | 'auto' | null;

/**
 * What the note's history does to Category once a guess comes back: the category to fill in, '' to empty one that was
 * only filled from an earlier note this one no longer matches, or null to leave Category exactly as it is.
 *
 * A category picked by hand — or one the form opened with (an edit, a duplicate, a capture) — is never touched. Only
 * Expense and Income guess, each from its own tree; a transfer has no category and a split's lines are their own.
 *
 * `fits` is what Category may hold right now (`fitsEventSet`): recording into an event that draws on a set, only that
 * set's categories. A guess outside it counts as no match at all — it does not fill an empty row, and it empties one
 * only the note had filled — because the history knows where "Indomaret" went last month, not that this spending is
 * a renovation's.
 */
export function categoryFromNote(draft: FormDraft, found: string | null, source: CategorySource, fits: (categoryId: string) => boolean = () => true): string | null {
  if (draft.mode !== 'expense' && draft.mode !== 'income') return null;
  if (draft.splits.length > 0 || source === 'hand') return null;
  const guess = found && fits(found) ? found : null;
  if (source === 'auto') return guess === draft.categoryId ? null : (guess ?? '');
  if (draft.categoryId) return null;
  return guess;
}

/**
 * Whether Category has to be emptied because the Event row changed under it: only a category the note's history
 * filled ('auto') that the event's set no longer offers. A category picked by hand — or one the form opened with —
 * is never emptied behind the owner's back; the picker shows what it may be changed to.
 */
export function autoCategoryOutOfSet(categoryId: string, source: CategorySource, fits: (categoryId: string) => boolean): boolean {
  return source === 'auto' && !!categoryId && !fits(categoryId);
}

/**
 * Who Category starts out filled by. A form opened on something that already exists — an edit, a duplicate, a capture
 * under review — is the owner's own, category or not: the note's history only ever helps a new, empty transaction.
 */
export function initialCategorySource(prefilled: boolean): CategorySource {
  return prefilled ? 'hand' : null;
}

/** A figure that starts with a minus. */
const MINUS_FIRST = /^\s*[-−–]/;

/**
 * Whether a minus typed first may make this figure a refund: an expense's one figure. Not income or a transfer,
 * not a split by category (every line is spending), not a bill shared with someone.
 */
export function refundAllowed(draft: FormDraft): boolean {
  return draft.mode === 'expense' && draft.splits.length === 0 && (draft.editing || peopleOn(draft).length === 0);
}

/** Money back on a purchase: an expense whose figure was typed with a minus first ("−450.000"). */
export function isRefund(draft: Pick<FormDraft, 'mode' | 'amount'>): boolean {
  return draft.mode === 'expense' && MINUS_FIRST.test(draft.amount);
}

/**
 * Whether a figure on this screen may be typed in a currency of its own.
 *
 * **A transfer may not.** Moving your own money has no merchant and no card conversion: the figure that leaves
 * is in the From account's own currency by definition, and what lands is the To account's, which §3.5's
 * Received amount row already asks for. There is no third currency for a flag to name — and the transfer branch
 * of `formToPost` has always read the typed figure in the From account's own currency.
 *
 * The flag was drawn there all the same, with "Charged in IDR" under it, pre-filled at the day's rate. Typing
 * `100` with the flag on USD drew `Charged in IDR = 1600000`, said "≈ 16.000 per 1 USD", raised no error — and
 * moved **Rp 100**. Three rows drawn and one honoured is the shape this branch already rejected once. So this
 * is the one question that decides it, asked by the screen that draws the flag and by the kit that reads the
 * figure, rather than answered twice.
 */
export const currencyChoosable = (draft: FormDraft) => draft.mode !== 'transfer';

/**
 * The currency the flag shows: what was typed, or — until something is typed — the paying account's own.
 *
 * Where no flag is offered there is nothing typed to honour, so the figure is read in the account's own
 * currency whatever `draft.currency` was left holding by a tab visited earlier.
 */
export const typedCurrency = (draft: FormDraft, accounts: readonly AccountRow[]) =>
  (currencyChoosable(draft) ? draft.currency : '') || accountOf(draft, accounts)?.currency || '';

/**
 * Whether the amount row names its currency yet: once a figure is typed, or once the flag was chosen. A blank row
 * with nothing picked says nothing about money it does not hold; the first digit brings the flag and the code of
 * the currency it is read in (the paying account's, else the base currency).
 */
export const currencyShown = (draft: FormDraft) => draft.amount.trim() !== '' || draft.currency !== '';

/**
 * Whether the "Charged in <account currency>" row applies: the figure was typed in one currency and the
 * account settles in another, so the posting cannot be read off the typed figure alone.
 *
 * `typedCurrency`, not `draft.currency`: the row must appear exactly when the two figures differ *as the kit
 * reads them*, or the screen draws a second figure the save has no use for.
 */
export function chargedInNeeded(draft: FormDraft, accounts: readonly AccountRow[]): boolean {
  const account = accountOf(draft, accounts);
  if (!account?.currency || !currencyChoosable(draft) || !draft.currency) return false;
  return typedCurrency(draft, accounts) !== account.currency;
}

/** One money field of the amount row: what it is called, what is in it, and the currency it is read in. */
export interface MoneyFieldSpec {
  which: 'amount' | 'charged' | 'received';
  label: string;
  value: string;
  /** Never empty: the workspace's own currency stands in until an account is chosen. */
  currency: string;
  /**
   * Set only on the one field that may take cents in a currency with no minor unit (`decimalsDirection`): the way
   * they are rounded to the whole figure that posts. The dock offers its comma on this field, and the field's reader
   * keeps the cents on screen until the save. Absent everywhere else, which stays whole.
   */
  fractional?: RoundDirection;
}

/** The words a figure with cents is refused in, on any money field of a whole-unit currency but the single amount. */
export const DECIMALS_REFUSAL = 'Decimals go on a single amount only';

/**
 * Which way cents typed on this draft's single amount are rounded — up for money out (an expense, and a refund of
 * one, which gives back a charge that was rounded up), down for money in — or null when the draft has no single
 * amount to take them: a transfer, a trade, a split by category, a bill shared with someone.
 */
export function decimalsDirection(draft: FormDraft): RoundDirection | null {
  if (draft.mode === 'income') return 'down';
  if (draft.mode !== 'expense' || draft.splits.length > 0) return null;
  if (peopleOn(draft).length > 0 && !draft.editing) return null;
  return 'up';
}

/** The allowance for one field, by exponent: a currency with cents of its own already takes them, as it always did. */
const fractionalIn = (direction: RoundDirection | null, currency: string): { fractional?: RoundDirection } =>
  direction && currencyInfo(currency).exponent === 0 ? { fractional: direction } : {};

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
  const direction = decimalsDirection(draft);
  const amount: MoneyFieldSpec = { which: 'amount', label: 'Amount', value: draft.amount, currency: typedCurrency(draft, accounts) || baseCurrency };
  if (!chargedInNeeded(draft, accounts)) return { amount: { ...amount, ...fractionalIn(direction, amount.currency) }, charged: null };
  // A foreign purchase: the cents go on what the account was charged, which is what posts. The figure typed in the
  // merchant's currency keeps that currency's own rules.
  const chargedCurrency = settled || baseCurrency;
  return {
    amount,
    charged: { which: 'charged', label: `Charged in ${settled}`, value: draft.chargedAmount, currency: chargedCurrency, ...fractionalIn(direction, chargedCurrency) },
  };
}

/**
 * The currency a figure on this draft **posts** in: the account's own, and the workspace's until one is chosen.
 *
 * It is `amountFields`' own answer rather than a second derivation of it — the charged row when there is one,
 * the amount row when there is not — so the Split sheet's running total, the With sheet's shares and the row
 * the user types into cannot read one figure at two different scales. `MoreDetails` used to work it out for
 * itself, which is the same fault one layer over: a second place deciding a money field's currency.
 */
export function postingCurrency(draft: FormDraft, accounts: readonly AccountRow[], baseCurrency: string): string {
  const { amount, charged } = amountFields(draft, accounts, baseCurrency);
  return (charged ?? amount).currency;
}

/**
 * A transfer's second figure — what arrived in the To account — with its label and the currency it is read in:
 * always the To account's. Null unless this is a transfer between two different currencies.
 *
 * Decided once, beside `amountFields`, for the same reason: the Transfer tab's Received row, the Move between
 * pockets screen and `transferPostingLines` all read this record, so the figure a screen draws and the figure the
 * ledger moves cannot be read at two different scales.
 */
export function receivedField(draft: FormDraft, accounts: readonly AccountRow[]): MoneyFieldSpec | null {
  if (draft.mode !== 'transfer') return null;
  const from = accountOf(draft, accounts);
  const to = accounts.find((a) => a.id === draft.toId);
  if (!from?.currency || !to?.currency || from.currency === to.currency) return null;
  return { which: 'received', label: `Received amount (${to.currency})`, value: draft.toAmount, currency: to.currency };
}

export type ExtraRow = 'event' | 'split' | 'with' | 'mcc' | 'channel' | 'photos' | 'exclude' | 'rate';

/**
 * The word on the control that folds §4's rows away — what a tap will do, never what is on screen.
 *
 * It is drawn as plain text rather than as a white pill, so the label is the only thing that tells the two states
 * apart and is the only thing a screen reader is given beyond `aria-expanded`.
 */
export const detailsToggleLabel = (open: boolean): string => (open ? 'Fewer details' : 'Add more details');

/**
 * The With rows that name somebody. A row being typed into is not yet a person on the bill.
 *
 * One filter, three readers — `withShares`, the With sheet's own list and the Split/With refusal below. It was
 * written out twice already, and a fourth copy is how "somebody is on this bill" comes to mean two things.
 */
export const peopleOn = (draft: FormDraft): WithRow[] => draft.with.filter((row) => row.debtAccountId || row.name.trim());

/**
 * Why a split bill cannot also be split by category, in the words the save refuses it with.
 *
 * `splitBill` files your own share under **one** category (`ownCategoryId`), because that is the only shape a
 * receivable-and-spending posting has: each friend's share waits in their own account, and what is left is your
 * spending under a single heading. A split by category names several. There is no honest way to file one share
 * across two categories — which of Andi's Rp 42.500 was groceries? — so the two are offered apart rather than
 * one of them being dropped, which is what used to happen: the Groceries row and its money were filed under
 * Restaurants, in silence.
 */
export const SPLIT_WITH_REFUSAL =
  'A bill split by category cannot also be shared with someone: each share is filed under one category, and the split names several. Remove the splits, or remove the people.';

/**
 * Why this row is refused right now — null when it is free to be used.
 *
 * **The one place that knows Split by category and With are exclusive.** The screen reads it to grey the second
 * row out with the reason in it, before Save; `formToPost` reads the same function as the backstop that makes
 * the combination impossible to post. A refusal stated twice is a refusal one of the two readers will one day
 * stop making.
 */
export function extraRowRefusal(row: ExtraRow, draft: FormDraft): string | null {
  // On an edit With is not offered at all (§15.6), so there is nothing to refuse and nothing to grey out.
  if (draft.mode !== 'expense' || draft.editing) return null;
  if (row === 'split' && peopleOn(draft).length > 0) return SPLIT_WITH_REFUSAL;
  if (row === 'with' && draft.splits.length > 0) return SPLIT_WITH_REFUSAL;
  return null;
}

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
  {
    missingRate,
    sharedBook = false,
  }: {
    missingRate: { from: string; to: string; onDate: string } | null;
    /**
     * Household sharing spec §4.4 last line: in a shared book there is no With row. A purchase paid by someone
     * else already names its payer — sharing is what the book itself is — and With's own receivable would be a
     * second, informal ledger of who owes whom laid over the one the book already keeps.
     */
    sharedBook?: boolean;
  },
): ExtraRow[] {
  const outward = draft.mode === 'expense' || draft.mode === 'income';
  const rows: ExtraRow[] = outward ? ['event'] : [];
  if (draft.mode === 'expense') {
    rows.push('split');
    if (!draft.editing && !sharedBook) rows.push('with');
    if (accountOf(draft, accounts)?.subtype === 'credit_card') rows.push('mcc');
  }
  // Online or offline is how money left for the outside world; it says nothing about money moved between your
  // own accounts, and a trade is recorded as units rather than as a purchase.
  if (outward) rows.push('channel');
  rows.push('photos', 'exclude');
  if (missingRate) rows.push('rate');
  return rows;
}

/**
 * A whole typed figure the save will act on, in minor units — read by **the kit's one reader**, `evaluateExact`
 * (`evaluateAmount` with the exact figure beside it), through `figureOf`.
 *
 * `parseMajor` alone cannot read `50000+10000`. The amount row accepts it, the keypad computes it, the Split
 * sheet added it up and printed "Total Rp 95.000", the With sheet divided it — and then Save refused the very
 * figure the screen had just totalled, with `Invalid amount: "50000+10000"`. The screen's arithmetic and the
 * save's were two arithmetics; there is one now, and it is this one.
 *
 * When the figure cannot be read, `parseMajor` is asked for the words: "allows 0 decimal places" says far more
 * than a flat refusal, and a figure it reads perfectly well was simply zero or less. Cents on a whole-unit currency
 * are the exception: this field does not take them, and `DECIMALS_REFUSAL` says which one does.
 *
 * The one refusal `parseMajor` has no words for is the empty box, and it is the commonest way here: it
 * answers `Invalid amount: ""`, which is the kit talking to itself with the user reading over its shoulder.
 * That case is worded here.
 */
function positive(value: string, currency: string, label: string): number {
  return figureOf(value, currency, label, {}).minor;
}

/**
 * Whether a figure that cannot be read whole would read with cents — so it can be refused in words that say where
 * cents go, rather than with "IDR allows 0 decimal places", which says nothing about the one field that takes them.
 */
function hasCents(value: string, currency: string, refund: boolean): boolean {
  try {
    return (evaluateExact(value, currency, { refund, fractional: 'up' })?.exactHundredths ?? null) !== null;
  } catch {
    return false;
  }
}

/**
 * Any typed figure the save acts on, as the positive amount it comes to and — on the one field that takes cents
 * (`fractional`) — their exact hundredths, null when there are none.
 *
 * `refund`: a minus typed first is the refund's sign, so the figure is read with the refund allowance; a figure
 * typed without one (a charged row filled in plain) reads as is. `wholeOnly: 'own'` keeps a field to its own
 * currency's rules and words — the merchant's figure on a foreign purchase, which is not the figure that posts.
 */
function figureOf(
  value: string,
  currency: string,
  label: string,
  { refund = false, fractional, wholeOnly = 'refuse' }: { refund?: boolean; fractional?: RoundDirection; wholeOnly?: 'refuse' | 'own' },
): { minor: number; exactHundredths: number | null } {
  const read = evaluateExact(value, currency, { refund, fractional });
  if (read !== null) return { minor: Math.abs(read.minor), exactHundredths: read.exactHundredths };
  const rest = refund ? value.replace(MINUS_FIRST, '') : value;
  if (!rest.trim()) throw new Error(`${label} is empty — type a figure`);
  if (hasCents(value, currency, refund)) {
    if (!fractional && wholeOnly === 'refuse') throw new Error(DECIMALS_REFUSAL);
    // Taken with cents, it was read: it came to nothing once rounded (an income of 0,50 rounds down to 0). Asking
    // `parseMajor` here would answer "IDR allows 0 decimal places" on the one field that allows them.
    if (fractional) throw new Error(refund ? `${label} must come to money back` : `${label} must be greater than zero`);
  }
  parseMajor(rest, currency);
  throw new Error(refund ? `${label} must come to money back` : `${label} must be greater than zero`);
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
 * What the Split sheet says while a row holds cents on a whole-unit currency — `DECIMALS_REFUSAL`, the words Save
 * refuses it with — or null. On a phone the ✓ is greyed while the draft would be refused, so the reason has to be
 * on the sheet where the row is typed, not only behind a button that cannot be pressed.
 */
export function splitCentsRefusal(splits: readonly SplitRow[], currency: string): string | null {
  const cents = splits.some((row) => row.amount.trim() !== '' && evaluateAmount(row.amount, currency) === null && hasCents(row.amount, currency, false));
  return cents ? DECIMALS_REFUSAL : null;
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
): { amountMinor: number; exactHundredths: number | null; originalCurrency: string | null; originalAmountMinor: number | null } {
  const settled = account.currency!;
  if (splitTotalMinor !== null) {
    // `splitRowsOf` has already refused a split typed in another currency, so the figure here is in `settled`.
    // The kit's one reader, not a second weaker one. `parseMajor` cannot read `250000+150000`, which the amount
    // row is built to accept, so a sum that agrees perfectly well was refused with a raw `MoneyError`.
    if (draft.amount.trim() && evaluateAmount(draft.amount, settled) !== splitTotalMinor) {
      // Cents spread over several categories have no line to round onto: said where they go, not as a mismatch.
      if (hasCents(draft.amount, settled, false)) throw new Error(DECIMALS_REFUSAL);
      throw new Error('The splits must add up to the amount');
    }
    return { amountMinor: splitTotalMinor, exactHundredths: null, originalCurrency: null, originalAmountMinor: null };
  }
  // A refund's figures are the money that came back, positive: its sign is in the lines (`refundLines`).
  const refund = isRefund(draft);
  // Cents on a whole-unit currency go on the figure that posts, and only on a draft with a single amount.
  const fractional = decimalsDirection(draft) ?? undefined;
  if (!typed || typed === settled) {
    const { minor, exactHundredths } = figureOf(draft.amount, settled, 'Amount', { refund, fractional });
    return { amountMinor: minor, exactHundredths, originalCurrency: null, originalAmountMinor: null };
  }
  if (!draft.chargedAmount.trim()) throw new Error(`Enter the amount charged in ${settled}`);
  const charged = figureOf(draft.chargedAmount, settled, `Amount charged in ${settled}`, { refund, fractional });
  return {
    amountMinor: charged.minor,
    exactHundredths: charged.exactHundredths,
    originalCurrency: typed,
    originalAmountMinor: figureOf(draft.amount, typed, 'Amount', { refund, wholeOnly: 'own' }).minor,
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
  if (isRefund(draft)) return refundLines({ categoryAccountId: draft.categoryId, paymentAccountId: account.id, amountMinor, currency });
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
  // Non-null: both accounts have a currency and they differ, which is exactly when `receivedField` answers.
  const received = receivedField(draft, accounts)!;
  return exchangeLines({
    fromAccountId: account.id,
    fromAmountMinor: amountMinor,
    fromCurrency: currency,
    toAccountId: to.id,
    toAmountMinor: positive(received.value, received.currency, 'Received amount'),
    toCurrency: received.currency,
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
  const people = peopleOn(draft);
  if (people.length === 0) {
    if (!lenient) throw new Error('Say who owes for this');
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
    return {
      kind: 'trade',
      input: {
        // The paying account's currency: a holding in another currency carries what was charged (`withCharged`),
        // so the door (`postForDoor` → `tradeDoor`) weighs the money that left, in that account's own currency.
        ...purchaseDraftToInput(draft.purchase, currency, isoDate(), accounts.find((a) => a.id === draft.purchase.moneyId)?.currency ?? currency),
        // §4: Photos and Exclude from report appear "always", and `extraRows` offers both on this tab. Buying
        // something is the one purchase with a contract note to keep, and the tab used to have nowhere to put
        // it: the rows were computed and never drawn. The trade's own fields stay `purchase`'s.
        excludedFromReport: draft.excluded,
        photoIds: draft.photoIds,
      },
    };
  }

  const account = accountOf(draft, accounts);
  if (!account?.currency) throw new Error(draft.mode === 'transfer' ? 'Choose the From account' : 'Choose an account');
  const typed = typedCurrency(draft, accounts);
  const onCard = draft.mode === 'expense' && account.subtype === 'credit_card';
  const mcc = typedMcc(draft);

  if (draft.mode === 'transfer') {
    // Through `amounts()`, like every other mode, rather than reading the figure a second way of its own. A
    // transfer offers no flag (`currencyChoosable`) so `typed` is the From account's currency and the original
    // pair is always null — but the figure that posts is read by the one function that reads every figure that
    // posts, so the two can never come apart again the way they did when this branch read it alone.
    const { amountMinor } = amounts(draft, account, typed, null);
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
          // §2's "To · For goal · Received amount", which the screen draws together and this branch used to
          // walk past: the goal was taken and `draft.toAmount` — a field the screen marks required — was
          // ignored, so both legs posted the source figure and the user met `Lines in USD sum to …` after
          // pressing Save. The row the screen asked for is the row that posts.
          toAmountMinor: (() => {
            const received = receivedField(draft, accounts);
            return received ? positive(received.value, received.currency, 'Received amount') : null;
          })(),
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
        // A transfer never takes cents: an expense or income corrected into one leaves its exact figure behind.
        ...exactField(draft, accounts, null),
      },
    };
  }

  /*
   * Split by category and With, refused together before either is read.
   *
   * The screen greys the second row out with these very words, so this is only ever reached by a draft the
   * screen did not build. It is kept all the same, and kept *first*: a post that got this far would send
   * `splitBill` one category and the sum of the rows, filing the other categories' money under the first one —
   * money in the wrong place, with nothing on screen to say so. `extraRowRefusal` is the one statement of the
   * rule; this asks it rather than restating it.
   */
  if (peopleOn(draft).length > 0) {
    const refusal = extraRowRefusal('with', draft);
    if (refusal) throw new Error(refusal);
  }

  // Money back goes back under one category, from the one account it was paid with.
  if (isRefund(draft)) {
    if (draft.splits.length > 0) throw new Error('A refund goes back under one category: remove the splits');
    if (peopleOn(draft).length > 0 && !draft.editing) throw new Error('A refund cannot be shared: remove the people');
  }

  // The split is read before the figure is asked for, because on a split the rows *are* the figure — the order
  // `draftToLines` had, and losing it is what made a split impossible to save.
  const splits = splitByCategory(draft) ? splitRowsOf(draft, account.currency, typed) : null;
  const splitTotalMinor = splits ? splits.reduce((sum, row) => sum + row.amountMinor, 0) : null;
  const { amountMinor, exactHundredths, originalCurrency, originalAmountMinor } = amounts(draft, account, typed, splitTotalMinor);

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
        // §2's "Choosing it never changes the account or card", and §3.3's original pair. Both are facts about
        // the purchase, not about who else was at the table: they are carried here exactly as the plain expense
        // below carries them, off the very same `amounts()` result, so one way in cannot record less than the other.
        cardId: onCard ? draft.cardId.trim() || null : null,
        originalCurrency,
        originalAmountMinor,
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
      // Paid with the partner's shared item (joint net worth §7.1): the ledger passes it to the purchase's lineage.
      ...paidFromHint(draft),
      ...exactField(draft, accounts, exactHundredths),
    },
  };
}

/** The figure on a draft, read as `OpenedFigure` records it. */
function figureNow(draft: FormDraft, accounts: readonly AccountRow[]): Omit<OpenedFigure, 'exactHundredths'> {
  const typed = typedCurrency(draft, accounts);
  const settled = accountOf(draft, accounts)?.currency ?? '';
  // A minus is allowed on both sides of the comparison alike: the tab is compared too, so a refund only ever meets a refund.
  const read = (text: string, currency: string) => (text.trim() && currency ? evaluateAmount(text, currency, { refund: true }) : null);
  return {
    mode: draft.mode,
    amountMinor: read(draft.amount, typed),
    chargedMinor: read(draft.chargedAmount, settled),
    typedCurrency: typed,
    settledCurrency: settled,
  };
}

/**
 * Whether the money still reads as the form opened on it: the same tab, the same amount and charged figure, in the
 * same currencies, paid from an account in the same currency, and no split. An amount that cannot be read whole (one
 * typed with cents, or half typed) is never the same.
 */
function figureAsOpened(draft: FormDraft, opened: OpenedFigure, accounts: readonly AccountRow[]): boolean {
  const now = figureNow(draft, accounts);
  return (
    draft.splits.length === 0 &&
    now.amountMinor !== null &&
    now.mode === opened.mode &&
    now.amountMinor === opened.amountMinor &&
    now.chargedMinor === opened.chargedMinor &&
    now.typedCurrency === opened.typedCurrency &&
    now.settledCurrency === opened.settledCurrency
  );
}

/**
 * The exact figure a save sends with its posting (the ledger's `exactHundredths`), or nothing.
 *
 * - The figure as it opened: an edit leaves the field out, so the ledger carries the stored figure (a note-only edit,
 *   a re-file from the row's circle); a Duplicate copies it with the amount it belongs to.
 * - Typed with cents: that figure.
 * - Anything else on an edit — retyped whole, moved to another tab, spread over a split, made a transfer — an
 *   explicit null, because the stored figure no longer describes the amount and the ledger refuses one that does
 *   not fit. A new transaction typed whole sends nothing, as it always did.
 */
function exactField(draft: FormDraft, accounts: readonly AccountRow[], typed: number | null): { exactHundredths?: number | null } {
  const opened = draft.opened;
  if (opened && typed === null && figureAsOpened(draft, opened, accounts)) {
    if (draft.editing || opened.exactHundredths === null) return {};
    return { exactHundredths: opened.exactHundredths };
  }
  if (typed !== null) return { exactHundredths: typed };
  return draft.editing ? { exactHundredths: null } : {};
}

/**
 * Whether the row's category circle can re-file this transaction: one category and one money account — a purchase,
 * a refund, an income, foreign or not — still posted and still the forms' to edit.
 */
export function canRefile(tx: TransactionView): boolean {
  if (!isEditable(tx)) return false;
  const c = classify(tx);
  if (c.type !== 'expense' && c.type !== 'income') return false;
  const categories = tx.entries.filter((e) => e.accountKind === c.type);
  const money = tx.entries.filter((e) => e.accountKind === 'asset' || e.accountKind === 'liability');
  return categories.length === 1 && money.length === 1 && tx.entries.length === 2;
}

/**
 * The transaction again with only its category swapped, through the edit path itself: read back as the form would
 * open it, the category changed, and posted as the form would save it — so a refund's sign, a foreign purchase's
 * original pair, the card and the MCC all go through untouched.
 */
export function refiledPost(tx: TransactionView, accounts: readonly AccountRow[], categoryId: string, bookId = ''): FormPost {
  return formToPost({ ...formFromTransaction(tx, accounts, bookId), categoryId }, accounts);
}

/**
 * A transaction reopened as a draft: the typed currency is what the merchant charged, when there was one.
 *
 * `photoIds` are the pictures the transaction already has, in the order they were taken. They are a caller's
 * argument rather than something read off `TransactionView`, which carries only a `photoCount` — but they have
 * to be carried, because without them the Photos row of a transaction that has a receipt says **None**. The
 * picture is not lost (`movePhotosTx` carries it), yet the one screen that could show or remove it says there
 * is nothing there, which is what data loss looks like from the outside.
 */
export function formFromTransaction(tx: TransactionView, accounts: readonly AccountRow[], bookId = '', photoIds: readonly string[] = []): FormDraft {
  const c = classify(tx);
  const money = tx.entries.filter((e) => e.accountKind === 'asset' || e.accountKind === 'liability');
  const base: FormDraft = {
    ...emptyForm(bookId, tx.occurredOn),
    description: tx.description,
    photoIds: [...photoIds],
    mcc: tx.mcc ?? '',
    cardId: tx.cardId ?? '',
    eventId: tx.eventId ?? '',
    channel: tx.channel ?? '',
    excluded: tx.excluded ?? false,
    goalId: tx.goalId ?? '',
    editing: true,
  };
  /**
   * The currency the paying line settled in: the account's own, and — when that account is not in `accounts`
   * at all, which `?? ''` below admits can happen — the currency **the line itself posted in**.
   *
   * Never a literal code. A hardcoded `'IDR'` here was the only country currency left in the transaction kit,
   * against the country-neutral rule, and it was wrong as well as parochial: on a USD-base workspace whose
   * paying account had not arrived, the figure was written at IDR's exponent 0 and read back by the field at
   * USD's exponent 2 — a 100× error on a reopened transaction. The entry knows what it posted in; ask it.
   */
  const settledOf = (payment: { accountId: string; currency: string }) =>
    accounts.find((a) => a.id === payment.accountId)?.currency || payment.currency;
  const foreign = (payment: { accountId: string; currency: string }, amountMinor: number) => {
    const settled = settledOf(payment);
    if (!tx.originalCurrency || tx.originalAmountMinor === null) {
      return { currency: settled, amount: minorToMajorString(amountMinor, settled), chargedAmount: '' };
    }
    // A refund reopens with its minus on the typed figure, the one place a refund is said.
    const sign = amountMinor < 0 ? '-' : '';
    return {
      currency: tx.originalCurrency,
      amount: sign + minorToMajorString(tx.originalAmountMinor, tx.originalCurrency),
      chargedAmount: minorToMajorString(Math.abs(amountMinor), settled),
    };
  };

  if (c.type === 'expense' || c.type === 'income') {
    const payment = money[0]!;
    const category = tx.entries.filter((e) => e.accountKind === c.type);
    if (c.type === 'expense' && category.length > 1) {
      return withOpened({
        ...base,
        moneyId: payment.accountId,
        currency: settledOf(payment),
        splits: category.map((e) => ({ categoryId: e.accountId, amount: minorToMajorString(e.amountMinor, e.currency) })),
      }, tx, accounts);
    }
    const only = category[0]!;
    const total = c.type === 'expense' ? only.amountMinor : -only.amountMinor;
    // The whole figure that posted (B2): cents are shown only while they are being typed. The exact figure, when the
    // amount was typed with them, rides along with the texts it belongs to, so a save that leaves them alone keeps it.
    return withOpened({ ...base, mode: c.type, moneyId: payment.accountId, categoryId: only.accountId, ...foreign(payment, total) }, tx, accounts);
  }

  const from = money.find((e) => e.amountMinor < 0);
  const to = money.find((e) => e.amountMinor > 0);
  return withOpened({
    ...base,
    mode: 'transfer',
    moneyId: from?.accountId ?? '',
    toId: to?.accountId ?? '',
    currency: from ? settledOf(from) : '',
    amount: from ? minorToMajorString(-from.amountMinor, from.currency) : '',
    toAmount: to && from && to.currency !== from.currency ? minorToMajorString(to.amountMinor, to.currency) : '',
  }, tx, accounts);
}

/** A reopened draft with the figure it opened on (`FormDraft.opened`). */
function withOpened(form: FormDraft, tx: TransactionView, accounts: readonly AccountRow[]): FormDraft {
  return { ...form, opened: { ...figureNow(form, accounts), exactHundredths: tx.exactHundredths ?? null } };
}

/** What `canDuplicate` needs beyond the transaction: facts the caller reads from the accounts, the payers and the transfers. */
export interface DuplicateContext {
  /** The ids of the accounts this device lists; empty means "not read yet", and nothing is offered until it is. */
  known: ReadonlySet<string>;
  /** Who paid, for a purchase in a shared workspace; null when it is not one. */
  payer: { mine: boolean } | null;
  /** Whether the transaction is this phone's side of a transfer with a partner. */
  memberTransfer: boolean;
}

/**
 * Whether a transaction can be repeated from the Add screen: a purchase, an income or a transfer that is still
 * posted and entirely this person's own. Not another member's purchase (posted against their placeholder, which the
 * Add form never offers), not a transfer with a partner (it is recorded once in the group's log and copied here as
 * a plain transfer it would no longer be), and not what `isEditable` refuses. A trade or a purchase filed in
 * another workspace is the caller's refusal (`useChangeable`), as it is for Edit.
 */
export function canDuplicate(tx: TransactionView, context: DuplicateContext): boolean {
  if (!isEditable(tx) || context.known.size === 0) return false;
  if (postedAgainstPlaceholder(tx, context.known)) return false;
  if (context.payer && !context.payer.mine) return false;
  return !context.memberTransfer;
}

/**
 * A transaction as the start of a new one: every entry field it has (mode, accounts, category or splits, note, the
 * same date, the event, the currency), and none of what belongs to the original alone — its pictures, the fact of
 * being an edit, the set-aside link (`goalId`, whose choice is not copied either) and the old charge. A foreign
 * purchase keeps its currency but starts with the charge empty, so the day's rate estimates it again and follows the
 * new amount; a kept charge reads as typed by the user and would post the new amount with the old charge.
 */
export function duplicateDraft(tx: TransactionView, accounts: readonly AccountRow[], bookId = ''): FormDraft {
  return { ...formFromTransaction(tx, accounts, bookId, []), editing: false, photoIds: [], goalId: '', chargedAmount: '' };
}

/**
 * What a typed expression settles to, written the way `parseMajor` will read it again — null when it cannot be
 * read at all.
 *
 * This is the **one** reader of a typed figure in the whole kit. The desktop field's blur and Enter and the
 * phone's DONE all come through here, so the keypad cannot drift into a second, weaker arithmetic of its own:
 * a copy of these two lines is exactly how a 100x error lives on a path no test walks.
 */
export function settledAmount(value: string, currency: string, refund = false, fractional?: RoundDirection): string | null {
  const read = evaluateExact(value, currency, { refund, fractional });
  if (read === null) return null;
  // Cents on a whole-unit currency stay on screen until the save, written in hundredths the same reader reads back
  // to the same figure ("12500.30"): the save rounds them, never DONE.
  return read.exactHundredths === null ? minorToMajorString(read.minor, currency) : hundredthsText(read.exactHundredths, read.minor < 0);
}

/** An exact figure in hundredths as the field's text: "12500.30", with a minus for a refund. */
const hundredthsText = (exact: number, negative: boolean) => `${negative ? '-' : ''}${Math.floor(exact / 100)}.${String(exact % 100).padStart(2, '0')}`;

/**
 * The desktop amount field's Enter: work the expression out, and hold the save back until it stops changing.
 *
 * An expression that cannot be read leaves what was typed alone rather than clearing it, the same bargain DONE
 * makes on the phone, and lets the form submit so a plainly typed figure is never trapped behind an Enter that
 * does nothing.
 */
export function amountAfterEnter(value: string, currency: string, refund = false, fractional?: RoundDirection): { text: string; submit: boolean } {
  const text = settledAmount(value, currency, refund, fractional);
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
export function amountAfterDone(value: string, currency: string, refund = false, fractional?: RoundDirection): { text: string; close: boolean } {
  const text = settledAmount(value, currency, refund, fractional);
  return text === null ? { text: value, close: false } : { text, close: true };
}

/**
 * How the phone's amount row shows a figure it is not typing: grouped the way the app writes money — "85.000",
 * "120,00" — as the approved mockup draws it (B2). Display only: the text in the draft is untouched, so what is
 * parsed on Save is exactly what was typed.
 *
 * Only a **settled** figure is grouped — one `settledAmount` would write back unchanged. An expression still being
 * typed ("120000+35000"), or anything that cannot be read, is shown exactly as it stands, so the keypad never
 * shows a figure other than the one it is holding.
 */
export function amountFace(value: string, currency: string, refund = false, fractional?: RoundDirection): string {
  if (value === '' || !currency || settledAmount(value, currency, refund, fractional) !== value) return value;
  const read = evaluateExact(value, currency, { refund, fractional });
  if (read === null) return value;
  // A figure with cents on a whole-unit currency is drawn with them, as typed: they are on screen until the save.
  const [magnitude, exponent] = read.exactHundredths === null ? [Math.abs(read.minor), currencyInfo(currency).exponent] : [read.exactHundredths, 2];
  // A refund is written with a true minus, the way the keypad's key draws it.
  const face = new Intl.NumberFormat('id-ID', { minimumFractionDigits: exponent, maximumFractionDigits: exponent }).format(magnitude / 10 ** exponent);
  return read.minor < 0 ? `−${face}` : face;
}

/** The dock's keys, read left to right, top to bottom. DONE spans two rows; there is deliberately no Save. */
export const KEYPAD_KEYS = ['C', '÷', '×', '⌫', '7', '8', '9', '−', '4', '5', '6', '+', '1', '2', '3', 'DONE', '0', '000', '00'] as const;

export type KeypadKey = (typeof KEYPAD_KEYS)[number] | ',';

/**
 * The dock's keys for one currency. A currency with cents — dollars, euros — trades the 00 key for a decimal comma,
 * the separator the app writes amounts with; one without (the rupiah) keeps 00, which is how rupiah amounts are
 * typed — except on the one field that takes cents (`MoneyFieldSpec.fractional`), the single amount, where the
 * comma is how a charge of 12.500,30 is typed at all.
 */
export function keypadKeys(currency: string, fractional?: RoundDirection): readonly KeypadKey[] {
  return currencyInfo(currency).exponent > 0 || fractional ? KEYPAD_KEYS.map((key) => (key === '00' ? ',' : key)) : KEYPAD_KEYS;
}

/** What one key does to the typed text. DONE is not here; `amountAfterDone` is what DONE does. */
export function keypadPress(value: string, key: Exclude<KeypadKey, 'DONE'>): string {
  if (key === 'C') return '';
  if (key === '⌫') return value.slice(0, -1);
  if (key === ',') {
    // One comma per figure: the figure being typed is what follows the last operator.
    const current = value.split(/[+−×÷]/).pop() ?? '';
    if (current.includes(',')) return value;
    return value + (current === '' ? '0,' : ',');
  }
  return value + key;
}

/**
 * What any one key does to the dock: the row's new text, and whether the dock is finished.
 *
 * The whole decision lives here rather than in the component, so `Keypad.tsx` holds no arithmetic of its own —
 * it holds one call. A keypad that decides anything for itself is a second money path, and a second money path
 * is where a 100x error sits untested for as long as nobody mounts it.
 */
export function keypadAction(value: string, currency: string, key: KeypadKey, refund = false, fractional?: RoundDirection): { text: string; close: boolean } {
  if (key === 'DONE') return amountAfterDone(value, currency, refund, fractional);
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
 * What the "Charged in …" row should hold right now, or null to leave it exactly as it is.
 *
 * **The row that posts must never show a conversion of an amount the user has already typed past.** The rule is
 * one line: while the row still belongs to the estimate, it *is* the estimate — every keystroke of the amount,
 * and no keystroke later. `touched` is what hands the row to the user; nothing else does, and in particular
 * "the row is empty" does not. That was the old test, and it is why `¥120` pre-filled Rp 2.270: the first
 * keystroke — `1` — filled the row, and from the second keystroke on the row was no longer empty, so the
 * estimate stopped being written and the figure for ¥1 stayed there to be posted.
 *
 * A row the user has written in, or deliberately cleared, is theirs and is never written over again; an
 * untouched row follows the amount down to empty as well as up, because a leftover conversion of an amount that
 * is no longer on screen is the same lie in the other direction.
 */
export function prefilledCharge({ estimate, charged, touched }: { estimate: string | null; charged: string; touched: boolean }): string | null {
  if (touched) return null;
  const next = estimate ?? '';
  return next === charged ? null : next;
}

/**
 * Whether the charged figure is still the app's own guess — which is what the ≈ in front of it says.
 *
 * The row carries one mark rather than a line of prose: ≈ while the figure is the estimate this form worked
 * out at the day's rate, nothing once the figure is the user's. `touched` is the row's own record of who wrote
 * it last, the same one `prefilledCharge` reads, so the mark and the pre-fill can never disagree about whose
 * figure is on screen. An empty row is marked by neither: there is no guess to qualify.
 */
export function chargedIsEstimate({ value, touched }: { value: string; touched: boolean }): boolean {
  return !touched && value.trim() !== '';
}

/**
 * The day the rate row is dated by (§5.2): the Buy / sell tab's own purchase day, every other tab's transaction
 * day — never later than today, exactly as `resolveRates` resolves it. §m4 (8e9): a trade's own day, not the
 * transaction date left over from a tab visited earlier, is what a missing rate is asked and stored for.
 */
export function rateDateFor(draft: FormDraft): string {
  const onDate = draft.mode === 'trade' ? draft.purchase.occurredOn : draft.occurredOn;
  return onDate > isoDate() ? isoDate() : onDate;
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
