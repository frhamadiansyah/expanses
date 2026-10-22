import { CASH_ITEMS, isoDate, type MoneyAccountSubtype, type PaymentOption, tradeRateNeeds } from '@expanses/core';
import {
  type AccountRow,
  type CardRow,
  editMemberTransfer,
  itemIdOf,
  listAccounts,
  guessCategoryFromHistory,
  memberTransfersOf,
  moveIntoSharedEvent,
  ownerScope,
  sharedEventOf,
  paidFromAccount,
  type PaidWithItem,
  type SetAsideChoice,
  type NoteSuggestion,
  postTransaction,
  recordMemberTransfer,
  recordTaggedTransfer,
  replaceTransaction,
  settledBeforeAppOf,
  saveMerchantMcc,
  splitBill,
  type TransactionView,
  uncategorisedCategory,
} from '@expanses/db';
import { ArrowDownLeft, ArrowUpRight, Check, CreditCard, Hash, Home, Landmark, Layers, Shapes, Split, Target } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { canPayWith, canReceiveInto, canTransferBetween, canTransferWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useAccountsFor, useInvalidateAll, useIsBookShared, useResolveRates } from '../../lib/queries';
import { Card, cx, ErrorBox, InputRow, RowHint } from '../../ui';
import { PushedTitle, SegmentedControl } from '../../ui/native';
import { useCards, useCardsWithArchived } from '../cards/card-queries';
import { useEvents } from '../events/queries';
import { useSharedEventSummaries } from '../events/shared-queries';
import { CategoryOptions } from '../cards/options';
import { CategoryIcon } from '../categories/CategoryIcon';
import { fitsEventSet } from '../categories/offered';
import { useCategorySetMembership } from '../categories/set-queries';
import { useCanHold, useGoals, useSetAsideChoiceOf } from '../goals/queries';
import { doorOfForm, postForDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { useAssetProfiles, useAssetValues } from '../networth/queries';
import { assetKindTile } from '../ownables/catalogue-view';
import { useActiveNetWorthGroup, usePaidWithItems } from '../sharing/net-worth-queries';
import { usePurchasePayers } from '../sharing/queries';
import { useOpenBook } from '../workspaces/queries';
import { WorkspaceSheet } from '../workspaces/WorkspaceSheet';
import { AmountRow } from './AmountRow';
import { buyChoices, emptyPurchaseDraft, type PurchaseDraft, transferTargets } from './buy-in-form';
import { amountRowText, chargedRowText, feeRowText, goalRowText, holdingFace, holdingRowText, payRowText, unitsRowText } from './buy-rows';
import { DateRow, NoteRow } from './CardRows';
import { CategoryPicker } from './CategoryPicker';
import { ChoiceSheet } from './ChoiceSheet';
import { useOpenings } from '../accounts/queries';
import { Chevron, FieldRow, FormRow, FormRows, MoneyFieldRow, ROW_BODY, RowGlyph, RowLead, SelectFormRow } from './FormRow';
import { MoreDetails } from './MoreDetails';
import { NoteSuggestions } from './NoteSuggestions';
import { partnerTitle, partnerTransferSections } from './member-transfer';
import { TransferRates } from './TransferRates';
import { WithdrawalLine } from './WithdrawalLine';
import { PaymentSheet, chosenPayment, removedCardPayment, sharedTitle } from './PaymentSheet';
import { useTransactionPhotoIds } from './queries';
import { paymentOptions, placeholderLabel, withoutPlaceholders } from './quick-row';
import { extraRowRefusal, extraRows, postingCurrency } from './tx-form';
import { SplitSheet, splitSummary } from './SplitSheet';
import { PhotosSheet } from './PhotosSheet';
import { draftIn } from './move-workspace';
import { useBooks, useCategoryBooks } from '../workspaces/queries';
import { applyReceipt, filledLine, type ReceiptFilled, readReceiptPhoto } from './receipt-fill';
import { autoCategoryOutOfSet, categoryFromNote, categoryLater, type CategorySource, initialCategorySource, currencyChoosable, currencyFlag, isRefund, withCategoryLater, detailsToggleLabel, duplicateDraft, emptyForm, type CardSeed, type ExtraRow, type FormDraft, type FormMode, formFromTransaction, formToMemory, formToPost, memberTransferOf, typedCurrency, ownTransferAccountId, rateDateFor, receivedField, sayPaidWithError, seeded, sharedPaymentOf, transferFigure } from './tx-form';
import { ratesForSave, submitTrade } from './tx-save';

/**
 * The accounts a money field may name — the old form's own list, unchanged, for the rows Tasks 11 and 12 turn
 * into sheets of their own (a transfer's To, and what a purchase was paid with).
 */
function MoneyAccountOptions({ accounts, spendableOnly, keep, placeholders }: { accounts: AccountRow[]; spendableOnly?: boolean; keep?: string; placeholders?: ReadonlySet<string> }) {
  // A placeholder (§4.4) is never offered; the one the row already names stays, as who paid (final review, minor 2).
  const money = moneyHolders(accounts).filter((a) => (!spendableOnly || canPayWith(a, keep)) && (!placeholders?.has(a.id) || a.id === keep));
  return (
    <>
      <option value="">Choose…</option>
      <optgroup label="Accounts">
        {money.filter((a) => a.kind === 'asset').map((a) => (
          <option key={a.id} value={a.id}>{placeholders?.has(a.id) ? placeholderLabel(a.name) : `${a.name} (${a.currency})`}</option>
        ))}
      </optgroup>
      <optgroup label="Credit cards & debts">
        {money.filter((a) => a.kind === 'liability').map((a) => (
          <option key={a.id} value={a.id}>{`${a.name} (${a.currency})`}</option>
        ))}
      </optgroup>
    </>
  );
}

/** Stands in for Uncategorised while the ✓ asks whether the form would post; Save files under the real one. */
const CATEGORY_LATER = '\u0000category-later';

/** What a draft cannot carry to the ledger: `confirmDraft` posts one category, paid by one account. */
const DRAFT_OMITS: readonly ExtraRow[] = ['split', 'with'];
/** Extras drawn on the card rather than under Add more details: Split on the Category row, Channel on Note's glyph. */
const ON_CARD: readonly ExtraRow[] = ['split', 'channel'];

// The Note and Date rows, and how they read a day, are shared with a shared event's card (`CardRows`).
export { dayLabel, stepDay } from './CardRows';

/**
 * What a caller finishing something already half-read hands the card — Review, opening a captured draft. The card
 * stays an add: the fields start from `prefill` instead of empty, and Save is the caller's (`onSubmit`) because a
 * draft is confirmed rather than posted. A capture is recorded as an expense, income or a transfer only, so the
 * card offers nothing a draft cannot carry: no Buy / sell tab, no workspace switch, no split, no With, no partner's
 * items.
 */
export interface CardFinish {
  /** The form's fields, spread over an empty form. */
  prefill: Partial<FormDraft>;
  /** Saves the form in the caller's own way; a throw is shown on the card, as a failed save is. */
  onSubmit: (draft: FormDraft, setAside: SetAsideChoice | null) => Promise<void>;
  /** A condition of the caller's on top of the card's own, for when the ✓ lights. */
  canSubmit?: (draft: FormDraft) => boolean;
  /** The ✓'s name. */
  saveLabel?: string;
  /** Drawn above the card's tabs: what the form was filled from. */
  header?: ReactNode;
  /** Drawn under Add more details. */
  footer?: ReactNode;
  /**
   * A money row that asks rather than offers, drawn on the warning panel while it is empty: an account only the
   * owner can name. `side` is which row asks; picking there is also `onAnswer`.
   */
  accountAsk?: { side: 'money' | 'to'; label: string; note: string; onAnswer: (accountId: string) => void };
  /** The figure was read without certainty: the amount is marked for checking. */
  amountUnsure?: boolean;
}

/**
 * A save that answers something more than the ledger — "Buy it now", whose payment is also the item it bought.
 *
 * The card stays an add and posts as it always does; this only asks one question before anything is written and
 * hands over the id afterwards. `refuse` is asked first, so a draft the follow-up could not use leaves no
 * transaction behind. `posted` is handed the new transaction's id once it is written, and takes the screen's way out
 * itself in place of `onDone`, because where to go next is part of its answer. A throw from it is shown on the card.
 */
export interface CardFollowUp {
  refuse: (draft: FormDraft) => string | null;
  posted: (transactionId: string) => Promise<void>;
  /** Drawn above the card's tabs: what the form was filled from. */
  header?: ReactNode;
}

/**
 * Add Transaction, as one card.
 *
 * It replaces the old `TransactionForm` wholesale, so it has to carry everything that form carried: it is the
 * only way into a transaction, and an entry point that quietly drops a field is a field nobody can record any
 * more. §B2's rows — Workspace, Paid with, Amount, Category, Note, Date — are built from Task 8's kit; the
 * remaining fields keep the shapes they have today until Tasks 11–15 turn each into a row of its own.
 *
 * Nothing here reads a typed figure: `AmountRow` owns the amount and `formToPost` owns what is posted, so the
 * card never gets a second opinion about what a number means.
 */
export function TransactionCard(props: {
  initial?: TransactionView;
  /**
   * Start an add from this transaction: every entry field is copied, the amount is selected to be typed over, and
   * Save posts a new, independent transaction. Never an edit — `initial` is what edits.
   */
  duplicateOf?: TransactionView;
  mode?: FormMode;
  /** A new transaction's fields, filled in before the form opens: the page it was opened from knows them. */
  seed?: CardSeed;
  /** Opened for one kind only (Spend, Receive, Transfer on an account): no tabs, the sheet's title says which. */
  fixedMode?: boolean;
  /**
   * Save lives in the sheet's header (✕ … ✓) rather than a bar at the card's foot: the form takes this id so the
   * header's ✓ can submit it, and says whether it would save so the ✓ is dimmed until then.
   */
  headerSave?: { formId: string; onReady: (ready: boolean) => void };
  onDone: () => void;
  full?: boolean;
  label?: string;
  /** On a screen of its own: the bar's name and its way back. The card draws the bar, because Save lives in it. */
  title?: string;
  onBack?: () => void;
  /** Opened on something already half-read, saved by the caller: see `CardFinish`. */
  finish?: CardFinish;
  /** Posted by the card, then answered by the caller with the new id: see `CardFollowUp`. */
  followUp?: CardFollowUp;
  /**
   * Told when a save begins, before anything is written. An edit voids the transaction it opened, so its screen,
   * which reads that transaction, has to know the void is its own doing and not a reason to send anyone away.
   */
  onSaveStart?: () => void;
}) {
  // An edit can read a placeholder the purchase is already posted against: one another member paid for (§4.4).
  const accounts = useAccountsFor(props.initial ?? props.duplicateOf);
  // The pictures this transaction already has, so reopening one that has a receipt does not say "Photos: None".
  // `ready` is the reader's own answer about when it may be read.
  const photos = useTransactionPhotoIds(props.initial?.id ?? null);
  // The draft is built from the accounts once, so it must not be built before they are here: `formFromTransaction`
  // reads each account's currency, and a draft seeded from an empty list opens a foreign purchase with no currency.
  // The same holds for the photo rows: a draft seeded before they arrive opens an edit with none of them.
  if (!accounts.isSuccess || !photos.ready) return <Card>Loading…</Card>;
  return <CardBody {...props} accounts={accounts.data} photoIds={photos.ids} />;
}

function CardBody({
  initial,
  duplicateOf,
  mode,
  seed,
  fixedMode,
  headerSave,
  onDone,
  full,
  label,
  title,
  onBack,
  finish,
  followUp,
  onSaveStart,
  accounts: ownAccounts,
  photoIds,
}: {
  initial?: TransactionView;
  duplicateOf?: TransactionView;
  mode?: FormMode;
  seed?: CardSeed;
  fixedMode?: boolean;
  headerSave?: { formId: string; onReady: (ready: boolean) => void };
  onDone: () => void;
  full?: boolean;
  /** The form's accessible name, on a screen of its own where no sheet's title names it. */
  label?: string;
  title?: string;
  onBack?: () => void;
  finish?: CardFinish;
  followUp?: CardFollowUp;
  onSaveStart?: () => void;
  accounts: AccountRow[];
  photoIds: string[];
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const openBook = useOpenBook();
  const bookId = ws.bookId ?? '';
  // Joint net worth §7.1: the partner's placeholder a shared item was picked onto, which this device's list leaves out.
  const [picked, setPicked] = useState<AccountRow[]>([]);
  const accounts = useMemo(
    () => (picked.length ? [...ownAccounts, ...picked.filter((p) => !ownAccounts.some((a) => a.id === p.id))] : ownAccounts),
    [ownAccounts, picked],
  );
  // The partner's shared items Paid with offers, in the group's workspace only (D14), and what the edited purchase says.
  const netWorthGroup = useActiveNetWorthGroup();
  const paidWith = usePaidWithItems(bookId);
  const bookShared = useIsBookShared();
  const savedPayer = usePurchasePayers(initial ? [initial.id] : [], bookShared);
  const allCards = useCards().data ?? [];
  // Removed cards too, read only to name the one an older purchase was made on: never offered to pay with.
  const everyCard = useCardsWithArchived().data ?? [];
  const goals = useGoals().data ?? [];
  const assetValues = useAssetValues();
  // What this device lists, placeholders left out; `accounts` may also hold one the edited purchase names.
  const listed = useAccounts();
  const listedIds = new Set((listed.data ?? accounts).map((a) => a.id));
  // The placeholders among `accounts`: what the edited purchase names that this device's own list leaves out (§4.4).
  const placeholders = new Set(accounts.filter((a) => !listedIds.has(a.id)).map((a) => a.id));
  const assetProfiles = useAssetProfiles();
  const [draft, setDraft] = useState<FormDraft>(() =>
    initial
      ? formFromTransaction(initial, accounts, bookId, photoIds)
      : duplicateOf
        ? duplicateDraft(duplicateOf, accounts, bookId)
        : { ...emptyForm(bookId), mode: mode ?? 'expense', ...seeded(seed, accounts), ...finish?.prefill },
  );
  /*
   * Who filled Category. One the form opened with — an edit, a duplicate, a capture already filed — counts as chosen
   * by hand: the note's history only ever fills a category nobody chose, and only follows one it filled itself.
   */
  const prefilled = !!initial || !!finish || !!duplicateOf;
  const categorySource = useRef<CategorySource>(draft.categoryId ? 'hand' : initialCategorySource(prefilled));
  const latest = useRef(draft);
  latest.current = draft;
  /*
   * A receipt photo fills what is still empty — amount, note, date — and says so under the card with an Undo that
   * puts those fields back. Read on the phone; a picture that cannot be read fills nothing and is still attached.
   */
  const [receipt, setReceipt] = useState<ReceiptFilled | null>(null);
  const [readingReceipt, setReadingReceipt] = useState(false);
  async function readReceiptFrom(files: readonly File[]) {
    const file = files.find((one) => one.type.startsWith('image/'));
    // Only a new expense is filled from its receipt; a saved one is a correction, and its photo is only kept.
    if (!file || latest.current.mode !== 'expense' || latest.current.editing) return;
    setReadingReceipt(true);
    const fill = await readReceiptPhoto(file, postingCurrency(latest.current, accounts, ws.baseCurrency));
    setReadingReceipt(false);
    if (!fill) return;
    const now = latest.current;
    const { next, filled } = applyReceipt(now, fill, {
      postingCurrency: postingCurrency(now, accounts, ws.baseCurrency),
      today: isoDate(),
      foreignAllowed: currencyChoosable(now),
    });
    if (!filled) return;
    // Only the fields a receipt fills: the photo it came on may have joined the draft since it was read.
    setDraft((d) => ({ ...d, amount: next.amount, currency: next.currency, description: next.description, occurredOn: next.occurredOn }));
    setReceipt(filled);
  }
  const undoReceipt = () => {
    if (receipt) setDraft((d) => ({ ...d, ...receipt.before }));
    setReceipt(null);
  };

  const [sheet, setSheet] = useState<null | 'workspace' | 'money' | 'category' | 'to' | 'goal' | 'split' | 'move' | 'photos' | 'feeCategory'>(null);
  /*
   * A saved transaction moved to another workspace on its Edit screen: the workspace it goes to, or null while it stays.
   * Its category is swapped for that workspace's copy as the move is chosen, and the save says to move it.
   */
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const allBooks = useBooks().data ?? [];
  const categoryBooks = useCategoryBooks().data ?? {};
  // Add more details opens in place, under the card, rather than over it: the extras are part of the one form.
  // Opened from an event it starts open, because the Event row it fills in lives there and should be seen set.
  const [detailsOpen, setDetailsOpen] = useState(() => !!draft.eventId && !!seed?.eventId);
  const formRef = useRef<HTMLFormElement>(null);
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  /*
   * The payment a follow-up was handed, once it is written: see the first lines of `submit`. The ref is what Save
   * reads, so a second press can never post a second payment; the flag is what the form draws from it.
   */
  const written = useRef<string | null>(null);
  const [recorded, setRecorded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<FormDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setPurchase = (patch: Partial<PurchaseDraft>) => setDraft((d) => ({ ...d, purchase: { ...d.purchase, ...patch } }));

  /*
   * The set the chosen event draws on, if any: Category then offers that set's categories in place of the monthly
   * tree, as the event page's own Add spending form did before it opened this screen instead. Read off the Event
   * row, so it follows the row however it was set — by the address an event opened this screen with, or by hand.
   */
  const events = useEvents().data ?? [];
  // The shared events among them: tagging an existing purchase into one moves it there (shared events §6).
  const sharedSummaries = useSharedEventSummaries().data ?? {};
  const eventSet = draft.eventId ? (events.find((event) => event.id === draft.eventId)?.setId ?? null) : null;
  /*
   * What Category may hold while recording into that set: its own categories, as the picker offers. A category the
   * form fills by itself — the note's guess, a note suggestion's — is asked the same question, or a renovation's
   * "Indomaret" lands in the monthly Groceries the set's list never offers. Read through a ref by the guess, which
   * answers a quarter of a second after the typing and must judge by the Event row as it is then.
   */
  const membership = useCategorySetMembership();
  const fitsSet = (categoryId: string) => fitsEventSet(categoryId, membership.data ?? {}, eventSet);
  const fitsRef = useRef(fitsSet);
  fitsRef.current = fitsSet;
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const choices = useMemo(() => buyChoices(assetValues.data ?? [], assetProfiles.data ?? []), [assetValues.data, assetProfiles.data]);
  const account = byId.get(draft.moneyId);
  const purchase = draft.purchase;
  const chosen = [...choices.buys, ...choices.sells].find((option) => option.value === `${purchase.mode}:${purchase.accountId}`);
  const purchaseMoney = byId.get(purchase.moneyId);
  const purchaseCurrency = byId.get(purchase.accountId)?.currency ?? ws.baseCurrency;
  // The paying or receiving account's currency; with none chosen yet, the holding's own (nothing crosses).
  const purchaseCashCurrency = purchaseMoney ? (purchaseMoney.currency ?? ws.baseCurrency) : purchaseCurrency;
  const purchaseNeeds = tradeRateNeeds(purchaseCurrency, purchaseCashCurrency, ws.baseCurrency);
  const toAccount = byId.get(draft.toId);
  // The Received row reads the same record the save reads (`receivedField`), so the two cannot disagree on its currency.
  const received = receivedField(draft, accounts);
  const crossCurrency = received !== null;
  const canHold = useCanHold();
  // What Save would send, read by the function that builds it (a category not chosen yet does not hide the door).
  const post = useMemo(() => postForDoor(draft, accounts), [draft, accounts]);
  const door = post ? doorOfForm(draft, post, accounts, canHold) : null;
  const saved = useSetAsideChoiceOf(initial?.id ?? null);
  const setAside = useSetAside(door, { excludeTransactionId: initial?.id ?? null, initial: saved.data ?? null, toName: toAccount?.name });

  /*
   * One list per question, because the label asks three different things. A purchase is paid with money you can spend
   * from, or with a card that settles later. Income is received into money you hold — a broker's cash included,
   * where a dividend or a coupon lands. A transfer moves money between the accounts money can move between. A loan,
   * a person's account and a thing you own are on none of them: an instalment is paid, a person is settled, a house
   * is bought through flows of their own. The account the row already names is kept, so an old row opens as saved.
   */
  const namedBy = draft.mode === 'transfer' ? canTransferWith : draft.mode === 'income' ? canReceiveInto : canPayWith;
  // A transfer's From also has to pair with the To already chosen: a broker's cash moves only with a current account.
  const pairsWithTo = (a: AccountRow) => draft.mode !== 'transfer' || !toAccount || a.id === draft.moneyId || canTransferBetween(a, toAccount);
  const money = moneyHolders(accounts).filter((a) => namedBy(a, draft.moneyId) && pairsWithTo(a));
  // A card is a way to pay, never somewhere money arrives or moves to.
  // Never a placeholder to choose; the one the row names stays as its current value (final review, minor 2).
  // Joint net worth §7.1: the partner's shared item Paid with names now, if any; its placeholder is then no row of its own.
  const sharedPaying = sharedPaymentOf(draft, initial ? savedPayer(initial.id) : null);
  const payable: PaymentOption[] = withoutPlaceholders(
    paymentOptions(money, draft.mode === 'expense' || draft.mode === 'trade' ? (allCards as CardRow[]) : []),
    listedIds,
    sharedPaying ? '' : draft.moneyId,
  );
  const sharedItem = sharedPaying ? (paidWith.data ?? []).find((item) => item.itemId === sharedPaying.itemId) : undefined;
  // What Paid with reads while it names a partner's item: the item's name, and whose it is; an item no longer shared keeps the saved label.
  const sharedShown = sharedPaying
    ? {
        value: sharedItem?.name ?? (initial ? (savedPayer(initial.id)?.paidLabel ?? '') : ''),
        caption: sharedItem ? sharedTitle(sharedItem.ownerName) : 'Shared',
      }
    : null;
  /** Picking a partner's item (§7.1): the money side goes on their placeholder here, which the item's owner's phone reads as the item. */
  async function payWithShared(item: PaidWithItem) {
    try {
      const id = await paidFromAccount(database, bookId, item.owner, item.currency);
      if (!accounts.some((a) => a.id === id)) {
        const row = (await listAccounts(database, ws, { includeArchived: true, includePlaceholders: true })).find((a) => a.id === id);
        if (row) setPicked((rows) => [...rows, row]);
      }
      set({ moneyId: id, cardId: '', paidFrom: { owner: item.owner, itemId: item.itemId } });
    } catch (e) {
      setError(e);
    }
  }

  /*
   * Joint net worth §7.2: a transfer with a partner. To lists their shared items — and From, for money received from
   * them — in the group's workspace only, and only those in the other side's currency. The transfer is recorded once in
   * the group log; a side of one being corrected is corrected as the transfer (`editMemberTransfer`).
   */
  const workspaceName = openBook?.name ?? 'the household';
  const partnerWhere = { formBookId: draft.bookId, groupWorkspaceBookId: netWorthGroup.data?.workspaceBookId };
  const partnerItem = draft.mode === 'transfer' && draft.partner ? (paidWith.data ?? []).find((i) => i.itemId === draft.partner!.itemId) : undefined;
  const partnerShown = draft.mode === 'transfer' && draft.partner
    ? { value: partnerItem?.name ?? '', caption: partnerTitle(partnerItem?.ownerName ?? null, workspaceName) }
    : null;
  const toPartners = draft.mode === 'transfer' && draft.partner?.side !== 'from' && !initial
    ? partnerTransferSections(paidWith.data ?? [], partnerWhere, draft.moneyId ? byId.get(draft.moneyId)?.currency : null, workspaceName)
    : [];
  const fromPartners = draft.mode === 'transfer' && draft.partner?.side !== 'to' && !initial
    ? partnerTransferSections(paidWith.data ?? [], partnerWhere, draft.toId ? byId.get(draft.toId)?.currency : null, workspaceName)
    : [];
  const partnerOf = (item: PaidWithItem, side: 'to' | 'from') => ({ side, owner: item.owner, itemId: item.itemId, currency: item.currency });
  // The transfer a corrected row is one side of, when it is one: its from, to and currency never change.
  const savedTransferQuery = useQuery({
    queryKey: ['member-transfer', initial?.id ?? ''],
    queryFn: async () => (initial ? ((await memberTransfersOf(database, [initial.id]))[initial.id] ?? null) : null),
    enabled: !!initial,
  });
  // Corrected as the transfer only while it is the current group's; a side of an ended group is this phone's own row.
  const savedTransfer =
    savedTransferQuery.data && netWorthGroup.data && savedTransferQuery.data.groupBookId === netWorthGroup.data.groupBookId && !savedTransferQuery.data.transferVoid
      ? savedTransferQuery.data
      : null;
  // Until both are read, an edit does not know which way it saves: From, To and Save wait (review round 1).
  const transferUnknown = !!initial && (!savedTransferQuery.isFetched || netWorthGroup.isPending);
  const accountsLocked = !!savedTransfer || transferUnknown;
  // An expense or income, saved, can move to another workspace from its Workspace row; a transfer belongs to none.
  const canMove = !!initial && !finish && !accountsLocked && (draft.mode === 'expense' || draft.mode === 'income') && allBooks.length > 1;

  /*
   * The workspace row and the open workspace are the same fact, so the row follows the app rather than keeping a
   * second answer. Changing it clears the category: two workspaces hold copies of the same category under
   * different ids, and a category chosen in one of them would file this spending in the other.
   */
  useEffect(() => {
    if (draft.bookId === bookId) return;
    if (!prefilled) categorySource.current = null;
    setDraft((d) => ({ ...d, bookId, categoryId: '', splits: [] }));
  }, [bookId, draft.bookId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    // Enter submits too: the question is a condition on Save however Save is reached.
    if (!setAside.ready) return;
    setError(null);
    setBusy(true);
    try {
      if (transferUnknown) return;
      onSaveStart?.();
      /*
       * A payment already written for a follow-up that then refused (an item deleted on another phone meanwhile, or a
       * failure linking it): Save never posts again — that would record one purchase twice for one press too many.
       * It asks the follow-up again, or, when the screen no longer has one to ask (the item is gone from the plan),
       * just leaves. The lists hear about it either way: the app reads them once and keeps them, so a plan not told
       * would go on showing the item unbought, and buying it a second time is exactly what this guards against.
       */
      const paid = written.current;
      if (paid) {
        try {
          if (followUp) await followUp.posted(paid);
        } finally {
          await invalidate();
        }
        if (!followUp) onDone();
        return;
      }
      if (finish) {
        await finish.onSubmit(draft, setAside.choice);
        await invalidate();
        onDone();
        return;
      }
      if (initial && savedTransfer && netWorthGroup.data) {
        // A side of a transfer with a partner: its date, figure and note are the transfer's, and both phones follow.
        const own = byId.get(draft.moneyId)?.currency ?? byId.get(draft.toId)?.currency ?? ws.baseCurrency;
        await editMemberTransfer(database, netWorthGroup.data.workspaceBookId, savedTransfer.transferId, {
          occurredOn: draft.occurredOn,
          amountMinor: transferFigure(draft, own),
          // The row's own words ("Transfer to Andi") are this phone's; only a note typed here becomes the transfer's.
          ...(draft.description !== initial.description ? { description: draft.description.trim() || null } : {}),
        });
        await invalidate();
        onDone();
        return;
      }
      if (draft.mode === 'transfer' && draft.partner) {
        const group = netWorthGroup.data;
        if (!group) throw new Error('The household no longer shares net worth');
        const ownItemId = await itemIdOf(group.groupBookId, ownTransferAccountId(draft));
        await recordMemberTransfer(database, bookId, memberTransferOf(draft, accounts, group.me, ownItemId));
        await invalidate();
        onDone();
        return;
      }
      // Before anything is written — Uncategorised included, which the next line may create.
      const refusal = followUp?.refuse(draft);
      if (refusal) throw new Error(refusal);
      // "Choose later": an expense or an income saved with no category is filed under its kind's Uncategorised,
      // made the first time one is needed. A capture's draft keeps its own rule (`finish` returned above).
      const later = categoryLater(draft);
      const filed = later ? withCategoryLater(draft, await uncategorisedCategory(database, ws, later)) : draft;
      const post = formToPost(filed, accounts);
      let posted: string | null = null;
      if (post.kind === 'trade') {
        // Units are recorded, so this saves as a purchase and never touches spending. Its rates come from the one
        // place every trade form gets them; a missing day rate is asked for under Add more details, dated by the
        // trade. `submitTrade` is the one call, so the set-aside answer cannot be sent on one trade form and
        // dropped on the other.
        await submitTrade({
          database, ws, input: post.input, holdingCurrency: purchaseCurrency, cashCurrency: purchaseCashCurrency,
          needsRate, manualRate: draft.manualRate, resolveRates, onMissing: setNeedsRate, where: 'Add more details',
          setAside: setAside.choice,
        });
      } else {
        // The manual rate, the rates the posting needs and the message asking for a missing one, all in the
        // one place both ways into a save go through. The rate field lives under Add more details and only
        // there (§3.3), so that is the name this screen gives it.
        const ratesToBase = await ratesForSave({
          database, ws, draft: filed, post, accounts, rateDate, needsRate, resolveRates, onMissing: setNeedsRate, where: 'Add more details',
        });
        // Every branch sends the answer — an edit explicitly, so a question no longer asked clears the old answer.
        // The new id is kept from the two that make a purchase, for a follow-up that answers something with it.
        if (post.kind === 'split') posted = (await splitBill(database, ws, { ...post.input, ratesToBase, setAside: setAside.choice })).transactionId;
        else if (post.kind === 'transfer-goal') await recordTaggedTransfer(database, ws, { ...post.input, ratesToBase, setAside: setAside.choice });
        else if (initial) {
          const replaced = await replaceTransaction(database, ws, initial.id, {
            ...post.input,
            ratesToBase,
            setAside: setAside.choice,
            ...(moveTo ? { moveToBook: true } : {}),
            ...(offersAlreadyPaid && savedSettled.isSuccess ? { settledBeforeApp: paidOff } : {}),
          });
          /*
           * Tagged into a shared event by the Event row: it moves there now (shared events §6, D2) — it leaves this
           * workspace and becomes this person's own expense on the event, keeping its card, MCC, photos and points.
           * The edit is saved first, so what moves is the purchase as corrected; a purchase the move keeps (a refund,
           * a split bill) stays here, saved, and the reason is shown.
           */
          if (draft.eventId && draft.eventId !== initial.eventId && sharedSummaries[draft.eventId]) {
            // The day's rates the move converts by: the purchase's currencies and the event's, each to the base.
            const target = await sharedEventOf(database, ownerScope(ws), draft.eventId);
            const wanted = [target?.currency, typedCurrency(filed, accounts), byId.get(filed.moneyId)?.currency].filter((c): c is string => !!c);
            await resolveRates([...new Set(wanted)], filed.occurredOn).catch(() => undefined);
            const { kept } = await moveIntoSharedEvent(database, ownerScope(ws), draft.eventId, [replaced]);
            if (kept.length > 0) throw new Error(kept[0]!.why);
          }
        }
        else posted = await postTransaction(database, ws, { ...post.input, ratesToBase, setAside: setAside.choice, settledBeforeApp: paidOff });
        const memory = formToMemory(filed, accounts);
        if (memory) await saveMerchantMcc(database, ws, memory);
      }
      if (followUp && posted) {
        // The payment is written whatever the follow-up answers, so the lists hear about it either way. It stays
        // written for this form's whole life: a refusal leaves the form open on a payment that already exists.
        written.current = posted;
        try {
          await followUp.posted(posted);
        } catch (e) {
          setRecorded(true);
          throw e;
        } finally {
          await invalidate();
        }
        return;
      }
      await invalidate();
      onDone();
    } catch (e) {
      setError(sayPaidWithError(e, sharedShown?.value));
    } finally {
      setBusy(false);
    }
  }

  // Rates are resolved no later than today, so the row asks for the rate under the date the save will store it.
  const rateDate = rateDateFor(draft);
  const missingRate = needsRate ? { from: needsRate, to: ws.baseCurrency, onDate: rateDate } : null;
  /*
   * Two of §4's extras live on the card itself now: a split is chosen in the category picker and read on the Category
   * row, and online or offline is the Note's own glyph. `extraRows` still says whether each is offered here.
   */
  const offered = extraRows(draft, accounts, { missingRate, sharedBook: bookShared }).filter((row) => !(finish ? DRAFT_OMITS : []).includes(row));
  const offersSplit = offered.includes('split');
  const offersChannel = offered.includes('channel');
  /*
   * A transfer's fee: within one currency (the From account's), and not on a transfer for a goal. Its category starts
   * on the workspace's built-in Fees & charges, the one a fee the app knows of is filed under.
   */
  const feeFrom = accounts.find((account) => account.id === draft.moneyId);
  const feeTo = accounts.find((account) => account.id === draft.toId);
  const feeCurrency = feeFrom?.currency ?? ws.baseCurrency;
  const offersFee = draft.mode === 'transfer' && !draft.goalId && !accountsLocked && (!feeTo || !feeFrom || feeTo.currency === feeFrom.currency);
  const defaultFeeCategory =
    accounts.find((account) => account.systemKey === 'miscellaneous.fees_charges' && (allBooks.length < 2 || categoryBooks[account.id] === ws.bookId))?.id ?? '';
  /*
   * A transfer's second figure, on the Amount row beside what left (option A): what arrived, between two currencies —
   * required, in the To account's — or, within one, its fee. The fee's category is under Add more details.
   */
  const transferSecond =
    draft.mode !== 'transfer'
      ? null
      : received
        ? { field: received, code: received.currency, placeholder: 'Received', onChange: (toAmount: string) => set({ toAmount }) }
        : offersFee
          ? {
              field: { which: 'fee' as const, label: `Fee in ${feeCurrency}`, value: draft.fee, currency: feeCurrency },
              code: 'FEE',
              placeholder: 'Fee',
              onChange: (fee: string) => set({ fee, feeCategoryId: latest.current.feeCategoryId || defaultFeeCategory }),
            }
          : null;
  // Photos live on the Amount row's camera for a purchase, new or saved: its receipt. Income, a transfer and a buy or
  // sell keep them under Add more details.
  const photosOnAmount = draft.mode === 'expense' && offered.includes('photos');
  const splitCurrency = postingCurrency(draft, accounts, ws.baseCurrency);

  // B2 reads a card as its account's name with the digits as the caption — "BCA KrisFlyer · ···· 1467" — and
  // anything else as its name with what the row is for: "BCA Tahapan · Received into".
  const paying = payable.find((option) => option.accountId === draft.moneyId && (option.cardId ?? '') === draft.cardId);
  /*
   * A credit card purchase can be recorded as already paid off: the spending it was, with a settlement beside it so
   * what the card owes today stays as it is. The card's icon on Paid with says so with a tick and is what changes it.
   * Off by default for every date; only a tap on the icon ticks it. A saved one reads back what it was saved as.
   */
  const payingAccount = accounts.find((account) => account.id === draft.moneyId);
  const cardOpening = useOpenings(payingAccount?.subtype === 'credit_card' ? [payingAccount.id] : []);
  const cardStart = payingAccount?.subtype === 'credit_card' ? (cardOpening.data?.[payingAccount.id]?.occurredOn ?? payingAccount.createdAt.slice(0, 10)) : null;
  const offersAlreadyPaid = draft.mode === 'expense' && cardStart !== null && !accountsLocked;
  // A saved purchase reads its answer back from whether a settlement stands beside it; a new one goes by the date.
  const savedSettled = useQuery({
    queryKey: ['settled-before-app', ws.workspaceId, initial?.id ?? ''],
    enabled: !!initial,
    queryFn: () => settledBeforeAppOf(database, ws, initial!.id),
  });
  // Never ticked by itself, whatever the date: the owner says so (asked 22 Oct).
  const paidOff = offersAlreadyPaid && (draft.alreadyPaid ?? (initial ? savedSettled.data === true : false));
  // An older purchase made on a card since removed reads as that card, with its digits, and says it was removed.
  const removedCard = draft.mode === 'expense' || draft.mode === 'trade' ? removedCardPayment(everyCard, accounts, draft.moneyId, draft.cardId) : null;
  // Money back lands in the account it was paid with, so the row says where it goes.
  const payLabel = draft.mode === 'income' ? 'Received into' : draft.mode === 'transfer' ? 'From' : !finish && isRefund(draft) ? 'Into' : 'Paid with';
  const categoryName = draft.categoryId ? (byId.get(draft.categoryId)?.name ?? '') : '';
  // Where a transfer may land: money you hold, by the rule the From list uses — never a motorbike, a laptop or a
  // car, which hold value but receive nothing; never a card or a loan, which are paid through their own Pay; never
  // a time deposit or a loan with a person, which have flows of their own. And only what pairs with the From
  // already chosen. Only what this device lists: a placeholder the edited purchase names (useAccountsFor) is never a
  // place money can be moved to (spec §4.4, fix round 1). The account the row names is kept, so an old transfer
  // opens as it was saved.
  const landing = moneyHolders(transferTargets(accounts.filter((a) => listedIds.has(a.id)), assetValues.data ?? [])).filter(
    (a) => a.id === draft.toId || (canTransferWith(a) && (!account || canTransferBetween(account, a))),
  );
  /*
   * Every row of the card leads with a circle of the same size, so the lead column reads as one column. The rest
   * wear the kit's fill; a chosen category keeps its own colour, as it does everywhere else a category is drawn.
   */
  const categoryLead = draft.categoryId ? (
    <CategoryIcon categoryId={draft.categoryId} accounts={accounts} size="row" />
  ) : (
    <RowGlyph>
      <Shapes size={15} />
    </RowGlyph>
  );
  // What the bar's ✓ answers: whether this would post as it stands — the same question Save asks, asked early.
  const ready = (() => {
    if (busy || !setAside.ready || transferUnknown) return false;
    try {
      if (draft.mode === 'transfer' && draft.partner) memberTransferOf(draft, accounts, '', '');
      // A category left for later is answered at Save (Uncategorised); a capture's draft still needs its own.
      else formToPost(finish ? draft : withCategoryLater(draft, CATEGORY_LATER), accounts);
      return finish?.canSubmit?.(draft) ?? true;
    } catch {
      return false;
    }
  })();

  const onReady = headerSave?.onReady;
  useEffect(() => onReady?.(ready), [onReady, ready]);

  /*
   * What every row of the Buy / sell tab says, worked out once in `buy-rows.ts`: the accessible name each row
   * has always had, and — separately — the caption, the prompt and the hint that are drawn. The tab reads like
   * Expense, Income and Transfer now, and moving the currency onto the flag must not move it out of the name.
   */
  const holdingRow = holdingRowText(purchase.mode);
  const costRow = amountRowText(purchase.mode, purchaseCurrency);
  const unitsRow = unitsRowText({ useLots: purchase.useLots, lotSize: purchase.lotSize, unitLabel: chosen?.unitLabel ?? 'Units' });
  const feeRow = feeRowText(purchaseCurrency);
  const payRow = payRowText(purchase.mode);
  const chargedRow = chargedRowText({ mode: purchase.mode, cashCurrency: purchaseCashCurrency, moneyName: purchaseMoney?.name ?? 'the account' });
  const goalRow = goalRowText(purchase.mode);
  /* The holding wears the drawing the Assets page gives its kind, as a transfer's accounts do in their own list. */
  const HoldingGlyph = assetKindTile('invest', byId.get(purchase.accountId)?.subtype ?? '');

  /*
   * The row that asks rather than offers, while it is still empty: which account a capture's source is. It stands on
   * the warning panel, because it is the one question only the owner can answer, and says under it what answering it
   * does. Picking there is an ordinary pick, and also the answer (`accountAsk.onAnswer`).
   */
  const ask = finish?.accountAsk;
  const asking = ask && (ask.side === 'money' ? !draft.moneyId : !draft.toId) ? ask.side : null;
  const askRow = (glyph: ReactNode, open: () => void) => (
    <button
      type="button"
      onClick={open}
      aria-label={ask!.label}
      className="ph-focus-inset flex w-full items-center gap-[10px] bg-[var(--ph-warn-panel)] pl-[10px] text-left"
    >
      <RowLead>
        <RowGlyph>{glyph}</RowGlyph>
      </RowLead>
      <span className={ROW_BODY}>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] leading-5 font-semibold text-[var(--ph-ink)]">{ask!.label}</span>
          <span className="text-[12.5px] leading-4 text-[var(--ph-warn-ink)]">{ask!.note}</span>
        </span>
        <Chevron />
      </span>
    </button>
  );

  /** Which glyph leads the paying row: a card, a bank for what came in, the account money leaves. */
  const payGlyph = draft.mode === 'income' ? <Landmark size={15} /> : draft.mode === 'transfer' ? <ArrowUpRight size={15} /> : <CreditCard size={15} />;
  const modes = [
    { key: 'expense', label: 'Expense' },
    { key: 'income', label: 'Income' },
    { key: 'transfer', label: 'Transfer' },
    ...(choices.buys.length > 0 && !finish ? [{ key: 'trade', label: 'Buy / sell' }] : []),
  ];
  const chooseMode = (value: FormMode) => {
    if (value === draft.mode) return;
    if (value !== 'trade') {
      // A tab that offers no flag must not carry one. The currency and the "Charged in …" row belong
      // to the tab they were chosen on: leaving USD on the draft while moving to Transfer left the
      // save reading a figure in a currency the screen no longer showed. `currencyChoosable` is the
      // one question about that, asked here too rather than restated.
      const flag = currencyChoosable({ ...draft, mode: value }) ? {} : { currency: '', chargedAmount: '' };
      // A new transaction starts its guessing again on another tab; one that already exists never guesses.
      if (!prefilled) categorySource.current = null;
      return set({ mode: value, categoryId: '', splits: [], ...flag });
    }
    const first = choices.buys[0]!;
    set({
      mode: 'trade',
      purchase: { ...emptyPurchaseDraft(first.accountId, draft.moneyId, isoDate()), lotSize: first.lotSize, useLots: (first.lotSize ?? 1) > 1 },
    });
  };

  /*
   * B2's Note and Date rows (`CardRows`, shared with a shared event's card). Note is still today's Description — the same field, typed in place — drawn as the
   * row's title with ☰ in the lead. Date is ‹ [the day] ›: the arrows step a day, which is nearly always what a
   * correction is, and the middle is the real date input laid over the day it shows, so it is still labelled
   * Date and still opens the browser's own picker.
   */
  /*
   * Notes written before, over the keyboard while Note is typed in; a pick brings the category it was last filed
   * under, but only into an empty Category — one chosen by hand is never overwritten.
   */
  const [noteFocused, setNoteFocused] = useState(false);
  const suggestKind = draft.mode === 'expense' || draft.mode === 'income' ? draft.mode : null;
  const categoryNameOf = (id: string) => accounts.find((a) => a.id === id)?.name;
  const pickNote = (suggestion: NoteSuggestion) => {
    // A suggestion picked is a choice: on a form opened on something that exists it still fills an empty Category, as
    // it always has, and the category then stays the owner's.
    const fill =
      !!suggestion.categoryId && fitsSet(suggestion.categoryId) && draft.splits.length === 0 && (prefilled ? !draft.categoryId : categorySource.current !== 'hand');
    if (fill && !prefilled) categorySource.current = 'auto';
    setDraft((d) => ({ ...d, description: suggestion.description, ...(fill ? { categoryId: suggestion.categoryId! } : {}) }));
  };
  /*
   * Typing the note fills Category with the one that note was last filed under — Expense from spending, Income from
   * income — a quarter of a second after the typing stops. Nothing says where it came from: it reads as a category
   * chosen. While it is only the note's guess it follows the note: a new match replaces it, and no match (an emptied
   * note included) puts the row back to Choose later. Once a category is picked by hand, typing never changes it. A
   * guess that comes back after the note has changed again is dropped.
   */
  useEffect(() => {
    const typed = draft.description.trim();
    if (prefilled || !suggestKind || categorySource.current === 'hand' || draft.splits.length > 0) return;
    if (!typed && categorySource.current !== 'auto') return;
    let stale = false;
    const timer = setTimeout(() => {
      void (typed ? guessCategoryFromHistory(database, ws, typed, suggestKind) : Promise.resolve(null)).then((guess) => {
        const now = latest.current;
        if (stale || now.description.trim() !== typed || now.mode !== suggestKind) return;
        const next = categoryFromNote(now, guess, categorySource.current, fitsRef.current);
        if (next === null) return;
        categorySource.current = next ? 'auto' : null;
        setDraft((d) => ({ ...d, categoryId: next }));
      });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [draft.description, suggestKind, database, ws]);
  /*
   * The Event row changed — or the events and the sets arrived after the guess — and the set it draws on no longer
   * offers the category the note filled in: that guess goes, and the row is back to Choose later. A category picked
   * by hand stays whatever the Event row says; the picker shows what it may be changed to.
   */
  useEffect(() => {
    if (!membership.isSuccess) return;
    if (!autoCategoryOutOfSet(latest.current.categoryId, categorySource.current, fitsRef.current)) return;
    categorySource.current = null;
    setDraft((d) => ({ ...d, categoryId: '' }));
  }, [eventSet, membership.isSuccess, membership.data, draft.categoryId]);
  const body = (
    <form ref={formRef} id={headerSave?.formId} onSubmit={submit} aria-label={label} className="flex flex-col gap-[10px]">
      {finish?.header}
      {/*
        Once the payment is written and only the follow-up is left to answer, the form says so and its fields stop
        taking changes: Save never writes the payment again, so an edit made now would be one nothing reads.
      */}
      {recorded ? <RowHint>{followUp ? 'Payment recorded. Save links it to the item.' : 'Payment recorded.'}</RowHint> : followUp?.header}
      <fieldset disabled={recorded} className="m-0 flex min-w-0 flex-col gap-[10px] border-0 p-0">
      {/* Option B: one card — the four tabs across its top, then every row of the tab under them. */}
      <div className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)]">
        {!fixedMode && (
          <div className="px-3 pt-[10px] pb-[6px]">
            <SegmentedControl label="What this is" segments={modes} value={draft.mode} onChange={(key) => chooseMode(key as FormMode)} />
          </div>
        )}
        {draft.mode === 'trade' ? (
          /*
           * §3.6, as rows: what · amount · units or lots · fee · Paid with / Proceeds into · Date, then a second
           * card for the goal and — only on a credit card — the two facts the points engine needs. There is no
           * workspace row here either: a trade posts through `recordTrade`, whose money half touches no category.
           *
           * `purchaseDraftToInput` and `recordTrade` are called exactly as before; only the layout moved. Every
           * message they throw still arrives in the `ErrorBox` above Save, which is the whole of this tab's
           * validation — nothing here reads a figure for itself.
           */
          <FormRows className="rounded-none">
            <SelectFormRow
              icon={
                <RowGlyph>
                  <HoldingGlyph size={15} />
                </RowGlyph>
              }
              label={holdingRow.label}
              caption={holdingRow.caption}
              hint={holdingRow.hint}
              /* The picker groups its options — "Investments › Antam" — and that group is now the caption, so
                 the row draws the holding's own name rather than saying Bought twice and truncating the name. */
              display={chosen ? holdingFace(chosen.label) : ''}
              value={`${purchase.mode}:${purchase.accountId}`}
              onChange={(value) => {
                const option = [...choices.buys, ...choices.sells].find((row) => row.value === value)!;
                setPurchase({ mode: option.mode, accountId: option.accountId, lotSize: option.lotSize, useLots: (option.lotSize ?? 1) > 1 });
              }}
            >
              <optgroup label="Investments">
                {choices.buys.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </optgroup>
              {choices.sells.length > 0 && (
                <optgroup label="Selling">
                  {choices.sells.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </optgroup>
              )}
            </SelectFormRow>
            <MoneyFieldRow
              currency={purchaseCurrency}
              flag={currencyFlag(purchaseCurrency)}
              label={costRow.label}
              caption={costRow.caption}
              placeholder={costRow.placeholder}
              value={purchase.amount}
              onChange={(amount) => setPurchase({ amount })}
            />
            <FieldRow
              icon={
                <RowGlyph>
                  <Layers size={15} />
                </RowGlyph>
              }
              label={unitsRow.label}
              caption={unitsRow.caption}
              hint={unitsRow.hint}
              placeholder={unitsRow.placeholder}
              inputMode="decimal"
              divided={purchase.useLots}
              value={purchase.useLots ? purchase.lots : purchase.units}
              onChange={(text) => setPurchase(purchase.useLots ? { lots: text } : { units: text })}
            />
            <MoneyFieldRow
              currency={purchaseCurrency}
              flag={currencyFlag(purchaseCurrency)}
              label={feeRow.label}
              caption={feeRow.caption}
              placeholder={feeRow.placeholder}
              value={purchase.fee}
              onChange={(fee) => setPurchase({ fee })}
            />
            <SelectFormRow
              icon={<RowGlyph>{purchase.mode === 'buy' ? <CreditCard size={15} /> : <Landmark size={15} />}</RowGlyph>}
              label={payRow.label}
              caption={payRow.caption}
              hint={payRow.hint}
              divided={purchase.mode === 'buy'}
              /* The options are a component, so there are no `<option>`s here to read the chosen one off; the
                 row is handed the very label `MoneyAccountOptions` gives that account. */
              display={purchaseMoney ? (placeholders.has(purchaseMoney.id) ? placeholderLabel(purchaseMoney.name) : `${purchaseMoney.name} (${purchaseMoney.currency})`) : ''}
              value={purchase.moneyId}
              onChange={(moneyId) => setPurchase({ moneyId, moneyIsCard: byId.get(moneyId)?.subtype === 'credit_card', charged: '' })}
            >
              <MoneyAccountOptions accounts={accounts} spendableOnly keep={purchase.moneyId} placeholders={placeholders} />
            </SelectFormRow>
            {purchaseNeeds.charged && (
              <MoneyFieldRow
                currency={purchaseCashCurrency}
                flag={currencyFlag(purchaseCashCurrency)}
                label={chargedRow.label}
                caption={chargedRow.caption}
                placeholder={chargedRow.placeholder}
                hint={chargedRow.hint}
                divided
                value={purchase.charged}
                onChange={(charged) => setPurchase({ charged })}
              />
            )}
            <DateRow on={purchase.occurredOn} onChange={(occurredOn) => setPurchase({ occurredOn })} max={isoDate()} />
          </FormRows>
        ) : (
          <FormRows className="rounded-none">
            {/*
              A correction stays in the workspace it was filed in. `replaceTransaction` refuses a write that
              crosses books, and a refusal met at Save is a choice that should never have been offered: the
              switch also clears the category on its way, so what it costs is the whole edit. The row stays,
              greyed, because which workspace this is in is still worth reading — it is the offer that goes.

              §3.5: a transfer has **no workspace row**. Moving your own money belongs to no workspace — the ledger
              files by the categories a transaction touches, and a transfer touches none — so a row offering to file
              it would be offering something the save cannot honour.
            */}
            {/* A draft belongs to the workspace it was captured in: switching here would leave it behind. */}
            {draft.mode !== 'transfer' && !finish && (
              <FormRow
                lead="value"
                icon={
                  <RowGlyph>
                    <Home size={15} />
                  </RowGlyph>
                }
                label="Workspace"
                name="Workspace for this transaction"
                value={(moveTo ? allBooks.find((book) => book.id === moveTo)?.name : openBook?.name) ?? ''}
                caption={moveTo ? 'Moving to' : 'Workspace'}
                chevron={!initial || canMove}
                disabled={!!initial && !canMove}
                onClick={() => setSheet(initial ? 'move' : 'workspace')}
              />
            )}
            {asking === 'money' ? (
              askRow(payGlyph, () => setSheet('money'))
            ) : (
            <div className="relative">
            <FormRow
              lead="value"
              icon={
                <span className="relative">
                  <RowGlyph>{payGlyph}</RowGlyph>
                  {paidOff && (
                    <span
                      aria-hidden
                      data-testid="paid-off-tick"
                      className="absolute -right-1 -bottom-1 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-[var(--ph-tint)] text-[var(--ph-surface)] ring-2 ring-[var(--ph-surface)]"
                    >
                      <Check size={9} strokeWidth={3.5} />
                    </span>
                  )}
                </span>
              }
              label={payLabel}
              value={
                partnerShown && draft.partner?.side === 'from'
                  ? partnerShown.value
                  : sharedShown ? sharedShown.value : removedCard ? removedCard.value : paying?.cardId ? paying.accountName : chosenPayment(payable, draft, placeholders)
              }
              caption={
                partnerShown && draft.partner?.side === 'from'
                  ? partnerShown.caption
                  : sharedShown ? sharedShown.caption : removedCard ? removedCard.caption : paying?.cardId ? `···· ${paying.last4 ?? '????'}` : payLabel
              }
              onClick={() => setSheet('money')}
              // A side of a transfer with a partner keeps its accounts: only its date, figure and note change (§7.2).
              disabled={accountsLocked}
              chevron={!accountsLocked}
            />
            {/* The card's icon is its own button, laid over the row's lead: a tap ticks or unticks Already paid off. */}
            {offersAlreadyPaid && (
              <button
                type="button"
                aria-label="Already paid off"
                aria-pressed={paidOff}
                title={paidOff ? 'Already paid off: the card owes the same' : 'Still owed on the card'}
                onClick={() => set({ alreadyPaid: !paidOff })}
                className="ph-focus absolute top-0 bottom-0 left-[10px] w-[34px] rounded-full"
              />
            )}
            </div>
            )}

            {/* A transfer reads From, To, then how much: the two places first, as a statement line does. */}
            {draft.mode === 'transfer' && (
              /*
                The hint is the To row's own second line rather than the group's: it is about where this money may
                land, and a fund bought by transfer is the one mistake this row exists to head off.
              */
              asking === 'to' ? (
                askRow(<ArrowDownLeft size={15} />, () => setSheet('to'))
              ) : (
              <FormRow
                lead="value"
                icon={
                  <RowGlyph>
                    <ArrowDownLeft size={15} />
                  </RowGlyph>
                }
                label="To"
                value={partnerShown && draft.partner?.side === 'to' ? partnerShown.value : (toAccount?.name ?? '')}
                caption={partnerShown && draft.partner?.side === 'to' ? partnerShown.caption : 'To'}
                disabled={accountsLocked}
                chevron={!accountsLocked}
                onClick={() => setSheet('to')}
              />
              )
            )}
            <AmountRow
              draft={draft}
              accounts={accounts}
              set={set}
              unsure={finish?.amountUnsure}
              selectOnOpen={!!duplicateOf}
              noRefund={!!finish}
              {...(photosOnAmount ? { photos: { count: draft.photoIds.length, open: () => setSheet('photos') } } : {})}
              {...(transferSecond ? { second: transferSecond } : {})}
            />
            {/* Withdrawal rate §7: what this foreign spend comes to at what the money cost. */}
            {draft.mode === 'expense' && <WithdrawalLine draft={draft} accounts={accounts} editingId={initial?.id ?? null} />}

            {draft.mode === 'transfer' ? null : draft.splits.length > 0 ? (
              // Split, the row reads the split and opens it; taking every line out of it gives the Category row back.
              <FormRow
                icon={
                  <RowGlyph>
                    <Split size={15} />
                  </RowGlyph>
                }
                label="Split"
                value={splitSummary(draft.splits, splitCurrency)}
                onClick={() => setSheet('split')}
              />
            ) : (
              <FormRow
                lead="value"
                label="Category"
                placeholder={!finish && categoryLater(draft) ? 'Choose later' : 'Select category'}
                icon={categoryLead}
                value={categoryName}
                caption=""
                onClick={() => setSheet('category')}
              />
            )}

            <NoteRow
              value={draft.description}
              onChange={(description) => set({ description })}
              onFocus={() => setNoteFocused(true)}
              onBlur={() => setNoteFocused(false)}
              {...(offersChannel ? { channel: draft.channel || null, onChannel: (channel: 'online' | 'offline' | null) => set({ channel: channel ?? '' }) } : {})}
            />
            <DateRow on={draft.occurredOn} onChange={(occurredOn) => set({ occurredOn })} />
            <NoteSuggestions typed={draft.description} kind={suggestKind} open={noteFocused} categoryName={categoryNameOf} onPick={pickNote} />
          </FormRows>
        )}
      </div>

      {draft.mode === 'trade' && (goals.length > 0 || (purchase.mode === 'buy' && purchaseMoney?.subtype === 'credit_card')) && (
        <FormRows>
          {goals.length > 0 && (
            <SelectFormRow
              icon={
                <RowGlyph>
                  <Target size={15} />
                </RowGlyph>
              }
              label={goalRow.label}
              caption={goalRow.caption}
              value={purchase.goalId}
              onChange={(goalId) => setPurchase({ goalId })}
            >
              <option value="">No goal</option>
              {goals.map((goal) => (
                <option key={goal.id} value={goal.id}>{goal.name}</option>
              ))}
            </SelectFormRow>
          )}
          {purchase.mode === 'buy' && purchaseMoney?.subtype === 'credit_card' && (
            <>
              <SelectFormRow
                icon={
                  <RowGlyph>
                    <Shapes size={15} />
                  </RowGlyph>
                }
                label="Category for points"
                caption="For points"
                hint="Not spending: it only tells the points engine what the card bought."
                divided={goals.length > 0}
                display={purchase.spendCategoryId ? (byId.get(purchase.spendCategoryId)?.name ?? '') : ''}
                value={purchase.spendCategoryId}
                onChange={(spendCategoryId) => setPurchase({ spendCategoryId })}
              >
                <CategoryOptions accounts={accounts} kind="expense" parentSuffix="(general)" />
              </SelectFormRow>
              <FieldRow
                icon={
                  <RowGlyph>
                    <Hash size={15} />
                  </RowGlyph>
                }
                label="MCC"
                caption="MCC"
                hint="Gold and jewellery shops are 5944."
                placeholder="Code"
                inputMode="numeric"
                divided
                value={purchase.mcc}
                onChange={(mcc) => setPurchase({ mcc })}
              />
            </>
          )}
        </FormRows>
      )}

      {/*
        §3.5's second card. For goal is offered only while adding — `formToPost` refuses to tag an edit, and a
        row that cannot be honoured is worse than no row. Received amount appears only when the two accounts
        settle in different currencies, because that is the only time the figure that lands is not the figure
        that left; `exchangeLines` reads it in the To account's own currency, which is what the label names.
      */}
      {draft.mode === 'transfer' && !initial && goals.length > 0 && (
        <FormRows>
          {!initial && goals.length > 0 && (
            <FormRow
              lead="value"
              icon={
                <RowGlyph>
                  <Target size={15} />
                </RowGlyph>
              }
              label="For goal"
              value={goals.find((goal) => goal.id === draft.goalId)?.name ?? ''}
              caption="For goal"
              onClick={() => setSheet('goal')}
            />
          )}

        </FormRows>
      )}

      {/* Withdrawal rate §7, R15: the Rate against the market, and out of foreign cash its cost and gain or loss. */}
      {draft.mode === 'transfer' && crossCurrency && <TransferRates draft={draft} accounts={accounts} editingId={initial?.id ?? null} />}

      {/*
        §4's rows, every one of them, behind one way in — B2's green "Add more details" under the card. The card
        used to carry "Someone owes part of this" here as well — one name, one figure, the shape the form had
        before `splitBill` learned to take several people. It is now the With row inside this sheet, where a
        dinner for four can be recorded.

        Outside the tab branch, because Buy or sell has extras too: `extraRows` answers Photos and Exclude for
        every mode, and this row used to be drawn in the expense branch alone — so a trade computed two rows
        that nothing drew, and a contract note could not be kept with the purchase it belongs to.
      */}
      {readingReceipt && (
        <p data-testid="receipt-reading" className="px-[6px] text-[12.5px] leading-4 text-[var(--ph-ink-3)]">
          Reading the receipt…
        </p>
      )}
      {receipt && (
        <p data-testid="receipt-filled" className="flex items-center gap-2 px-[6px] text-[12.5px] leading-4 text-[var(--ph-ink-2)]">
          <span className="min-w-0 flex-1">{filledLine(receipt.fields)}</span>
          <button type="button" onClick={undoReceipt} className="ph-focus ph-tap shrink-0 font-semibold text-[var(--ph-tint)]" style={{ '--ph-tap-y': '14px', '--ph-tap-x': '8px' } as CSSProperties}>
            Undo
          </button>
        </p>
      )}
      {/* One implementation of §4's rows, for adding and for correcting alike. */}
      {detailsOpen && (
        <section aria-label="More details">
          {offersFee && draft.fee.trim() !== '' && (
            <FormRows>
              <FormRow
                lead="value"
                icon={
                  <RowGlyph>
                    <Shapes size={15} />
                  </RowGlyph>
                }
                label="Fee category"
                placeholder="Fee category"
                value={byId.get(draft.feeCategoryId)?.name ?? ''}
                caption="Fee category"
                onClick={() => setSheet('feeCategory')}
              />
            </FormRows>
          )}
          <MoreDetails draft={draft} onChange={setDraft} accounts={accounts} missingRate={missingRate} omit={[...(finish ? DRAFT_OMITS : []), ...ON_CARD, ...(photosOnAmount ? (['photos'] as const) : [])]} opensSharedEvent={!finish} onPhotos={(files) => void readReceiptFrom(files)} />
        </section>
      )}
      {/*
        Plain text across the column, not a white pill: the fold is a way of *reading* the form, not a thing you
        can do to a transaction, and a filled button gave it the same weight as Save. Transparent, no edge, no
        shadow — the secondary ink, so it follows the theme. It keeps the 44 pt reach the drawn 40 px does not
        have, and keeps `aria-expanded`, because the word is now the only thing that tells the two states apart.
      */}
      <button
        type="button"
        aria-expanded={detailsOpen}
        onClick={() => setDetailsOpen((open) => !open)}
        className="ph-focus flex min-h-11 w-full items-center justify-center rounded-full text-[15px] font-medium text-[var(--ph-ink-2)]"
      >
        {detailsToggleLabel(detailsOpen)}
      </button>
      </fieldset>

      {finish?.footer}

      {/* The set-aside question (E2) sits above the dock, in the kit's inset groups, so the dock stays one line. */}
      {setAside.node}

      {/*
        The dock: Save across the foot, where B2 puts it. Inside a sheet it rides the sheet's foot while the rows
        scroll; on its own screen or in a list it simply ends the card. Cancel stays beside it — the sheet's ✕ is
        a way out, but the full-screen form has no ✕, and a form with no Cancel there has no way out but Back.
      */}
      {headerSave ? (
        <ErrorBox error={error} />
      ) : (
      <div className="flex flex-col gap-2 pt-1 in-[[role=dialog]]:shadow-[0_40px_0_0_var(--ph-surface)] in-[[role=dialog]]:sticky in-[[role=dialog]]:bottom-0 in-[[role=dialog]]:-mx-4 in-[[role=dialog]]:border-t-[0.5px] in-[[role=dialog]]:border-[var(--ph-hair)] in-[[role=dialog]]:bg-[var(--ph-surface)] in-[[role=dialog]]:px-4 in-[[role=dialog]]:py-2">
        <ErrorBox error={error} />
        <div className={cx('flex items-center gap-2', title !== undefined && 'hidden')}>
          <button
            type="button"
            onClick={onDone}
            className="ph-focus min-h-11 shrink-0 rounded-full px-4 text-[15px] text-[var(--ph-ink-2)] active:bg-[var(--ph-fill)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !setAside.ready}
            className="ph-focus min-h-11 flex-1 rounded-full bg-[var(--ph-ink)] text-[15px] font-semibold text-[var(--ph-surface)] disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
      )}
    </form>
  );

  return (
    <>
      {/* On its own screen the card sits on the page's ground; anywhere else — a sheet, a list — on a panel of
          that ground, so its white groups read as cards the way B2 draws them. */}
      {/*
        On a screen of its own the bar is the card's: Save is the ✓ in its corner, dimmed until the form would post,
        and the dock at the foot goes — Back is the way out, as it is on every other subpage.
      */}
      {title !== undefined && (
        <PushedTitle
          title={title}
          back="Back"
          onBack={onBack}
          actions={[
            { key: 'save', label: finish?.saveLabel ?? 'Save', glyph: <Check size={20} aria-hidden />, disabled: !ready, run: () => formRef.current?.requestSubmit() },
          ]}
        />
      )}
      {full ? body : <div className="rounded-2xl bg-[var(--ph-ground)] p-0 in-[[role=dialog]]:rounded-none">{body}</div>}

      {sheet === 'workspace' && <WorkspaceSheet onClose={() => setSheet(null)} />}
      {sheet === 'to' && (
        // The same sheet From uses — search, the picked row marked, Add account at the foot — so both sides read alike.
        <PaymentSheet
          title="To"
          options={paymentOptions(landing, [])}
          accounts={accounts}
          chosenAccountId={draft.partner?.side === 'to' ? '' : draft.toId}
          // One's own account clears a partner's item on this side; a partner on the From side stays.
          onPick={(option) => {
            set({ toId: option.accountId, partner: draft.partner?.side === 'from' ? draft.partner : null });
            if (asking === 'to') finish?.accountAsk?.onAnswer(option.accountId);
          }}
          // Joint net worth §7.2: the partner's shared items in the From's currency, a section of their own under the
          // money one holds — not accounts of this person's, so the money-you-hold rule above does not judge them.
          shared={
            toPartners.length > 0 && !finish
              ? {
                  items: toPartners.flatMap((section) => section.items),
                  formBookId: draft.bookId,
                  groupWorkspaceBookId: netWorthGroup.data?.workspaceBookId,
                  chosenItemId: draft.partner?.side === 'to' ? draft.partner.itemId : null,
                  onPick: (item) => set({ toId: '', partner: partnerOf(item, 'to') }),
                  title: (ownerName) => partnerTitle(ownerName, workspaceName),
                }
              : undefined
          }
          onClose={() => setSheet(null)}
          footer="Buying a fund, shares or gold? Use Buy / sell, so units are counted."
          adding={
            initial
              ? undefined
              : {
                  kinds: CASH_ITEMS.map((item) => item.id as MoneyAccountSubtype).filter((subtype) => canTransferWith({ id: '', kind: 'asset', subtype })),
                  onAdded: (toId) => set({ toId }),
                }
          }
        />
      )}
      {sheet === 'goal' && (
        <ChoiceSheet
          title="For goal"
          value={draft.goalId}
          groups={[{ choices: [{ value: '', label: 'No goal', glyph: <Target size={15} /> }, ...goals.map((goal) => ({ value: goal.id, label: goal.name, glyph: <Target size={15} /> }))] }]}
          footer="Money parked for a goal counts towards it while it waits."
          onPick={(goalId) => set({ goalId })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'money' && (
        <PaymentSheet
          title={payLabel}
          options={payable}
          accounts={accounts}
          placeholders={placeholders}
          chosenAccountId={draft.moneyId}
          chosenCardId={draft.cardId}
          chosenCardRemoved={removedCard !== null}
          cards={draft.mode === 'expense'}
          // One's own account clears a partner's item; the placeholder a saved purchase names keeps what it says.
          onPick={(option) => {
            const picked = byId.get(option.accountId);
            // A To that cannot pair with the new From is no longer an answer (the From list already keeps them apart;
            // this covers an old row opened with a pair made before the rule).
            const unpaired = draft.mode === 'transfer' && picked && toAccount && !canTransferBetween(picked, toAccount);
            set({
              moneyId: option.accountId,
              cardId: option.cardId ?? '',
              paidFrom: placeholders.has(option.accountId) ? undefined : null,
              ...(draft.partner?.side === 'from' ? { partner: null } : {}),
              ...(unpaired ? { toId: '' } : {}),
            });
            if (asking === 'money') finish?.accountAsk?.onAnswer(option.accountId);
          }}
          shared={
            finish
              ? undefined
              : draft.mode === 'expense'
              ? {
                  items: paidWith.data ?? [],
                  formBookId: draft.bookId,
                  groupWorkspaceBookId: netWorthGroup.data?.workspaceBookId,
                  chosenItemId: sharedPaying?.itemId ?? null,
                  onPick: (item) => void payWithShared(item),
                }
              : draft.mode === 'transfer' && fromPartners.length > 0
                ? {
                    // Money received from a partner (§7.2): their shared items in the To account's currency.
                    items: fromPartners.flatMap((section) => section.items),
                    formBookId: draft.bookId,
                    groupWorkspaceBookId: netWorthGroup.data?.workspaceBookId,
                    chosenItemId: draft.partner?.side === 'from' ? draft.partner.itemId : null,
                    onPick: (item) => set({ moneyId: '', cardId: '', partner: partnerOf(item, 'from') }),
                    title: (ownerName) => partnerTitle(ownerName, workspaceName),
                  }
                : undefined
          }
          onClose={() => setSheet(null)}
          // Only a new transaction: an edit changes what is there rather than making more. The kinds offered are the
          // ones this question can name, so the account made is always one the row can then hold.
          adding={
            initial
              ? undefined
              : {
                  kinds: CASH_ITEMS.map((item) => item.id as MoneyAccountSubtype).filter((subtype) => namedBy({ id: '', kind: 'asset', subtype }, '')),
                  onAdded: (accountId) => set({ moneyId: accountId, cardId: '' }),
                }
          }
        />
      )}
      {sheet === 'category' && (
        <CategoryPicker
          kind={draft.mode === 'income' ? 'income' : 'expense'}
          value={draft.categoryId}
          setId={eventSet}
          onPick={(categoryId) => {
            categorySource.current = 'hand';
            /*
             * The picker has its own Expense / Income control. An income category picked while on Expense (Salary)
             * moves the form to Income, and the other way round, as the tab itself would — keeping the category.
             */
            const kind = byId.get(categoryId)?.kind;
            const to = kind === 'income' ? 'income' : kind === 'expense' ? 'expense' : null;
            if (to && to !== draft.mode && (draft.mode === 'expense' || draft.mode === 'income')) {
              const flag = currencyChoosable({ ...draft, mode: to }) ? {} : { currency: '', chargedAmount: '' };
              set({ mode: to, categoryId, splits: [], ...flag });
            } else set({ categoryId });
          }}
          onClose={() => setSheet(null)}
          {...(offersSplit ? { onSplit: () => setSheet('split'), splitRefusal: extraRowRefusal('split', draft) } : {})}
          {...(moveTo ? { bookId: moveTo } : {})}
        />
      )}
      {sheet === 'feeCategory' && (
        <CategoryPicker
          kind="expense"
          lockKind
          title="Fee category"
          value={draft.feeCategoryId}
          onPick={(feeCategoryId) => set({ feeCategoryId })}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'photos' && <PhotosSheet draft={draft} onChange={setDraft} onClose={() => setSheet(null)} onAttached={(files) => void readReceiptFrom(files)} />}
      {sheet === 'move' && (
        <ChoiceSheet
          title="Move to workspace"
          value={moveTo ?? ws.bookId ?? ''}
          groups={[{ choices: allBooks.map((book) => ({ value: book.id, label: book.name, glyph: <Home size={16} /> })) }]}
          footer="Its category is matched in that workspace; the card or account, amount and date stay as they are."
          onPick={(bookId) => {
            const { draft: next } = draftIn(latest.current, bookId, accounts, categoryBooks);
            setDraft(next);
            setMoveTo(bookId === ws.bookId ? null : bookId);
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'split' && <SplitSheet draft={draft} onChange={setDraft} accounts={accounts} currency={splitCurrency} onClose={() => setSheet(null)} />}
    </>
  );
}
