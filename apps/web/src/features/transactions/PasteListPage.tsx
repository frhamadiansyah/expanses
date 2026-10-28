import { formatMinor, groupedMajorString, groupTypedAmount, isoDate, parseGroupedMajor, parsePurchaseList, type PaymentOption } from '@expanses/core';
import { guessCategoryFromHistory, postTransactions, uncategorisedCategory } from '@expanses/db';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Check, CreditCard, Landmark } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { useBack } from '../../app/BackHeader';
import { Sheet } from '../../app/Sheet';
import { canPayWith } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import { InsetGroup, PickerRow, PushedTitle, ReadOnlyRow, SCREEN, SubmitRow, TextRow, DestructiveRow } from '../../ui/native';
import { showToast } from '../../ui/Toast';
import { useCards } from '../cards/card-queries';
import { CategoryIcon } from '../categories/CategoryIcon';
import { DateRow } from './CardRows';
import { CategoryPicker } from './CategoryPicker';
import { FormRow, FormRows, RowGlyph } from './FormRow';
import {
  addedText,
  canSave,
  purchaseInputs,
  readingKey,
  reviewHeader,
  reviewLabel,
  type ReviewRow,
  reviewRowsFrom,
  saveLabel,
  sections,
  totalMinor,
  withEdit,
  withRemoved,
} from './paste-review';
import { PaymentSheet } from './PaymentSheet';
import { paymentOptions } from './quick-row';

const route = getRouteApi('/transactions/paste');

const SURFACE = 'overflow-hidden rounded-[11px] bg-[var(--ph-surface)]';
const HEADER = 'px-[13px] pb-[6px] text-[13px] leading-4 text-[var(--ph-ink-3)] uppercase';

/** What the edit sheet holds while it is open: typed text, applied when the sheet is done. */
interface RowDraft {
  note: string;
  amount: string;
  categoryId: string;
  occurredOn: string;
}

/**
 * `/transactions/paste` — a list of purchases typed or pasted as plain notes, one to a line, read into rows to fix and then
 * saved in one go. Two steps on one address: the text with who paid and when, and the review of what was read.
 */
