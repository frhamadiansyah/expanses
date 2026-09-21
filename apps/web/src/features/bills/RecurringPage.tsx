import { isoDate } from '@expanses/core';
import { type MonthlyBill, skipBill, undoBillPayments, unskipBill } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { Check, ListChecks, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox, Money } from '../../ui';
import { type CornerAction, Hero, GROUP_GAP, GROUP_RADIUS, InsetGroup, InsetRow, LargeTitle, PanelHeader, SCREEN, type Tone, toneClass } from '../../ui/native';
import { BillRow } from './BillRow';
import { amountOf, billsInReadCurrency, isSettled, paidText, sectionsOf, skippedText, summaryOf } from './bill-view';
import { PaySeveralSheet } from './PaySeveralSheet';
import { PaySheet } from './PaySheet';
import { useMonthlyBills } from './queries';
import { useBookMoney } from '../workspaces/queries';
import { Unconverted } from '../workspaces/Unconverted';
import { UndoToast } from '../../ui/UndoToast';

const LINE_TONE: Record<'overdue' | 'dueSoon' | 'later', Tone> = { overdue: 'alarm', dueSoon: 'warn', later: 'ink-3' };
const SECTION_TONE: Record<string, Tone> = { overdue: 'alarm', dueSoon: 'warn' };

/**
 * The month's bills, most urgent first: what is still to pay, what is late, and what is done. A row pays or skips with a
 * swipe on a phone, or through its ⋯ menu with a mouse; either way an Undo follows for a few seconds.
 */
