import { formatMinor } from '@expanses/core';
import type { AccountRow, TransactionView } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { Lock, RotateCcw, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Button, cx } from '../../ui';
import { isEditable } from './draft';
import { billTagOf, type ListRow } from './list-model';
import { QuickRowEditor, ROW_GRID, type RowOptions } from './QuickRowEditor';
import { isQuickEditable, parsePastedRows, quickFromDraft, quickFromTransaction, type QuickValues, readQuick, shortDate, valuesFromCells } from './quick-row';

export interface TableHandlers {
  busy: string | null;
  /** Posts a typed row. Resolves false when it could not, so the row keeps what was typed. */
  recordTyped: (values: QuickValues) => Promise<boolean>;
  /** Keeps a typed row as not recorded, to finish later. */
  keepTyped: (values: QuickValues) => Promise<boolean>;
  keepPasted: (rows: QuickValues[]) => Promise<boolean>;
  guessCategory: (description: string) => Promise<string | null>;
  saveRecorded: (id: string, values: QuickValues) => Promise<boolean>;
  saveDraft: (id: string, values: QuickValues, record: boolean) => Promise<boolean>;
  dismissDraft: (id: string) => Promise<boolean>;
  deleteRecorded: (id: string) => Promise<boolean>;
  /** The full form, for a row too involved to edit as cells. */
  renderForm: (tx: TransactionView, onDone: () => void) => ReactNode;
  tradeIds: ReadonlySet<string>;
}

const same = (a: QuickValues, b: QuickValues) => (Object.keys(a) as (keyof QuickValues)[]).every((key) => a[key] === b[key]);
const currencyOf = (values: QuickValues, accounts: readonly AccountRow[], base: string) => accounts.find((a) => a.id === values.accountId)?.currency ?? base;

/** Deleting asks twice, in place. */
function TwoTap({ busy, label, onConfirm }: { busy: boolean; label: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      aria-label={armed ? `Click again to ${label.toLowerCase()}` : label}
      title={armed ? 'Click again' : label}
      onBlur={() => setArmed(false)}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
      className={cx('inline-flex h-8 items-center justify-center rounded-lg px-2 text-xs font-medium', armed ? 'bg-red-700 text-white' : 'text-slate-400 hover:bg-slate-100 hover:text-red-700')}
    >
      {armed ? 'Sure?' : <X size={16} aria-hidden />}
    </button>
  );
}

function TypingRow({ options, accounts, today, baseCurrency, handlers }: { options: RowOptions; accounts: readonly AccountRow[]; today: string; baseCurrency: string; handlers: TableHandlers }) {
  const blank = (carry?: QuickValues): QuickValues => ({ date: carry?.date ?? shortDate(today, today), description: '', amount: '', accountId: carry?.accountId ?? '', cardId: carry?.cardId ?? '', categoryId: '' });
  const [values, setValues] = useState<QuickValues>(() => blank());
  const [guessed, setGuessed] = useState(false);
  const touched = values.description !== '' || values.amount !== '' || values.categoryId !== '';
  const { needs } = readQuick(values, accounts, today, baseCurrency);
  const busy = handlers.busy === 'typing';

  // The date and the account carry down to the next row, since a batch is usually one day and one card.
  const reset = () => {
    setValues(blank(values));
    setGuessed(false);
  };
  const record = async () => {
    if (needs.length === 0 ? await handlers.recordTyped(values) : await handlers.keepTyped(values)) reset();
  };

  return (
    <div data-testid="typing-row" className="border-b border-slate-200 bg-slate-50/60">
      <QuickRowEditor
        values={values}
        onChange={(patch) => {
          if ('categoryId' in patch) setGuessed(false);
          setValues((v) => ({ ...v, ...patch }));
        }}
        needs={touched ? needs : []}
        options={options}
        currency={currencyOf(values, accounts, baseCurrency)}
        className="p-0.5"
        onSubmit={() => touched && !busy && void record()}
        onCancel={reset}
        onDescriptionBlur={() => {
          const description = values.description.trim();
          if (!description || values.categoryId) return;
          void handlers.guessCategory(description).then((categoryId) => {
            if (!categoryId) return;
            setValues((v) => (v.categoryId ? v : { ...v, categoryId }));
            setGuessed(true);
          });
        }}
        onPaste={(text) => {
          const rows = parsePastedRows(text);
          if (rows.length === 0) return false;
          void handlers.keepPasted(rows.map((cells) => valuesFromCells(cells, { paid: options.resolvePaid, category: options.resolveCategory }, today)));
          return true;
        }}
        actions={
          <>
            <Button className="px-2.5 py-1.5" disabled={!touched || needs.length > 0 || busy} title={needs.length ? `Needs ${needs.join(' & ')}` : 'Record this row'} onClick={() => void record()}>
              Record
            </Button>
            <Button variant="ghost" className="px-2 py-1.5 text-xs" disabled={!touched || busy} title="Keep it as not recorded, to finish later" onClick={() => void handlers.keepTyped(values).then((ok) => ok && reset())}>
              Later
            </Button>
          </>
        }
      />
      <p className="px-2.5 pb-1.5 text-xs text-slate-500">
        {guessed ? 'Category guessed from the last time you bought here · ' : ''}Type a row and press <kbd>Enter</kbd> · paste rows straight from a spreadsheet · an incomplete row waits as not recorded
      </p>
    </div>
  );
}

