import { isoDate } from '@expanses/core';
import { type MonthlyBill, skipBill, undoBillPayments, unskipBill } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { Check, ListChecks, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Sheet } from '../../app/Sheet';
import { ErrorBox, Money } from '../../ui';
import { type CornerAction, GROUP_GAP, GROUP_RADIUS, InsetGroup, InsetRow, LargeTitle, Panel, PanelHeader, SCREEN } from '../../ui/native';
import { BillRow } from './BillRow';
import { amountOf, billsInReadCurrency, type BillSummary, isSettled, paidText, sectionsOf, settledOf, skippedText, summaryOf } from './bill-view';
import { PaySeveralSheet } from './PaySeveralSheet';
import { PaySheet } from './PaySheet';
import { useMonthlyBills } from './queries';
import { useBookMoney } from '../workspaces/queries';
import { Unconverted } from '../workspaces/Unconverted';
import { UndoToast } from '../../ui/UndoToast';

/** The bar's three parts in the kit's own tones: late in alarm, soon in warning, the rest a quiet grey. */
const PART_COLOUR: Record<BillSummary['parts'][number]['key'], string> = { overdue: 'var(--ph-alarm)', dueSoon: 'var(--ph-warn)', later: 'var(--ph-ink-3)' };

/**
 * The month's figure, in the box it is made of: what is still to pay, a bar dividing it into late, soon and later,
 * and the key under the bar naming each part's money. Once everything is dealt with it says so, and nothing more.
 */
function StillToPay({ summary, currency }: { summary: BillSummary; currency: string }) {
  if (summary.allSettled) {
    return (
      <Panel>
        <p className="text-[17px] leading-[22px] font-semibold text-[var(--ph-tint)]">
          All paid for {summary.monthLabel} <span aria-hidden>✓</span>
        </p>
      </Panel>
    );
  }
  const total = summary.parts.reduce((sum, part) => sum + part.minor, 0);
  return (
    <Panel className="space-y-3">
      <div>
        <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Still to pay in {summary.monthLabel}</p>
        <p className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]" data-testid="bills-total">
          {/* The estimate sign is a caveat, not part of the figure: it wears the quiet ink. */}
          {summary.approximate && <span className="text-[var(--ph-ink-3)]">≈ </span>}
          <Money minor={summary.totalMinor} currency={currency} />
        </p>
      </div>
      {total > 0 && (
        <>
          <span aria-hidden className="flex w-full gap-[2px] overflow-hidden rounded-full bg-[var(--ph-track)]" style={{ height: 6 }}>
            {summary.parts.map((part) => (
              <span key={part.key} className="block h-full" style={{ width: `${(part.minor / total) * 100}%`, background: PART_COLOUR[part.key] }} />
            ))}
          </span>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]" data-testid="bills-legend">
            {summary.parts.map((part) => (
              <li key={part.key} className="flex items-center gap-[6px]">
                <span aria-hidden className="block h-2 w-2 rounded-full" style={{ background: PART_COLOUR[part.key] }} />
                {part.label}{' '}
                <span className="tabular text-[var(--ph-ink-2)]">
                  {part.approximate && '~'}
                  <Money minor={part.minor} currency={currency} />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {summary.variesText && <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{summary.variesText}</p>}
    </Panel>
  );
}

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
  const [showSettled, setShowSettled] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo: () => Promise<void> } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const clearToast = useCallback(() => setToast(null), []);
  // Stable, so the sheet does not re-run its open effect (and take focus back) whenever the list refreshes.
  const closeSheet = useCallback(() => setPaying(null), []);
  const closeSeveral = useCallback(() => setPayingSeveral(false), []);
  const closeSettled = useCallback(() => setShowSettled(false), []);

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
  // The rows in their own money, the figure in the money the workspace reads in.
  const settled = settledOf(rows, today);
  const settledMinor = settledOf(readRows, today)?.paidMinor ?? 0;
  // An undo can empty the fold under its open sheet; it stays shut rather than springing open at the next payment.
  const noneSettled = settled === null;
  useEffect(() => {
    if (noneSettled) setShowSettled(false);
  }, [noneSettled]);

  const billRow = (bill: MonthlyBill, index: number) => (
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
  );

  const title = selecting ? `${picked.size} selected` : 'Recurring';
  // Glyphs at every width, with the names they always had: a screen reader and a test still hear "New bill".
  const actions: CornerAction[] = selecting
    ? [{ key: 'done', label: 'Done', glyph: <Check size={22} aria-hidden />, run: doneSelecting }]
    : [
        { key: 'select', label: 'Select bills to pay', glyph: <ListChecks size={20} aria-hidden />, run: () => setSelecting(true) },
        { key: 'new', label: 'New bill', glyph: <Plus size={22} aria-hidden />, to: '/bills/new' },
      ];

  return (
    <div className={SCREEN}>
      <LargeTitle title={title} actions={actions} />

      <ErrorBox error={error ?? bills.error} />

      {bills.isSuccess && rows.length === 0 && (
        <InsetGroup>
          <InsetRow title={<span className="text-[var(--ph-tint)]">New bill</span>} label="New bill" to="/bills/new" />
        </InsetGroup>
      )}

      {rows.length > 0 && (
        <div data-testid="bills-summary" className="md:max-w-2xl">
          <Unconverted missing={unconverted} currency={readCurrency} />
          <StillToPay summary={summary} currency={readCurrency} />
        </div>
      )}

      {sectionsOf(rows).map((section) => (
        <section key={section.key} className="md:max-w-2xl" style={{ marginBottom: GROUP_GAP }}>
          <PanelHeader title={section.title} />
          {/* The group's surface without its clipping: a row's ⋯ menu may hang below it. */}
          <div className="bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS }}>
            {section.rows.map(billRow)}
          </div>
        </section>
      ))}

      {/* What is paid or skipped is done with: one row says how many and what they came to, and opens them. */}
      {settled && (
        <InsetGroup>
          <InsetRow
            testId="bills-settled"
            title={settled.title}
            value={
              <>
                {settled.count} · <Money minor={settledMinor} currency={readCurrency} />
              </>
            }
            onClick={() => setShowSettled(true)}
          />
        </InsetGroup>
      )}

      {showSettled && settled && (
        <Sheet grouped tall title={settled.title} onClose={closeSettled}>
          <div className="bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS }}>
            {settled.rows.map(billRow)}
          </div>
        </Sheet>
      )}

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
