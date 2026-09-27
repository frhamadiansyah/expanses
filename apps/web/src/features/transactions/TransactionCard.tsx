import { isoDate, type PaymentOption, tradeRateNeeds } from '@expanses/core';
import {
  type AccountRow,
  type CardRow,
  noteCategory,
  type NoteSuggestion,
  postTransaction,
  recordTaggedTransfer,
  replaceTransaction,
  saveMerchantMcc,
  splitBill,
  type TransactionView,
} from '@expanses/db';
import { AlignLeft, ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronLeft, ChevronRight, CreditCard, Hash, Home, Landmark, Layers, Shapes, Target } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { type CSSProperties, type FormEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { canPayWith, canReceiveInto, canTransferWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useAccountsFor, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { Card, cx, ErrorBox, InputRow } from '../../ui';
import { PushedTitle, SegmentedControl } from '../../ui/native';
import { useCards } from '../cards/card-queries';
import { CategoryOptions } from '../cards/options';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useCanHold, useGoals, useSetAsideChoiceOf } from '../goals/queries';
import { doorOfForm, postForDoor } from '../goals/set-aside-question';
import { useSetAside } from '../goals/SetAsideQuestion';
import { useAssetProfiles, useAssetValues } from '../networth/queries';
import { assetKindTile, debtKindTile } from '../ownables/catalogue-view';
import { useOpenBook } from '../workspaces/queries';
import { WorkspaceSheet } from '../workspaces/WorkspaceSheet';
import { AmountRow } from './AmountRow';
import { buyChoices, emptyPurchaseDraft, type PurchaseDraft, transferTargets } from './buy-in-form';
import { amountRowText, chargedRowText, feeRowText, goalRowText, holdingFace, holdingRowText, payRowText, unitsRowText } from './buy-rows';
import { CategoryPicker } from './CategoryPicker';
import { ChoiceSheet } from './ChoiceSheet';
import { FieldRow, FormRow, FormRows, MoneyFieldRow, ROW_BODY, RowGlyph, RowLead, SelectFormRow } from './FormRow';
import { MoreDetails } from './MoreDetails';
import { NoteSuggestions } from './NoteSuggestions';
import { PaymentSheet, chosenPayment } from './PaymentSheet';
import { useTransactionPhotoIds } from './queries';
import { paymentOptions, placeholderLabel, withoutPlaceholders } from './quick-row';
import { clearStashedDraft, readStashedDraft, stashDraft } from './draft-handoff';
import { currencyChoosable, currencyFlag, detailsToggleLabel, emptyForm, type FormDraft, type FormMode, formFromTransaction, formToMemory, formToPost, rateDateFor, receivedField } from './tx-form';
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

/** Which section of the balance sheet an account's bare subtype files under, for the drawing it wears. Money is the rest. */
const SECTION_OF_SUBTYPE: Record<string, string> = { receivable: 'receivable', investment: 'invest', vehicle: 'movable', property: 'immovable' };

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
  onDone: () => void;
  full?: boolean;
  label?: string;
  /** On a screen of its own: the bar's name and its way back. The card draws the bar, because Save lives in it. */
  title?: string;
  onBack?: () => void;
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

function CardBody({
  initial,
  mode,
  onDone,
  full,
  label,
  title,
  onBack,
  accounts,
  photoIds,
}: {
  initial?: TransactionView;
  mode?: FormMode;
  onDone: () => void;
  full?: boolean;
  /** The form's accessible name, on a screen of its own where no sheet's title names it. */
  label?: string;
  title?: string;
  onBack?: () => void;
  accounts: AccountRow[];
  photoIds: string[];
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const openBook = useOpenBook();
  const bookId = ws.bookId ?? '';
  const allCards = useCards().data ?? [];
  const goals = useGoals().data ?? [];
  const assetValues = useAssetValues();
  // What this device lists, placeholders left out; `accounts` may also hold one the edited purchase names.
  const listed = useAccounts();
  const listedIds = new Set((listed.data ?? accounts).map((a) => a.id));
  // The placeholders among `accounts`: what the edited purchase names that this device's own list leaves out (§4.4).
  const placeholders = new Set(accounts.filter((a) => !listedIds.has(a.id)).map((a) => a.id));
  const assetProfiles = useAssetProfiles();
  // A new transaction set aside while an account was added for it comes back as typed, with that account picked
  // when it can pay (or receive, or move) the way this transaction does.
  const [handoff] = useState(() => (!initial && full ? readStashedDraft() : null));
  useEffect(() => {
    if (handoff) clearStashedDraft();
  }, [handoff]);
  const [draft, setDraft] = useState<FormDraft>(() => {
    if (initial) return formFromTransaction(initial, accounts, bookId, photoIds);
    if (!handoff) return { ...emptyForm(bookId), mode: mode ?? 'expense' };
    const added = accounts.find((a) => a.id === handoff.addedAccountId);
    const fits = handoff.draft.mode === 'transfer' ? canTransferWith : handoff.draft.mode === 'income' ? canReceiveInto : canPayWith;
    return added && fits(added, '') ? { ...handoff.draft, moneyId: added.id, cardId: '' } : handoff.draft;
  });
  const navigate = useNavigate();
  /**
   * Off to New account — or, from the Credit cards tab, straight to a new credit card — with what is typed set aside;
   * saving there, or going back, returns here with it.
   */
  const addAccount = (kind: 'accounts' | 'cards') => {
    stashDraft(draft);
    if (kind === 'cards') void navigate({ to: '/debts/new', search: { returnTo: 'transaction', item: 'credit_card' } });
    else void navigate({ to: '/accounts/new', search: { returnTo: 'transaction' } });
  };
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
  const money = moneyHolders(accounts).filter((a) => namedBy(a, draft.moneyId));
  // A card is a way to pay, never somewhere money arrives or moves to.
  // Never a placeholder to choose; the one the row names stays as its current value (final review, minor 2).
  const payable: PaymentOption[] = withoutPlaceholders(
    paymentOptions(money, draft.mode === 'expense' || draft.mode === 'trade' ? (allCards as CardRow[]) : []),
    listedIds,
    draft.moneyId,
  );

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
      setError(e);
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
  // Where a transfer may land, as the From list draws its own: accounts first, then cards and debts it can pay down.
  // Only what this device lists: a placeholder the edited purchase names (useAccountsFor) is never a place money can
  // be moved to (spec §4.4, fix round 1).
  const landing = moneyHolders(transferTargets(accounts.filter((a) => listedIds.has(a.id)), assetValues.data ?? []));
  const transferGroups = [
    { title: 'Accounts', kind: 'asset' as const },
    { title: 'Credit cards & debts', kind: 'liability' as const },
  ].map(({ title, kind }) => ({
    title,
    choices: landing.filter((a) => a.kind === kind).map((a) => {
      // Each wears the drawing the Assets and Liabilities pages give its kind, so a scooter never reads as a bank.
      const Glyph = kind === 'asset' ? assetKindTile(SECTION_OF_SUBTYPE[a.subtype] ?? 'liquid', a.subtype) : debtKindTile(a.subtype === 'loan' ? 'other_loans' : a.subtype);
      return { value: a.id, label: a.name, caption: a.currency ?? undefined, glyph: <Glyph size={15} /> };
    }),
  }));
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
    if (busy || !setAside.ready) return false;
    try {
      formToPost(draft, accounts);
      return true;
    } catch {
      return false;
    }
  })();

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

  /** Which glyph leads the paying row: a card, a bank for what came in, the account money leaves. */
  const payGlyph = draft.mode === 'income' ? <Landmark size={15} /> : draft.mode === 'transfer' ? <ArrowUpRight size={15} /> : <CreditCard size={15} />;
  const modes = [
    { key: 'expense', label: 'Expense' },
    { key: 'income', label: 'Income' },
    { key: 'transfer', label: 'Transfer' },
    ...(choices.buys.length > 0 ? [{ key: 'trade', label: 'Buy / sell' }] : []),
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
          className="ph-focus-inset min-w-0 flex-1 bg-transparent py-1 text-base text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none md:text-[15px]"
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
    <form ref={formRef} onSubmit={submit} aria-label={label} className="flex flex-col gap-[10px]">
      {/* Option B: one card — the four tabs across its top, then every row of the tab under them. */}
      <div className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)]">
        <div className="px-3 pt-[10px] pb-[6px]">
          <SegmentedControl label="What this is" segments={modes} value={draft.mode} onChange={(key) => chooseMode(key as FormMode)} />
        </div>
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
            {draft.mode !== 'transfer' && (
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
            <FormRow
              lead="value"
              icon={<RowGlyph>{payGlyph}</RowGlyph>}
              label={payLabel}
              value={paying?.cardId ? paying.accountName : chosenPayment(payable, draft, placeholders)}
              caption={paying?.cardId ? `···· ${paying.last4 ?? '????'}` : payLabel}
              onClick={() => setSheet('money')}
            />

            <AmountRow draft={draft} accounts={accounts} set={set} />

            {draft.mode === 'transfer' ? (
              /*
                The hint is the To row's own second line rather than the group's: it is about where this money may
                land, and a fund bought by transfer is the one mistake this row exists to head off.
              */
              <FormRow
                lead="value"
                icon={
                  <RowGlyph>
                    <ArrowDownLeft size={15} />
                  </RowGlyph>
                }
                label="To"
                value={toAccount?.name ?? ''}
                caption="To"
                onClick={() => setSheet('to')}
              />
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
          <MoreDetails draft={draft} onChange={setDraft} accounts={accounts} missingRate={missingRate} />
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

      {/* The set-aside question (E2) sits above the dock, in the kit's inset groups, so the dock stays one line. */}
      {setAside.node}

      {/*
        The dock: Save across the foot, where B2 puts it. Inside a sheet it rides the sheet's foot while the rows
        scroll; on its own screen or in a list it simply ends the card. Cancel stays beside it — the sheet's ✕ is
        a way out, but the full-screen form has no ✕, and a form with no Cancel there has no way out but Back.
      */}
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
          actions={[{ key: 'save', label: 'Save', glyph: <Check size={20} aria-hidden />, disabled: !ready, run: () => formRef.current?.requestSubmit() }]}
        />
      )}
      {full ? body : <div className="rounded-2xl bg-[var(--ph-ground)] p-0 in-[[role=dialog]]:rounded-none">{body}</div>}

      {sheet === 'workspace' && <WorkspaceSheet onClose={() => setSheet(null)} />}
      {sheet === 'to' && (
        <ChoiceSheet
          title="To"
          value={draft.toId}
          groups={transferGroups}
          footer="Buying a fund, shares or gold? Use Buy / sell, so units are counted."
          onPick={(toId) => set({ toId })}
          onClose={() => setSheet(null)}
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
          onPick={(option) => set({ moneyId: option.accountId, cardId: option.cardId ?? '' })}
          onClose={() => setSheet(null)}
          // Only a new transaction on its own screen: an edit, or the card in a sheet, has nowhere to come back to.
          onAddAccount={full && !initial ? addAccount : undefined}
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