export function PasteListPage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const back = useBack('/transactions/new');
  const search = route.useSearch();
  const accounts = useAccounts().data ?? [];
  const cards = useCards().data ?? [];
  const invalidate = useInvalidateAll();
  const resolveRates = useResolveRates();

  const [step, setStep] = useState<'paste' | 'review'>('paste');
  const [text, setText] = useState('');
  const [date, setDate] = useState(() => isoDate());
  const [chosen, setChosen] = useState<PaymentOption | null>(null);
  const [sheet, setSheet] = useState<'payer' | null>(null);
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [readFor, setReadFor] = useState('');
  const [reading, setReading] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState<RowDraft | null>(null);
  const [picking, setPicking] = useState(false);
  const [amountError, setAmountError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Who can pay: the accounts a purchase may be paid from, each card on its own. The form's own first choice is the
  // account the Add screen was opened with, else the first listed.
  const payable = useMemo(() => paymentOptions(moneyHolders(accounts).filter((account) => canPayWith(account)), cards), [accounts, cards]);
  const carried = search.account ? payable.find((option) => option.accountId === search.account && (option.cardId ?? '') === (search.card ?? '')) : undefined;
  const payer = chosen ?? carried ?? payable[0] ?? null;
  const payerAccount = accounts.find((account) => account.id === payer?.accountId);
  const currency = payerAccount?.currency ?? ws.baseCurrency;
  const payerName = payer ? (payer.cardId ? `${payer.accountName} ···· ${payer.last4 ?? '????'}` : payer.accountName) : '';

  const lineCount = useMemo(() => parsePurchaseList(text, { today: isoDate(), currency }).length, [text, currency]);

  async function review() {
    if (lineCount === 0 || !payer || reading) return;
    const key = readingKey(text, `${payer.accountId}:${payer.cardId ?? ''}`, date);
    // Back to the text and forward again with nothing changed keeps the fixes already made.
    if (rows && key === readFor) {
      setStep('review');
      return;
    }
    setReading(true);
    try {
      const lines = parsePurchaseList(text, { today: isoDate(), currency });
      const found = await Promise.all(lines.map(async (line) => [line.lineNo, line.note ? await guessCategoryFromHistory(database, ws, line.note, 'expense') : null] as const));
      setRows(reviewRowsFrom(lines, date, Object.fromEntries(found)));
      setReadFor(key);
      setError(null);
      setStep('review');
    } finally {
      setReading(false);
    }
  }

  async function save() {
    if (!rows || !canSave(rows) || !payer || !payerAccount || busy) return;
    setBusy(true);
    setError(null);
    try {
      const uncategorised = rows.some((row) => !row.categoryId) ? await uncategorisedCategory(database, ws, 'expense') : '';
      // A payer in another currency: the day's rate for each day the list covers, asked before anything is written.
      const rates: Record<string, Record<string, number>> = {};
      if (currency !== ws.baseCurrency) {
        for (const day of new Set(rows.map((row) => row.occurredOn))) {
          const found = await resolveRates([currency], day);
          if (found.missing.length > 0) throw new Error(`No ${found.missing[0]}→${ws.baseCurrency} rate for ${day}. Add it under Add more details on the Add screen.`);
          rates[day] = found.rates;
        }
      }
      const inputs = purchaseInputs(rows, { account: payerAccount, cardId: payer.cardId }, accounts, uncategorised, (day) => rates[day]);
      // One database transaction: the whole list lands or none of it does.
      await postTransactions(database, ws, inputs);
      await invalidate();
      showToast(addedText(inputs.length));
      await navigate({ to: '/transactions', replace: true });
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }

  function open(row: ReviewRow) {
    setEditing(row.lineNo);
    setAmountError('');
    setDraft({ note: row.note, amount: row.amountMinor === null ? '' : groupedMajorString(row.amountMinor, currency), categoryId: row.categoryId, occurredOn: row.occurredOn });
  }

  function closeSheet() {
    setEditing(null);
    setDraft(null);
    setPicking(false);
    setAmountError('');
  }

  function apply() {
    if (!rows || editing === null || !draft) return;
    const before = rows.find((row) => row.lineNo === editing);
    let amountMinor: number | null = null;
    if (draft.amount.trim()) {
      try {
        amountMinor = parseGroupedMajor(draft.amount, currency);
      } catch (e) {
        setAmountError(e instanceof Error ? e.message : 'Not an amount');
        return;
      }
      if (amountMinor <= 0) {
        setAmountError('An amount above zero');
        return;
      }
    }
    // A retyped figure is the owner's word for it, so it is no longer outlined.
    const retyped = amountMinor !== before?.amountMinor;
    setRows(withEdit(rows, editing, { note: draft.note.trim(), amountMinor, categoryId: draft.categoryId, occurredOn: draft.occurredOn, ...(retyped ? { flagged: false } : {}) }));
    closeSheet();
  }

  const payGlyph = payerAccount?.subtype === 'credit_card' ? <CreditCard size={15} /> : <Landmark size={15} />;

  if (step === 'paste' || !rows) {
    return (
      <div className={SCREEN}>
        <PushedTitle
          title="Paste a list"
          back="New transaction"
          onBack={back}
          actions={[{ key: 'review', label: reviewLabel(lineCount), glyph: <ArrowRight size={20} aria-hidden />, disabled: lineCount === 0 || !payer || reading, run: () => void review() }]}
        />
        <div className="space-y-3 md:max-w-2xl">
          <div className={SURFACE}>
            <textarea
              autoFocus
              aria-label="Purchases"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="One purchase per line"
              rows={8}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              className="ph-focus-inset block min-h-[200px] w-full resize-y bg-transparent p-[14px] font-mono text-[16px] leading-6 text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] focus:outline-none"
            />
          </div>
          <FormRows>
            <FormRow
              icon={<RowGlyph>{payGlyph}</RowGlyph>}
              label="Paid with"
              value={payerName}
              onClick={() => setSheet('payer')}
            />
            <DateRow on={date} onChange={setDate} />
          </FormRows>
        </div>
        {sheet === 'payer' && (
          <PaymentSheet
            title="Paid with"
            options={payable}
            accounts={accounts}
            chosenAccountId={payer?.accountId ?? ''}
            chosenCardId={payer?.cardId ?? ''}
            cards
            onPick={(option) => setChosen(option)}
            onClose={() => setSheet(null)}
          />
        )}
      </div>
    );
  }

  const { read, unread } = sections(rows);
  const nameOf = (id: string) => accounts.find((account) => account.id === id)?.name ?? '';
  const editingRow = editing === null ? undefined : rows.find((row) => row.lineNo === editing);

  const rowButton = (row: ReviewRow) => {
    const missing = row.amountMinor === null;
    const lacksCategory = !missing && !row.categoryId;
    return (
      <div key={row.lineNo} className={cx(lacksCategory && 'rounded-[11px] outline outline-[1.5px] -outline-offset-[1.5px] outline-[var(--ph-ink-3)]')}>
        <button type="button" data-testid="review-row" data-line={row.lineNo} onClick={() => open(row)} className="ph-focus-inset relative flex w-full items-center gap-3 pl-[14px] text-left active:bg-[var(--ph-fill)]">
          {missing ? (
            <span aria-hidden className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[17px] font-semibold text-[var(--ph-ink-2)]">!</span>
          ) : (
            <CategoryIcon categoryId={row.categoryId || null} accounts={accounts} />
          )}
          <span className="ph-row-body flex min-h-[60px] min-w-0 flex-1 items-center gap-2 pr-[14px]">
            <span className="min-w-0 flex-1">
              <span className={cx('block truncate text-[17px] leading-[22px] md:text-[15px] md:leading-5', row.note ? 'text-[var(--ph-ink)]' : 'text-[var(--ph-ink-3)]')}>{row.note || 'No note'}</span>
              <span className="block truncate text-[13px] leading-4 text-[var(--ph-ink-3)]">{missing ? 'No amount' : row.categoryId ? nameOf(row.categoryId) : 'Choose a category'}</span>
            </span>
            {missing ? (
              <span aria-hidden className="shrink-0 text-[17px] text-[var(--ph-chevron)]">{'›'}</span>
            ) : (
              <span
                data-flagged={row.flagged ? 'true' : undefined}
                className={cx('tabular shrink-0 text-[16px] leading-[22px] text-[var(--ph-ink)] md:text-[15px]', row.flagged && 'rounded-md px-[6px] outline outline-[1.5px] -outline-offset-[1.5px] outline-[var(--ph-ink-2)]')}
              >
                {formatMinor(row.amountMinor!, currency)}
              </span>
            )}
          </span>
        </button>
      </div>
    );
  };

  return (
    <div className={SCREEN}>
      <PushedTitle
        title="Review"
        back="Paste a list"
        onBack={() => setStep('paste')}
        actions={[{ key: 'save', label: 'Save list', glyph: <Check size={20} aria-hidden />, disabled: !canSave(rows) || busy, run: () => void save() }]}
      />
      <form
        className="space-y-3 md:max-w-2xl"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void save();
        }}
      >
        {rows.length === 0 ? (
          <p className="py-8 text-center text-[15px] text-[var(--ph-ink-3)]">No lines left</p>
        ) : (
          <>
            <section>
              <h2 className={HEADER} data-testid="review-header">{reviewHeader(rows)}</h2>
              {read.length > 0 && <div className={cx(SURFACE, '[&>*+*>button>.ph-row-body]:border-t-[0.5px] [&>*+*>button>.ph-row-body]:border-[var(--ph-hair)]')}>{read.map(rowButton)}</div>}
            </section>
            {unread.length > 0 && (
              <section>
                <h2 className={HEADER}>Not read</h2>
                <div className={cx(SURFACE, '[&>*+*>button>.ph-row-body]:border-t-[0.5px] [&>*+*>button>.ph-row-body]:border-[var(--ph-hair)]')}>{unread.map(rowButton)}</div>
              </section>
            )}
          </>
        )}
        <InsetGroup>
          <ReadOnlyRow label="Total" value={formatMinor(totalMinor(rows), currency)} testId="review-total" />
        </InsetGroup>
        <ErrorBox error={error} />
        <InsetGroup>
          <SubmitRow label={saveLabel(rows)} disabled={!canSave(rows) || busy} testId="review-save" />
        </InsetGroup>
      </form>

      {editingRow && draft && !picking && (
        <Sheet grouped title={editingRow.amountMinor === null ? 'Not read' : 'Purchase'} onClose={closeSheet} confirm={{ label: 'Done', run: apply }}>
          <div className="space-y-3 pb-2">
            <InsetGroup>
              <TextRow label="Note" value={draft.note} placeholder="Note" onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
              <TextRow
                label="Amount"
                prefix={currency}
                value={draft.amount}
                inputMode="decimal"
                placeholder="Amount"
                onChange={(e) => {
                  setAmountError('');
                  setDraft({ ...draft, amount: groupTypedAmount(e.target.value, currency) });
                }}
              />
              <PickerRow label="Category" value={draft.categoryId ? nameOf(draft.categoryId) : ''} placeholder="Choose a category" onOpen={() => setPicking(true)} />
            </InsetGroup>
            {amountError && <p role="alert" className="px-[13px] text-[13px] leading-4 text-[var(--ph-alarm-ink)]">{amountError}</p>}
            <FormRows>
              <DateRow on={draft.occurredOn} onChange={(occurredOn) => setDraft({ ...draft, occurredOn })} />
            </FormRows>
            <InsetGroup>
              <DestructiveRow
                label="Remove"
                onClick={() => {
                  setRows(withRemoved(rows, editingRow.lineNo));
                  closeSheet();
                }}
              />
            </InsetGroup>
          </div>
        </Sheet>
      )}
      {editingRow && draft && picking && (
        <CategoryPicker
          kind="expense"
          lockKind
          value={draft.categoryId}
          onPick={(categoryId) => setDraft({ ...draft, categoryId })}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}