export function RecurringPage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const bills = useMonthlyBills(today);
  const accounts = useAccounts().data ?? [];
  const rows = bills.data ?? [];

  const [paying, setPaying] = useState<MonthlyBill | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [payingSeveral, setPayingSeveral] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo: () => Promise<void> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const clearToast = useCallback(() => setToast(null), []);
  // Stable, so the sheet does not re-run its open effect (and take focus back) whenever the list refreshes.
  const closeSheet = useCallback(() => setPaying(null), []);
  const closeSeveral = useCallback(() => setPayingSeveral(false), []);

  const toggle = (bill: MonthlyBill) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(bill.id)) next.delete(bill.id);
      else next.add(bill.id);
      return next;
    });

  const doneSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };

  const currencyOf = (bill: MonthlyBill) => accounts.find((account) => account.id === bill.moneyAccountId)?.currency ?? ws.baseCurrency;

  // Each row says what its own bill costs, in the money it is paid with. The totals add rows up, so they cannot:
  // every amount is brought into the currency this workspace reads in first, and what no rate reaches is left out
  // of the sum and named above it, rather than added in as though a dollar were a rupiah.
  const money = useBookMoney().data;
  const readCurrency = money?.currency ?? ws.baseCurrency;
  const { rows: readRows, unconverted } = billsInReadCurrency(rows, money, currencyOf);

  const pay = (bill: MonthlyBill) => setPaying(bill);

  async function skip(bill: MonthlyBill) {
    setError(null);
    const month = bill.billMonth;
    try {
      await skipBill(database, ws, bill.id, month);
      await invalidate();
      setToast({ text: skippedText(bill.name, month, today), undo: () => unskipBill(database, ws, bill.id, month) });
    } catch (e) {
      setError(e);
    }
  }

  const paid = (bill: MonthlyBill) => (ids: string[]) => {
    setPaying(null);
    setToast({ text: `Paid ${bill.name}`, undo: () => undoBillPayments(database, ws, ids) });
  };

  async function undo() {
    if (!toast) return;
    const t = toast;
    setToast(null);
    try {
      await t.undo();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const summary = summaryOf(readRows, today);

  const title = selecting ? `${picked.size} selected` : 'Recurring';
  // Glyphs at every width, with the names they always had: a screen reader and a test still hear "New bill".
  const actions: CornerAction[] = selecting
    ? [{ key: 'done', label: 'Done', glyph: <Check size={20} aria-hidden />, run: doneSelecting }]
    : [
        { key: 'select', label: 'Select bills to pay', glyph: <ListChecks size={20} aria-hidden />, run: () => setSelecting(true) },
        { key: 'new', label: 'New bill', glyph: <Plus size={22} aria-hidden />, to: '/bills/new' },
      ];

  return (
    <div className={SCREEN}>
      <LargeTitle title={title} actions={actions} />

      <ErrorBox error={error ?? bills.error} />

      {bills.isSuccess && rows.length === 0 && (
        <InsetGroup footer="No bills set up. The phone, the water, the gas — whatever comes round.">
          <InsetRow title={<span className="text-[var(--ph-tint)]">New bill</span>} label="New bill" to="/bills/new" />
        </InsetGroup>
      )}

      {rows.length > 0 && (
        <div data-testid="bills-summary" className="md:max-w-2xl">
          <Unconverted missing={unconverted} currency={readCurrency} />
          {/* The month's figure is the point of the page, so it is the hero; what it is made of is the group below. */}
          <Hero
            className="pt-[6px]"
            minor={summary.totalMinor}
            currency={readCurrency}
            approximate={summary.approximate}
            caption={
              <>
                Still to pay in {summary.monthLabel}
                {summary.variesText && <> · {summary.variesText}</>}
              </>
            }
          />
          {(summary.lines.length > 0 || summary.allSettled) && (
            <InsetGroup>
              {[
                ...summary.lines.map((line) => (
                  <InsetRow
                    key={line.key}
                    title={<span className={toneClass(LINE_TONE[line.key])}>{line.label}</span>}
                    label={line.label}
                    value={
                      <>
                        {line.approximate && '~'}
                        <Money minor={line.minor} currency={readCurrency} />
                      </>
                    }
                    valueTone="ink"
                  />
                )),
                ...(summary.allSettled
                  ? [<InsetRow key="settled" title={<span className="text-[var(--ph-tint)]">All paid for {summary.monthLabel}</span>} value={<span aria-hidden>✓</span>} valueTone="tint" />]
                  : []),
              ]}
            </InsetGroup>
          )}
        </div>
      )}

      {sectionsOf(rows).map((section) => (
        /* A header in the section's own tone — overdue in alarm, due soon in warning — outside and above its group. */
        <section key={section.key} className="md:max-w-2xl" style={{ marginBottom: GROUP_GAP }}>
          <PanelHeader title={<span className={toneClass(SECTION_TONE[section.key] ?? 'ink-3')}>{section.title}</span>} />
          {/* The group's surface without its clipping: a row's ⋯ menu may hang below it. */}
          <div className={cx('bg-[var(--ph-surface)]', section.key === 'settled' && 'opacity-60')} style={{ borderRadius: GROUP_RADIUS }}>
          {section.rows.map((bill, index) => (
            <BillRow
              key={bill.id}
              bill={bill}
              accounts={accounts}
              today={today}
              currency={currencyOf(bill)}
              onPay={pay}
              onSkip={(b) => void skip(b)}
              selecting={selecting}
              picked={picked.has(bill.id)}
              onToggle={toggle}
              separator={index > 0}
            />
          ))}
          </div>
        </section>
      ))}

      {selecting && picked.size > 0 && (() => {
        const chosen = readRows.filter((b) => picked.has(b.id));
        const approximate = chosen.some((b) => b.amountMinor === null);
        return (
          <button
            type="button"
            onClick={() => setPayingSeveral(true)}
            className="ph-focus fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 mx-auto flex min-h-12 max-w-md items-center justify-between rounded-[14px] bg-[var(--ph-tint)] px-4 text-[15px] font-semibold text-white shadow-lg md:sticky md:bottom-6 md:mt-4 md:w-full"
          >
            <span>Pay {picked.size} selected</span>
            <span className="tabular">
              {approximate && '~'}
              <Money minor={chosen.reduce((s, b) => s + amountOf(b), 0)} currency={readCurrency} /> ›
            </span>
          </button>
        );
      })()}

      {toast && <UndoToast text={toast.text} onUndo={() => void undo()} onDone={clearToast} />}

      {payingSeveral && (
        <PaySeveralSheet
          bills={rows.filter((b) => !isSettled(b))}
          picked={picked}
          today={today}
          onClose={closeSeveral}
          onPaid={(ids, names) => {
            setPayingSeveral(false);
            setSelecting(false);
            setPicked(new Set());
            // Named from what the sheet recorded: its ticks can differ from what was picked on the list.
            setToast({ text: paidText(names), undo: () => undoBillPayments(database, ws, ids) });
          }}
        />
      )}

      {paying && (
        <PaySheet
          bill={paying}
          today={today}
          onClose={closeSheet}
          onPaid={paid(paying)}
          onSkipped={(month) => {
            const b = paying;
            setPaying(null);
            setToast({ text: skippedText(b.name, month, today), undo: () => unskipBill(database, ws, b.id, month) });
          }}
          onSeeBill={() => navigate({ to: '/bills/$billId', params: { billId: paying.id } })}
        />
      )}
    </div>
  );
}
