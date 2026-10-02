import { CASH_ITEMS, isoDate, type MoneyAccountSubtype, type PaymentOption, tradeRateNeeds } from '@expanses/core';
import {
  type AccountRow,
  type CardRow,
  editMemberTransfer,
  itemIdOf,
  listAccounts,
  memberTransfersOf,
  noteCategory,
  paidFromAccount,
  type PaidWithItem,
  type SetAsideChoice,
  type NoteSuggestion,
  postTransaction,
  recordMemberTransfer,
  recordTaggedTransfer,
  replaceTransaction,
  saveMerchantMcc,
  splitBill,
  type TransactionView,
} from '@expanses/db';
import { AlignLeft, ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, CreditCard, Hash, Home, Landmark, Layers, Shapes, Target } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { type CSSProperties, type FormEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { canPayWith, canReceiveInto, canTransferBetween, canTransferWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useAccountsFor, useInvalidateAll, useIsBookShared, useResolveRates } from '../../lib/queries';
import { Card, cx, ErrorBox, InputRow } from '../../ui';
import { PushedTitle, SegmentedControl } from '../../ui/native';
import { useCards } from '../cards/card-queries';
import { CategoryOptions } from '../cards/options';
import { CategoryIcon } from '../categories/CategoryIcon';
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
import { CategoryPicker } from './CategoryPicker';
import { ChoiceSheet } from './ChoiceSheet';
import { Chevron, FieldRow, FormRow, FormRows, MoneyFieldRow, ROW_BODY, RowGlyph, RowLead, SelectFormRow } from './FormRow';
import { MoreDetails } from './MoreDetails';
import { NoteSuggestions } from './NoteSuggestions';
import { partnerTitle, partnerTransferSections } from './member-transfer';
import { PaymentSheet, chosenPayment, sharedTitle } from './PaymentSheet';
import { useTransactionPhotoIds } from './queries';
import { paymentOptions, placeholderLabel, withoutPlaceholders } from './quick-row';
import { currencyChoosable, currencyFlag, detailsToggleLabel, emptyForm, type ExtraRow, type FormDraft, type FormMode, formFromTransaction, formToMemory, formToPost, memberTransferOf, ownTransferAccountId, rateDateFor, receivedField, sayPaidWithError, sharedPaymentOf, transferFigure } from './tx-form';
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

/** What a draft cannot carry to the ledger: `confirmDraft` posts one category, paid by one account. */
const DRAFT_OMITS: readonly ExtraRow[] = ['split', 'with'];

/** The ‹ › steppers are 28px drawn; their target reaches the 44pt floor around them. */
const TAP_REACH = { '--ph-tap-y': '8px', '--ph-tap-x': '4px' } as CSSProperties;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thu, 17 Sep 2026" — how B2's date row reads a day. The empty string for anything that is not a date. */
export function dayLabel(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return '';
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return `${DAYS[date.getDay()]}, ${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** A day either side of the date, as the ‹ › buttons step it. */
export function stepDay(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

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
  mode?: FormMode;
  /** A new transaction's accounts, filled in before the form opens: the page it was opened from knows them. */
  seed?: { moneyId?: string; toId?: string };
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
}) {
  // An edit can read a placeholder the purchase is already posted against: one another member paid for (§4.4).
  const accounts = useAccountsFor(props.initial);
  // The pictures this transaction already has, so reopening one that has a receipt does not say "Photos: None".
  // The very same reader the phone's edit sheet uses, and `ready` is its own answer about when it may be read.
  const photos = useTransactionPhotoIds(props.initial?.id ?? null);
  // The draft is built from the accounts once, so it must not be built before they are here: `formFromTransaction`
  // reads each account's currency, and a draft seeded from an empty list opens a foreign purchase with no currency.
  // The same holds for the photo rows: a draft seeded before they arrive opens an edit with none of them.
  if (!accounts.isSuccess || !photos.ready) return <Card>Loading…</Card>;
  return <CardBody {...props} accounts={accounts.data} photoIds={photos.ids} />;
}

/** Only ids this device holds: an address typed or kept from another workspace names nothing, and fills nothing in. */
function seedIds(seed: { moneyId?: string; toId?: string } | undefined, accounts: readonly AccountRow[]): Partial<FormDraft> {
  const known = (id: string | undefined) => (id && accounts.some((a) => a.id === id) ? id : '');
  return { moneyId: known(seed?.moneyId), toId: known(seed?.toId) };
}

function CardBody({
  initial,
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
  accounts: ownAccounts,
  photoIds,
}: {
  initial?: TransactionView;
  mode?: FormMode;
  seed?: { moneyId?: string; toId?: string };
  fixedMode?: boolean;
  headerSave?: { formId: string; onReady: (ready: boolean) => void };
  onDone: () => void;
  full?: boolean;
  /** The form's accessible name, on a screen of its own where no sheet's title names it. */
  label?: string;
  title?: string;
  onBack?: () => void;
  finish?: CardFinish;
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
      : { ...emptyForm(bookId), mode: mode ?? 'expense', ...seedIds(seed, accounts), ...finish?.prefill },
  );
  const [sheet, setSheet] = useState<null | 'workspace' | 'money' | 'category' | 'to' | 'goal'>(null);
  // Add more details opens in place, under the card, rather than over it: the extras are part of the one form.
  const [detailsOpen, setDetailsOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const [needsRate, setNeedsRate] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const noteId = useId();
  const dateId = useId();
  const set = (patch: Partial<FormDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setPurchase = (patch: Partial<PurchaseDraft>) => setDraft((d) => ({ ...d, purchase: { ...d.purchase, ...patch } }));

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

  /*
   * The workspace row and the open workspace are the same fact, so the row follows the app rather than keeping a
   * second answer. Changing it clears the category: two workspaces hold copies of the same category under
   * different ids, and a category chosen in one of them would file this spending in the other.
   */
  useEffect(() => {
    if (draft.bookId === bookId) return;
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
      const post = formToPost(draft, accounts);
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
          database, ws, draft, post, accounts, rateDate, needsRate, resolveRates, onMissing: setNeedsRate, where: 'Add more details',
        });
        // Every branch sends the answer — an edit explicitly, so a question no longer asked clears the old answer.
        if (post.kind === 'split') await splitBill(database, ws, { ...post.input, ratesToBase, setAside: setAside.choice });
        else if (post.kind === 'transfer-goal') await recordTaggedTransfer(database, ws, { ...post.input, ratesToBase, setAside: setAside.choice });
        else if (initial) await replaceTransaction(database, ws, initial.id, { ...post.input, ratesToBase, setAside: setAside.choice });
        else await postTransaction(database, ws, { ...post.input, ratesToBase, setAside: setAside.choice });
        const memory = formToMemory(draft, accounts);
        if (memory) await saveMerchantMcc(database, ws, memory);
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

  // B2 reads a card as its account's name with the digits as the caption — "BCA KrisFlyer · ···· 1467" — and
  // anything else as its name with what the row is for: "BCA Tahapan · Received into".
  const paying = payable.find((option) => option.accountId === draft.moneyId && (option.cardId ?? '') === draft.cardId);
  const payLabel = draft.mode === 'income' ? 'Received into' : draft.mode === 'transfer' ? 'From' : 'Paid with';
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
      else formToPost(draft, accounts);
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
      return set({ mode: value, categoryId: '', splits: [], ...flag });
    }
    const first = choices.buys[0]!;
    set({
      mode: 'trade',
      purchase: { ...emptyPurchaseDraft(first.accountId, draft.moneyId, isoDate()), lotSize: first.lotSize, useLots: (first.lotSize ?? 1) > 1 },
    });
  };

  /*
   * B2's Note and Date rows. Note is still today's Description — the same field, typed in place — drawn as the
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
  const pickNote = (suggestion: NoteSuggestion) =>
    setDraft((d) => ({
      ...d,
      description: suggestion.description,
      ...(suggestion.categoryId && !d.categoryId && d.splits.length === 0 ? { categoryId: suggestion.categoryId } : {}),
    }));
  // A note typed out in full without a tap still brings its category, when leaving Note finds Category empty.
  const fillCategoryFromNote = () => {
    const typed = draft.description.trim();
    if (!suggestKind || !typed || draft.categoryId || draft.splits.length > 0) return;
    void noteCategory(database, ws, typed, suggestKind).then((categoryId) => {
      if (categoryId) setDraft((d) => (d.categoryId || d.splits.length > 0 || d.description.trim() !== typed ? d : { ...d, categoryId }));
    });
  };
  const noteRow = (
    <div className="flex items-center gap-[10px] pl-[10px]">
      <RowLead>
        <RowGlyph>
          <AlignLeft size={15} />
        </RowGlyph>
      </RowLead>
      <span className={ROW_BODY}>
        <input
          id={noteId}
          aria-label="Note"
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          onFocus={() => setNoteFocused(true)}
          onBlur={() => {
            setNoteFocused(false);
            fillCategoryFromNote();
          }}
          placeholder="Note"
          className="ph-focus-inset min-w-0 flex-1 bg-transparent py-1 text-[15px] leading-5 text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none"
        />
      </span>
    </div>
  );
  const stepButton = 'ph-focus ph-tap flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink)]';
  const dateRow = (on: string, change: (iso: string) => void, max?: string) => (
    <div className="flex items-center gap-[10px] pl-[10px]">
      <RowLead>
        <RowGlyph>
          <CalendarDays size={15} />
        </RowGlyph>
      </RowLead>
      <span className={cx(ROW_BODY, 'gap-[6px]')}>
        <button type="button" aria-label="A day earlier" onClick={() => change(stepDay(on, -1))} className={stepButton} style={TAP_REACH}>
          <ChevronLeft size={16} aria-hidden />
        </button>
        <span className="relative flex h-7 min-w-0 flex-1 items-center justify-center rounded-lg bg-[var(--ph-fill)] text-[13px] font-medium text-[var(--ph-ink)]">
          <span aria-hidden className="truncate">
            {dayLabel(on)}
          </span>
          <input
            id={dateId}
            aria-label="Date"
            type="date"
            required
            max={max}
            value={on}
            onChange={(e) => change(e.target.value)}
            onClick={(e) => {
              try {
                e.currentTarget.showPicker?.();
              } catch {
                // A browser that will not show its picker on a click still takes the keyboard.
              }
            }}
            className="ph-focus absolute inset-0 h-full w-full cursor-pointer rounded-lg opacity-0"
          />
        </span>
        <button type="button" aria-label="A day later" onClick={() => change(stepDay(on, 1))} className={stepButton} style={TAP_REACH}>
          <ChevronRight size={16} aria-hidden />
        </button>
      </span>
    </div>
  );

  const body = (
    <form ref={formRef} id={headerSave?.formId} onSubmit={submit} aria-label={label} className="flex flex-col gap-[10px]">
      {finish?.header}
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
            {dateRow(purchase.occurredOn, (occurredOn) => setPurchase({ occurredOn }), isoDate())}
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
                value={openBook?.name ?? ''}
                chevron={!initial}
                disabled={!!initial}
                onClick={() => setSheet('workspace')}
              />
            )}
            {asking === 'money' ? (
              askRow(payGlyph, () => setSheet('money'))
            ) : (
            <FormRow
              lead="value"
              icon={<RowGlyph>{payGlyph}</RowGlyph>}
              label={payLabel}
              value={
                partnerShown && draft.partner?.side === 'from'
                  ? partnerShown.value
                  : sharedShown ? sharedShown.value : paying?.cardId ? paying.accountName : chosenPayment(payable, draft, placeholders)
              }
              caption={
                partnerShown && draft.partner?.side === 'from'
                  ? partnerShown.caption
                  : sharedShown ? sharedShown.caption : paying?.cardId ? `···· ${paying.last4 ?? '????'}` : payLabel
              }
              onClick={() => setSheet('money')}
              // A side of a transfer with a partner keeps its accounts: only its date, figure and note change (§7.2).
              disabled={accountsLocked}
              chevron={!accountsLocked}
            />
            )}

            <AmountRow draft={draft} accounts={accounts} set={set} unsure={finish?.amountUnsure} />

            {draft.mode === 'transfer' ? (
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
            ) : (
              draft.splits.length === 0 && (
                <FormRow
                  lead="value"
                  label="Category"
                  placeholder="Select category"
                  icon={categoryLead}
                  value={categoryName}
                  caption=""
                  onClick={() => setSheet('category')}
                />
              )
            )}

            {noteRow}
            {dateRow(draft.occurredOn, (occurredOn) => set({ occurredOn }))}
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
                placeholder="5944"
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
      {draft.mode === 'transfer' && (crossCurrency || (!initial && goals.length > 0)) && (
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
          {received && (
            <InputRow label={received.label} value={received.value} onChange={(e) => set({ toAmount: e.target.value })} inputMode="decimal" required />
          )}
        </FormRows>
      )}

      {/*
        §4's rows, every one of them, behind one way in — B2's green "Add more details" under the card. The card
        used to carry "Someone owes part of this" here as well — one name, one figure, the shape the form had
        before `splitBill` learned to take several people. It is now the With row inside this sheet, where a
        dinner for four can be recorded.

        Outside the tab branch, because Buy or sell has extras too: `extraRows` answers Photos and Exclude for
        every mode, and this row used to be drawn in the expense branch alone — so a trade computed two rows
        that nothing drew, and a contract note could not be kept with the purchase it belongs to.
      */}
      {/* The same component, with the same props, that the edit sheet opens: one implementation of §4's rows. */}
      {detailsOpen && (
        <section aria-label="More details">
          <MoreDetails draft={draft} onChange={setDraft} accounts={accounts} missingRate={missingRate} omit={finish ? DRAFT_OMITS : undefined} />
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
          actions={[{ key: 'save', label: finish?.saveLabel ?? 'Save', glyph: <Check size={20} aria-hidden />, disabled: !ready, run: () => formRef.current?.requestSubmit() }]}
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
          onPick={(categoryId) => set({ categoryId })}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}
