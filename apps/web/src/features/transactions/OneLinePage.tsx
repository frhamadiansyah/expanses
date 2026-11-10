import { type CategoryOption, evaluateAmount, formatMinor, isoDate, minorToMajorString, type PaymentOption, readExpenseLine } from '@expanses/core';
import {
  type AccountRow,
  type CardRow,
  guessCategoryFromHistory,
  isPastDefault,
  lastPaidWith,
  type NoteSuggestion,
  noteSuggestions,
  postTransaction,
  uncategorisedCategory,
} from '@expanses/db';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Check, CornerDownLeft } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useBack } from '../../app/BackHeader';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { usePhone } from '../../app/use-phone';
import { SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { useAccounts, useInOpenBook, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { InsetGroup, PushedTitle, SCREEN, TextRow } from '../../ui/native';
import { useKeyboardInset } from '../../ui/native/KeyboardStrip';
import { payableOptions, resolveDefaultPaidWith, useStoredDefaultPaidWith } from '../account/default-paid-with';
import { useOpeningDay } from '../accounts/queries';
import { useAccountNumberLast4, useCards, useWalletLast4 } from '../cards/card-queries';
import { offeredCategories } from '../categories/offered';
import { useCategorySetMembership } from '../categories/set-queries';
import { useOpenBookReadOnly } from '../sharing/queries';
import { DateRow } from './CardRows';
import { CategoryPicker } from './CategoryPicker';
import { FormRows } from './FormRow';
import { Keypad } from './Keypad';
import type { ListRow } from './list-model';
import { NoteSuggestions } from './NoteSuggestions';
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

const SURFACE = 'rounded-[11px] bg-[var(--ph-surface)] px-3';
const HEADER = 'px-[13px] pb-[6px] text-[13px] leading-4 text-[var(--ph-ink-3)]';
/** How tall the suggested-notes strip stands over the keyboard (`KeyboardStrip`'s cells), so Save sits on top of it. */
const STRIP_HEIGHT = 48;

/** A row saved in this sitting: the id it was posted under, the row as it was shown, and what it counts in the base currency. */
interface SavedLine {
  id: string;
  row: ListRow;
  baseMinor: number;
}

type Picking = 'category' | 'paid' | 'day' | 'amount' | null;

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
 * `/transactions/line` — One line: a purchase typed as one sentence ("kopi kenangan 38rb gopay"), read as it is typed into
 * the row it will be saved as, drawn above the field exactly as the phone's Cashflow list draws it. A part the line did
 * not say, or a guess, reads amber; tapping a part opens the Add form's own picker for it. Return saves and empties the
 * field for the next, keeping the day and the paid-with. The save is the Add form's: a `FormDraft` posted through
 * `formToPost` → `ratesForSave` → `postTransaction`.
 */
export function OneLinePage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const back = useBack('/transactions');
  const readOnly = useOpenBookReadOnly();
  const phone = usePhone();
  const inset = useKeyboardInset();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();
  const accounts = useAccounts().data ?? [];
  const cards = (useCards().data ?? []) as CardRow[];
  const numbers = useAccountNumberLast4().data;
  const wallets = useWalletLast4().data;
  const storedDefault = useStoredDefaultPaidWith();
  const membership = useCategorySetMembership().data ?? {};
  const inBook = useInOpenBook();
  const shareIds = useShareCategoryIds();

  const today = isoDate();
  const [text, setText] = useState('');
  const [choices, setChoices] = useState<LineChoices>({});
  const [sittingDay, setSittingDay] = useState(today);
  const [lastPaid, setLastPaid] = useState<PaymentOption | null>(null);
  const [saved, setSaved] = useState<SavedLine[]>([]);
  const [busy, setBusy] = useState(false);
  // The guard a second Return meets while the first is being written: a ref, because it must hold before React renders.
  const writing = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const [focused, setFocused] = useState(true);
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
  const firstReading = useMemo(() => readExpenseLine(text, { today, currency: ws.baseCurrency, payments: options }), [text, today, ws.baseCurrency, options]);
  const categoryKey = (description: string) => ['line-category', ws.workspaceId, ws.bookId, description] as const;
  const historyFor = (description: string) => guessCategoryFromHistory(database, ws, description, 'expense');
  const history = useQuery({ queryKey: categoryKey(firstReading.description), queryFn: () => historyFor(firstReading.description) });
  const contextFor = (historyId: string | null, description: string): LineContext => ({
    today,
    sittingDay,
    lastPaid,
    defaultPaid,
    options,
    category: categoryGuess(historyId, description, categoryOptions),
  });
  const firstPreview = previewOf(firstReading, contextFor(history.data ?? null, firstReading.description), choices);
  const payerCurrencyOf = (preview: LinePreview) => (preview.paid ? (byId.get(preview.paid.accountId)?.currency ?? ws.baseCurrency) : ws.baseCurrency);
  const firstPayerCurrency = payerCurrencyOf(firstPreview);
  const reading = useMemo(
    () => (firstReading.currencyRead || firstPayerCurrency === ws.baseCurrency ? firstReading : readExpenseLine(text, { today, currency: firstPayerCurrency, payments: options })),
    [firstReading, firstPayerCurrency, ws.baseCurrency, text, today, options],
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

  // The suggested-notes strip's own query, read here too (one cache entry), so Save can stand on top of the strip.
  const want = reading.description.trim();
  const suggestionsOn = phone && focused && want.length >= 2;
  const suggestions = useQuery({
    queryKey: ['note-suggestions', ws.workspaceId, ws.bookId ?? '', 'expense', want.toLowerCase()],
    queryFn: () => noteSuggestions(database, ws, want, 'expense'),
    enabled: suggestionsOn,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const lift = suggestionsOn && (suggestions.data?.length ?? 0) > 0 ? STRIP_HEIGHT : 0;

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

  async function save() {
    if (!canSaveLine(preview) || writing.current) return;
    writing.current = true;
    setBusy(true);
    setError(null);
    let posted = false;
    try {
      // The history guess for this very note, so a Return pressed before it arrived still files the row where history says.
      const historyId = await queryClient.fetchQuery({ queryKey: categoryKey(reading.description), queryFn: () => historyFor(reading.description) });
      const line = previewOf(reading, contextFor(historyId, reading.description), choices);
      const amountMinor = line.amountMinor!;
      const day = line.occurredOn;
      let charged: { text: string; minor: number } | null = null;
      if (line.currency !== payerCurrency) {
        const { rates } = await resolveRates([line.currency, payerCurrency], day);
        charged = foreignCharge({ amountMinor, currency: line.currency, payerCurrency, base: ws.baseCurrency, rates });
        // Never a figure at a made-up rate: the save stops, says which pair is missing, and the line stays to try again.
        if (!charged) {
          setError(new Error(missingRateMessage(line.currency, payerCurrency, day)));
          return;
        }
      }
      const drafted = lineDraft(line, ws.bookId ?? '', charged?.text ?? '');
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
      // Posted: from here a failure (the refresh below) must not let the same line be saved again.
      posted = true;
      const settled = charged?.minor ?? amountMinor;
      setSaved((rows) => [...rows, { id, row: previewRow(line, id, categoryName(line.categoryId)), baseMinor: baseOf(settled, payerCurrency, ws.baseCurrency, ratesToBase) }]);
      setText('');
      setChoices({});
      const kept = afterSave(context, line);
      setSittingDay(kept.sittingDay);
      setLastPaid(kept.lastPaid);
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

  if (readOnly) {
    return (
      <div className={SCREEN}>
        <PushedTitle title="One line" back="Cashflow" onBack={back} />
        <p className="px-[13px] text-[15px] text-[var(--ph-ink-2)]" data-testid="line-read-only">
          This workspace is read-only, so nothing can be added to it.
        </p>
      </div>
    );
  }

  const total = saved.reduce((sum, line) => sum + line.baseMinor, 0);
  const canSave = canSaveLine(preview) && !busy;

  /** One part of the preview row: a button opening its picker, amber while it is a guess or missing. */
  const part = (name: string, which: LinePart, content: ReactNode, open: () => void, missing = false) => {
    const unsure = preview.unsure.has(which);
    return (
      <button
        type="button"
        aria-label={name}
        data-unsure={unsure ? 'true' : undefined}
        data-missing={missing ? 'true' : undefined}
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
  const row = previewRow(preview, 'preview', categoryName(preview.categoryId));
  const paidPart = preview.paid ? (
    <>
      <PaidWith row={row} />
      {preview.unsure.has('paid') && '?'}
    </>
  ) : (
    'Paid with?'
  );

  const saveBar = (
    <div className="flex items-center gap-3 px-[13px] py-2">
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ph-ink-3)]">Tap the row to change a part</span>
      <button
        type="button"
        disabled={!canSave}
        // Down, not click: the line keeps the focus, so the keyboard stays up for the next row.
        onPointerDown={(e) => e.preventDefault()}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void save()}
        className="ph-focus inline-flex items-center gap-1 rounded-md px-2 py-1 text-[15px] font-semibold text-[var(--ph-tint)] disabled:opacity-40"
      >
        Save
        <CornerDownLeft size={15} aria-hidden />
      </button>
    </div>
  );
  // Over the keyboard while the line is being typed in on a phone; with no keyboard up (a wide screen, a phone's browser
  // with a hardware keyboard) at the foot of what is typed, rather than over the tab bar.
  const floating = phone && focused && inset > 0;

  return (
    <div className={SCREEN}>
      <PushedTitle title="One line" back="Cashflow" onBack={back} actions={[{ key: 'done', label: 'Done', glyph: <Check size={20} aria-hidden />, run: back }]} />
      <div className={cx('space-y-3 md:max-w-2xl', floating && 'pb-24')}>
        {saved.length > 0 && (
          <section>
            <h2 className={HEADER} data-testid="line-saved">
              {saved.length} saved · {formatMinor(total, ws.baseCurrency)}
            </h2>
            <ul className={cx(SURFACE, 'divide-y divide-[var(--ph-hair)]')}>
              {saved.map((line) => (
                <TransactionRow
                  key={line.id}
                  row={line.row}
                  accounts={accounts}
                  testId="line-saved-row"
                  phone={phone}
                  onOpen={() => void navigate({ to: '/transactions/$transactionId/edit', params: { transactionId: line.id } })}
                />
              ))}
            </ul>
          </section>
        )}

        <p className="px-[13px] text-[13px] leading-4 text-[var(--ph-ink-3)]">Shop, amount and how it was paid. Add “yesterday” or a date for another day.</p>

        <section>
          <h2 className={HEADER}>Will be saved as</h2>
          <ul className={cx(SURFACE, 'outline outline-1 -outline-offset-1 outline-[var(--ph-tint)]')}>
            <TransactionRow
              still
              testId="line-preview"
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
          </ul>
        </section>

        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="rounded-[11px] bg-[var(--ph-surface)]">
            <input
              ref={field}
              aria-label="One line"
              placeholder="Shop, amount, card"
              autoFocus
              enterKeyHint="done"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={text}
              onChange={(e) => {
                const next = e.target.value;
                const was = firstReading;
                setText(next);
                setChoices((now) => choicesAfterTyping(now, was, readExpenseLine(next, { today, currency: ws.baseCurrency, payments: options }), next));
                setError(null);
              }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              className="ph-focus-inset block h-[48px] w-full rounded-[11px] bg-transparent px-[14px] text-[17px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none"
            />
          </div>
        </form>
        <ErrorBox error={error} />
        {!floating && saveBar}
      </div>

      {floating && (
        <div
          className="fixed inset-x-0 z-50 border-t-[0.5px] border-[var(--ph-hair)] bg-[var(--ph-bar)]"
          style={{
            bottom: inset + lift,
            backdropFilter: 'saturate(180%) blur(20px)',
            WebkitBackdropFilter: 'saturate(180%) blur(20px)',
          }}
        >
          {saveBar}
        </div>
      )}
      <NoteSuggestions typed={reading.description} kind="expense" open={focused} categoryName={(id) => byId.get(id)?.name} onPick={(s) => void pickSuggestion(s)} />

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
    </div>
  );
}
