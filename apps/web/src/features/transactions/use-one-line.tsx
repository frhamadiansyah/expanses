import { type CategoryOption, evaluateAmount, formatMinor, isoDate, minorToMajorString, type PaymentOption, readExpenseLine } from '@expanses/core';
import {
  type AccountRow,
  type CardRow,
  guessCategoryFromHistory,
  isPastDefault,
  lastPaidWith,
  moveIntoSharedEvent,
  type NoteSuggestion,
  ownerScope,
  postTransaction,
  sharedEventOf,
  uncategorisedCategory,
} from '@expanses/db';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { usePhone } from '../../app/use-phone';
import { SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { useAccounts, useInOpenBook, useInvalidateAll, useIsBookShared, useResolveRates } from '../../lib/queries';
import { useOpenBook } from '../workspaces/queries';
import { cx } from '../../ui';
import { InsetGroup, TextRow } from '../../ui/native';
import { payableOptions, resolveDefaultPaidWith, useStoredDefaultPaidWith } from '../account/default-paid-with';
import { useOpeningDay } from '../accounts/queries';
import { useAccountNumberLast4, useCards, useWalletLast4 } from '../cards/card-queries';
import { offeredCategories } from '../categories/offered';
import { useCategorySetMembership } from '../categories/set-queries';
import { DateRow } from './CardRows';
import { CategoryPicker } from './CategoryPicker';
import { FormRows } from './FormRow';
import { Keypad } from './Keypad';
import type { ListRow } from './list-model';
import {
  afterSave,
  baseOf,
  canSaveLine,
  categoryGuess,
  choicesAfterTyping,
  foreignCharge,
  type LineChoices,
  type LineContext,
  type LinePart,
  type LinePreview,
  lineDraft,
  missingRateMessage,
  previewDay,
  previewOf,
  previewRow,
  withAccountDigits,
} from './one-line';
import { PaymentSheet } from './PaymentSheet';
import { useShareCategoryIds } from './queries';
import { paymentKey } from './quick-row';
import { PaidWith, TransactionRow } from './TransactionRow';
import { formToPost, rateDateFor, settledAmount, withCategoryLater } from './tx-form';
import { ratesForSave } from './tx-save';
import { moveAfterSave, postTag } from './shared-move';
import { EventChip, useEventMode } from '../events/EventMode';
import { addInCurrency, eventModeApplies } from '../events/event-mode';

/** A row saved in this sitting: the id it was posted under, the row as it was shown, and what it counts in the base currency. */
export interface SavedLine {
  id: string;
  row: ListRow;
  baseMinor: number;
}

export type Picking = 'category' | 'paid' | 'day' | 'amount' | null;

const toCategoryOption = (byId: ReadonlyMap<string, AccountRow>) => (a: AccountRow): CategoryOption => ({
  id: a.id,
  name: a.name,
  parentName: a.parentId ? (byId.get(a.parentId)?.name ?? null) : null,
});

/** The figure typed into the amount picker, through the one reader every amount field settles with; null when unread or not above zero. */
function pickedMinor(text: string, currency: string): number | null {
  const settled = settledAmount(text, currency);
  const minor = settled === null ? null : evaluateAmount(settled, currency);
  return minor !== null && minor > 0 ? minor : null;
}

/**
 * One line's sitting, wherever its field is drawn: `/transactions/line` (the widget's page) and the field a held ＋
 * docks on the keyboard over Cashflow. A purchase typed as one sentence ("kopi kenangan 38rb gopay") is read as it is
 * typed into the row it will be saved as; a part the line did not say, or a guess, reads amber, and tapping a part
 * opens the Add form's own picker for it. `save` is the Add form's save: a `FormDraft` posted through `formToPost` →
 * `ratesForSave` → `postTransaction`. After a save the field empties, keeping the day and the paid-with.
 */
export function useOneLine() {
  const { database, ws } = useApp();
  const phone = usePhone();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const openBook = useOpenBook();
  const accounts = useAccounts().data ?? [];
  const cards = (useCards().data ?? []) as CardRow[];
  const numbers = useAccountNumberLast4().data;
  const wallets = useWalletLast4().data;
  const storedDefault = useStoredDefaultPaidWith();
  const membership = useCategorySetMembership().data ?? {};
  const inBook = useInOpenBook();
  const shareIds = useShareCategoryIds();

  const today = isoDate();
  /*
   * Event mode (screen 3): each line goes to the event, its figure read in "Add in" unless it names a currency of its
   * own. The chip's ✕ leaves the next line out; the line after it is in the event again.
   */
  const eventMode = useEventMode();
  const bookShared = useIsBookShared();
  const [eventOff, setEventOff] = useState(false);
  const lineEvent = eventMode && !eventOff && eventModeApplies(eventMode, bookShared) ? eventMode : null;
  // Read off the line's own event, so ✕ drops the currency with it (fix round 1, M4).
  const typedIn = addInCurrency(lineEvent, ws.baseCurrency);
  const readIn = typedIn ?? ws.baseCurrency;
  const [text, setText] = useState('');
  const [choices, setChoices] = useState<LineChoices>({});
  const [sittingDay, setSittingDay] = useState(today);
  const [lastPaid, setLastPaid] = useState<PaymentOption | null>(null);
  const [saved, setSaved] = useState<SavedLine[]>([]);
  const [busy, setBusy] = useState(false);
  // The guard a second Return meets while the first is being written: a ref, because it must hold before React renders.
  const writing = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const [picking, setPicking] = useState<Picking>(null);
  const [amountText, setAmountText] = useState('');
  const [replaceAmount, setReplaceAmount] = useState(true);
  const field = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  // Every way to pay, each with its digits — a card's own, else the account's number or the wallet's phone — so a line
  // can name what paid by its four digits.
  const options = useMemo(
    () => withAccountDigits(payableOptions(accounts, cards), { ...(numbers ?? {}), ...(wallets ?? {}) }),
    [accounts, cards, numbers, wallets],
  );
  const defaultPaid = resolveDefaultPaidWith(storedDefault.data, options);
  const categoryOptions = offeredCategories(accounts, 'expense', membership, (a) => inBook(a) && !shareIds.has(a.id)).map(toCategoryOption(byId));

  // Read in the workspace's currency first; a figure with no currency of its own is then in what pays for it, as the
  // Add form's Amount is, so a line paid from a dollar account is read again in dollars.
  const firstReading = useMemo(() => readExpenseLine(text, { today, currency: readIn, payments: options }), [text, today, readIn, options]);
  const categoryKey = (description: string) => ['line-category', ws.workspaceId, ws.bookId, description] as const;
  const historyFor = (description: string) => guessCategoryFromHistory(database, ws, description, 'expense');
  const history = useQuery({ queryKey: categoryKey(firstReading.description), queryFn: () => historyFor(firstReading.description) });
  const contextFor = (fromHistory: string | null, description: string): LineContext => ({
    today,
    sittingDay,
    lastPaid,
    defaultPaid,
    options,
    category: categoryGuess(fromHistory, description, categoryOptions),
  });
  const firstPreview = previewOf(firstReading, contextFor(history.data ?? null, firstReading.description), choices);
  const payerCurrencyOf = (preview: LinePreview) => (preview.paid ? (byId.get(preview.paid.accountId)?.currency ?? ws.baseCurrency) : ws.baseCurrency);
  const firstPayerCurrency = payerCurrencyOf(firstPreview);
  const reading = useMemo(
    () => (typedIn || firstReading.currencyRead || firstPayerCurrency === ws.baseCurrency ? firstReading : readExpenseLine(text, { today, currency: firstPayerCurrency, payments: options })),
    [firstReading, firstPayerCurrency, ws.baseCurrency, typedIn, text, today, options],
  );
  const context = contextFor(history.data ?? null, reading.description);
  const preview = reading === firstReading ? firstPreview : previewOf(reading, context, choices);

  const payerAccount = preview.paid ? byId.get(preview.paid.accountId) : undefined;
  const payerCurrency = payerCurrencyOf(preview);
  // A purchase from money kept for spending, dated before the day its balance is counted from, is a past purchase, as
  // the Add form sets it by itself from the date.
  const moneyAccount = !!payerAccount && payerAccount.kind === 'asset' && SPENDABLE_SUBTYPES.includes(payerAccount.subtype);
  const openedOn = useOpeningDay(moneyAccount ? payerAccount : null);
  const categoryName = (id: string | null) => (id ? (byId.get(id)?.name ?? null) : null);

  // The guard is let go only once the emptied field is on screen: a Return already queued behind the save then meets an
  // empty line, never the one just saved.
  useEffect(() => {
    writing.current = false;
    setBusy(false);
  }, [saved]);

  // A picker closing hands the keyboard back to the line, for the next part or the next row.
  useEffect(() => {
    if (picking === null) field.current?.focus();
  }, [picking]);

  /** What the field's typing does: the new text, and the picks that still stand over it. */
  function type(next: string) {
    const was = firstReading;
    setText(next);
    setChoices((now) => choicesAfterTyping(now, was, readExpenseLine(next, { today, currency: readIn, payments: options }), next));
    setError(null);
  }

  /** Saves the line as it reads; the saved row, or null when nothing was written. */
  async function save(): Promise<SavedLine | null> {
    if (!canSaveLine(preview) || writing.current) return null;
    writing.current = true;
    setBusy(true);
    setError(null);
    let posted: SavedLine | null = null;
    try {
      // The history guess for this very note, so a Return pressed before it arrived still files the row where history says.
      const fromHistory = await queryClient.fetchQuery({ queryKey: categoryKey(reading.description), queryFn: () => historyFor(reading.description) });
      const line = previewOf(reading, contextFor(fromHistory, reading.description), choices);
      const amountMinor = line.amountMinor!;
      const day = line.occurredOn;
      let charged: { text: string; minor: number } | null = null;
      if (line.currency !== payerCurrency) {
        const { rates } = await resolveRates([line.currency, payerCurrency], day);
        charged = foreignCharge({ amountMinor, currency: line.currency, payerCurrency, base: ws.baseCurrency, rates });
        // Never a figure at a made-up rate: the save stops, says which pair is missing, and the line stays to try again.
        if (!charged) {
          setError(new Error(missingRateMessage(line.currency, payerCurrency, day)));
          return null;
        }
      }
      const lined = lineDraft(line, ws.bookId ?? '', charged?.text ?? '');
      // A private event is tagged as it posts; a shared one is moved into after (`postTag`, fix round 1 H2).
      const tag = postTag(lineEvent?.event.id, !!lineEvent?.shared);
      const drafted = tag.eventId ? { ...lined, eventId: tag.eventId } : lined;
      const draft = line.categoryId ? drafted : withCategoryLater(drafted, await uncategorisedCategory(database, ws, 'expense'));
      const post = formToPost(draft, accounts);
      const rateDate = rateDateFor(draft);
      // This screen has no rate row to point at, so a missing rate is told in this screen's words.
      let missing: string | null = null;
      const ratesToBase = await ratesForSave({
        database, ws, draft, post, accounts, rateDate, needsRate: null, resolveRates, onMissing: (code) => (missing = code), where: 'Add',
      }).catch((failure: unknown) => {
        throw missing ? new Error(missingRateMessage(missing, ws.baseCurrency, rateDate)) : failure;
      });
      if (post.kind !== 'post') throw new Error('This line cannot be saved here. Record it from the Add screen.');
      const id = await postTransaction(database, ws, {
        ...post.input,
        ratesToBase,
        ...(moneyAccount && isPastDefault(openedOn, day) ? { pastPurchase: true } : {}),
      });
      // Posted: from here a failure (the move, the refresh below) must not let the same line be saved again.
      const settled = charged?.minor ?? amountMinor;
      const kept: SavedLine = {
        id,
        row: { ...previewRow(line, id, categoryName(line.categoryId)), eventId: tag.eventId },
        baseMinor: baseOf(settled, payerCurrency, ws.baseCurrency, ratesToBase),
      };
      posted = kept;
      /*
       * A shared event: the purchase moves into it now, the way tagging a saved purchase into one does (shared events §6,
       * D2) — the chip said who it is shared with. One that stays (no rate yet), or a move that fails, leaves it saved
       * here, untagged, and says why; never thrown, so the line is never saved a second time. Moved, the saved row is
       * the event's own transaction, which its receipt opens.
       */
      if (tag.moveInto && lineEvent) {
        let derived: string | null = null;
        const notMoved = await moveAfterSave(
          async () => {
            const target = await sharedEventOf(database, ownerScope(ws), tag.moveInto!);
            const wanted = [target?.currency, line.currency, payerCurrency].filter((c): c is string => !!c);
            await resolveRates([...new Set(wanted)], day).catch(() => undefined);
            const result = await moveIntoSharedEvent(database, ownerScope(ws), tag.moveInto!, [id]);
            derived = result.moved[0]?.derivedId ?? null;
            return result;
          },
          { bookName: openBook?.name ?? 'this workspace', eventName: lineEvent.event.name },
        );
        if (derived) {
          kept.id = derived;
          kept.row = { ...kept.row, id: derived, eventId: tag.moveInto };
        }
        if (notMoved) setError(new Error(notMoved));
      }
      setSaved((rows) => [...rows, kept]);
      setText('');
      setChoices({});
      const after = afterSave(context, line);
      setSittingDay(after.sittingDay);
      setLastPaid(after.lastPaid);
      setEventOff(false);
      field.current?.focus();
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      // A save that wrote nothing lets go at once; one that did waits for the emptied field (the effect above).
      if (!posted) {
        writing.current = false;
        setBusy(false);
      }
    }
    return posted;
  }

  async function pickSuggestion(suggestion: NoteSuggestion) {
    setText(`${`${suggestion.description} ${reading.rest}`.trim()} `);
    setChoices((now) => ({ ...now, categoryId: suggestion.categoryId ?? undefined }));
    // What paid that shop last time, unless the line already names what paid.
    if (reading.payment) return;
    const last = await lastPaidWith(database, ws, suggestion.description);
    if (!last) return;
    const key = paymentKey(last.accountId, last.cardId);
    const same = options.filter((option) => option.accountId === last.accountId);
    const option = options.find((o) => paymentKey(o.accountId, o.cardId) === key) ?? (same.length === 1 ? same[0] : undefined);
    if (option) setChoices((now) => ({ ...now, paid: option }));
  }

  function openAmount() {
    setAmountText(preview.amountMinor === null ? '' : minorToMajorString(preview.amountMinor, preview.currency));
    setReplaceAmount(true);
    setPicking('amount');
  }

  function closeAmount() {
    const minor = pickedMinor(amountText, preview.currency);
    if (minor !== null) setChoices((now) => ({ ...now, amountMinor: minor }));
    setPicking(null);
  }

  /** One part of the preview row: a button opening its picker, amber while it is a guess or missing. */
  const part = (name: string, which: LinePart, content: ReactNode, open: () => void, missing = false) => {
    const unsure = preview.unsure.has(which);
    return (
      <button
        type="button"
        aria-label={name}
        data-unsure={unsure ? 'true' : undefined}
        data-missing={missing ? 'true' : undefined}
        // Down, not click: the line keeps the focus until the picker takes it, so the keyboard does not fold first.
        onPointerDown={(event) => event.preventDefault()}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          open();
        }}
        className={cx('rounded-sm focus-visible:outline-2 focus-visible:outline-[var(--ph-focus)]', (unsure || missing) && 'text-amber-700')}
      >
        {content}
      </button>
    );
  };
  const row = { ...previewRow(preview, 'preview', categoryName(preview.categoryId)), eventId: lineEvent?.event.id ?? null };
  const paidPart = preview.paid ? (
    <>
      <PaidWith row={row} />
      {preview.unsure.has('paid') && '?'}
    </>
  ) : (
    'Paid with?'
  );

  /** The line drawn as the list row it will be saved as, each part a way to its picker. */
  const previewNode = ({ testId = 'line-preview', className }: { testId?: string; className?: string } = {}) => (
    <TransactionRow
      still
      testId={testId}
      className={className}
      row={row}
      accounts={accounts}
      phone={phone}
      onRecategorise={() => setPicking('category')}
      label={part('Category', 'category', categoryName(preview.categoryId) ?? 'Uncategorised', () => setPicking('category'))}
      subtitle={
        <>
          {preview.description ? `${preview.description} · ` : ''}
          {part('Paid with', 'paid', paidPart, () => setPicking('paid'), !preview.paid)}
          {' · '}
          {part('Day', 'day', previewDay(preview.occurredOn, today), () => setPicking('day'))}
        </>
      }
      amount={part(
        'Amount',
        'amount',
        preview.amountMinor === null ? 'Amount?' : formatMinor(preview.amountMinor, preview.currency),
        openAmount,
        preview.amountMinor === null,
      )}
    />
  );

  /** Whichever part's picker is open: the Add form's own sheets, and the keypad on a phone. */
  const pickers = (
    <>
      {picking === 'category' && (
        <CategoryPicker
          kind="expense"
          lockKind
          value={preview.categoryId ?? undefined}
          onPick={(categoryId) => setChoices((now) => ({ ...now, categoryId }))}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === 'paid' && (
        <PaymentSheet
          title="Paid with"
          cards
          options={options}
          accounts={accounts}
          chosenAccountId={preview.paid?.accountId ?? ''}
          chosenCardId={preview.paid?.cardId ?? ''}
          onPick={(paid) => setChoices((now) => ({ ...now, paid }))}
          onClose={() => setPicking(null)}
        />
      )}
      {picking === 'day' && (
        <Sheet grouped title="Date" onClose={() => setPicking(null)}>
          <div className="pb-2">
            <FormRows>
              <DateRow on={preview.occurredOn} onChange={(occurredOn) => occurredOn && setChoices((now) => ({ ...now, occurredOn }))} />
            </FormRows>
          </div>
        </Sheet>
      )}
      {picking === 'amount' &&
        (phone ? (
          <Keypad
            value={amountText}
            currency={preview.currency}
            replaceFirst={replaceAmount}
            onFirstKey={() => setReplaceAmount(false)}
            onChange={setAmountText}
            onClose={closeAmount}
          />
        ) : (
          <Sheet grouped title="Amount" onClose={() => setPicking(null)} confirm={{ label: 'Done', run: closeAmount }}>
            <form
              className="pb-2"
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                closeAmount();
              }}
            >
              <InsetGroup>
                <TextRow
                  label="Amount"
                  prefix={preview.currency}
                  value={amountText}
                  inputMode="decimal"
                  placeholder="Amount"
                  autoFocus
                  onChange={(e) => setAmountText(e.target.value)}
                />
              </InsetGroup>
            </form>
          </Sheet>
        ))}
    </>
  );

  return {
    phone,
    today,
    text,
    type,
    reading,
    preview,
    canSave: canSaveLine(preview) && !busy,
    busy,
    error,
    saved,
    save,
    pickSuggestion,
    picking,
    field,
    accounts,
    categoryOf: (id: string) => byId.get(id)?.name,
    previewNode,
    pickers,
    /** Event mode's chip, for the screen to draw above the line; null while it is off. */
    eventChip: lineEvent ? (
      <EventChip name={lineEvent.event.name} sharedWith={lineEvent.shared?.people.map((person) => person.name)} onRemove={() => setEventOff(true)} />
    ) : null,
  };
}