function EditableRow({ row, options, accounts, today, baseCurrency, handlers }: { row: ListRow; options: RowOptions; accounts: readonly AccountRow[]; today: string; baseCurrency: string; handlers: TableHandlers }) {
  const isDraft = row.kind === 'draft';
  const initial = isDraft ? quickFromDraft(row.draft!, today) : quickFromTransaction(row.tx!, today);
  const [values, setValuesState] = useState(initial);
  // Leaving the row saves a draft; the cell being left settles its own value in the same moment, so the
  // save reads the newest values from here rather than from a render that has not happened yet.
  const latest = useRef(values);
  const setValues = (next: QuickValues | ((v: QuickValues) => QuickValues)) => {
    latest.current = typeof next === 'function' ? next(latest.current) : next;
    setValuesState(latest.current);
  };
  const initialKey = JSON.stringify(initial);
  // Once a save lands the row is read again; what it now holds is the new starting point.
  useEffect(() => {
    latest.current = JSON.parse(initialKey) as QuickValues;
    setValuesState(latest.current);
  }, [initialKey]);
  const dirty = !same(values, initial);
  const { needs } = readQuick(values, accounts, today, baseCurrency);
  const busy = handlers.busy === row.id;
  const billTag = isDraft ? null : billTagOf(row.tx!);

  const save = () => {
    if (isDraft) void handlers.saveDraft(row.id, values, needs.length === 0);
    else if (dirty && needs.length === 0) void handlers.saveRecorded(row.id, values);
  };

  return (
    <div
      data-testid={isDraft ? 'not-recorded-row' : 'table-row'}
      className={cx(
        'border-b border-slate-100',
        isDraft && 'bg-amber-50/70 shadow-[inset_3px_0_0_#f59e0b]',
        !isDraft && dirty && 'bg-indigo-50/60 shadow-[inset_3px_0_0_#6366f1]',
      )}
      onBlur={(event) => {
        // A draft keeps what was typed as soon as the row is left, the way a sheet does.
        if (!isDraft || event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        if (!same(latest.current, initial)) void handlers.saveDraft(row.id, latest.current, false);
      }}
    >
      <QuickRowEditor
        values={values}
        onChange={(patch) => setValues((v) => ({ ...v, ...patch }))}
        needs={isDraft || dirty ? needs : []}
        options={options}
        currency={currencyOf(values, accounts, baseCurrency)}
        className="p-0.5"
        onSubmit={save}
        onCancel={() => setValues(initial)}
        actions={
          isDraft ? (
            <>
              <Button className="px-2.5 py-1.5" disabled={needs.length > 0 || busy} title={needs.length ? `Needs ${needs.join(' & ')}` : 'Record this row'} aria-label={`Record ${values.description || 'row'}`} onClick={() => void handlers.saveDraft(row.id, values, true)}>
                Record
              </Button>
              <TwoTap busy={busy} label="Discard" onConfirm={() => void handlers.dismissDraft(row.id)} />
            </>
          ) : dirty ? (
            <>
              <Button className="px-2.5 py-1.5" disabled={needs.length > 0 || busy} title={needs.length ? `Needs ${needs.join(' & ')}` : 'Save the change'} onClick={save}>
                Save
              </Button>
              <Button variant="ghost" className="px-2 py-1.5" aria-label="Undo changes" title="Undo changes" onClick={() => setValues(initial)}>
                <RotateCcw size={15} aria-hidden />
              </Button>
            </>
          ) : (
            <>
              {billTag && <BillTag text={billTag} />}
              <TwoTap busy={busy} label="Delete" onConfirm={() => void handlers.deleteRecorded(row.id)} />
            </>
          )
        }
      />
    </div>
  );
}

/** Paid in one month for another's bill, as on the list: counted in the budget in its bill month, shown on the day paid. */
function BillTag({ text }: { text: string }) {
  return <span className="rounded bg-slate-100 px-1.5 text-xs whitespace-nowrap text-slate-500">{text}</span>;
}

function LockedRow({ row, today, handlers }: { row: ListRow; today: string; handlers: TableHandlers }) {
  const [form, setForm] = useState(false);
  const tx = row.tx!;
  const sign = row.type === 'expense' ? '−' : row.type === 'income' ? '+' : '';
  const kind = { debt: 'Lend & borrow', transfer: 'Transfer', opening: 'Opening balance' }[row.type as 'debt' | 'transfer' | 'opening'];
  const why = row.type === 'expense' ? 'split or priced in another currency' : row.type === 'income' ? 'income' : 'money moving between accounts';
  return (
    <div data-testid="table-row" className={cx('border-b border-slate-100', row.deleted && 'opacity-50')}>
      <div className={cx(ROW_GRID, 'p-0.5 text-sm', row.deleted && 'line-through')}>
        <span className="tabular truncate px-2 text-slate-500">{shortDate(row.date, today)}</span>
        <span className="truncate px-2">
          {row.description}
          {billTagOf(tx) && (
            <span className="ml-2">
              <BillTag text={billTagOf(tx)!} />
            </span>
          )}
        </span>
        <span className={cx('tabular truncate px-2 text-right font-medium', row.type === 'income' && 'text-emerald-700', kind && 'text-slate-500')}>
          {sign}
          {formatMinor(row.amountMinor, row.currency)}
        </span>
        <span className="truncate px-2 text-slate-600">
          {row.accountLabel}
          {row.last4 && <span className="tabular ml-1 text-xs font-semibold">{row.last4}</span>}
        </span>
        <span className="truncate px-2 text-slate-600">{kind ? <span className="rounded bg-slate-100 px-1.5 text-xs text-slate-500">{kind}</span> : row.categoryName}</span>
        <span className="flex justify-end pl-1">
          {handlers.tradeIds.has(tx.id) ? (
            <Link to="/net-worth/trades" className="px-2 text-xs text-slate-500 underline">
              Buy &amp; sell
            </Link>
          ) : (
            !row.deleted &&
            isEditable(tx) && (
              <button type="button" onClick={() => setForm((open) => !open)} title={`Edited in the form: ${why}`} className="inline-flex items-center gap-1 px-2 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-900">
                <Lock size={12} aria-hidden />
                Open in form
              </button>
            )
          )}
        </span>
      </div>
      {form && (
        <div className="space-y-1 px-2 pb-3">
          {handlers.renderForm(tx, () => setForm(false))}
          <div className="flex justify-end">
            <TwoTap busy={handlers.busy === tx.id} label="Delete" onConfirm={() => void handlers.deleteRecorded(tx.id)} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Every transaction as a sheet: typed into, pasted into, corrected cell by cell. Rows not recorded sit
 * among the rest, told apart by their colour and the Record button at the end.
 */
export function TransactionsTable({
  rows,
  options,
  accounts,
  today,
  baseCurrency,
  handlers,
  empty,
}: {
  rows: readonly ListRow[];
  options: RowOptions;
  accounts: readonly AccountRow[];
  today: string;
  baseCurrency: string;
  handlers: TableHandlers;
  empty: ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="min-w-[54rem]">
        <div className={cx(ROW_GRID, 'border-b border-slate-200 px-0.5 py-1.5 text-xs font-medium text-slate-500')}>
          <span className="px-2">Date</span>
          <span className="px-2">Description</span>
          <span className="px-2 text-right">Amount</span>
          <span className="px-2">Paid with</span>
          <span className="px-2">Category</span>
          <span />
        </div>
        <TypingRow options={options} accounts={accounts} today={today} baseCurrency={baseCurrency} handlers={handlers} />
        {rows.length === 0 && <div className="px-3 py-6 text-center text-sm text-slate-500">{empty}</div>}
        {rows.map((row) => {
          const key = row.kind === 'draft' ? `d:${row.id}` : `t:${row.id}`;
          if (row.kind === 'draft' || (!row.deleted && !handlers.tradeIds.has(row.id) && isQuickEditable(row.tx!))) {
            return <EditableRow key={key} row={row} options={options} accounts={accounts} today={today} baseCurrency={baseCurrency} handlers={handlers} />;
          }
          return <LockedRow key={key} row={row} today={today} handlers={handlers} />;
        })}
      </div>
    </div>
  );
}
