import { isoDate } from '@expanses/core';
import { type MonthlyBill, skipBill, undoBillPayments, unskipBill } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { ListChecks, Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useApp } from '../../app/context';
import { useBackToCashflow, useFrom } from '../../app/from-search';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox, Money } from '../../ui';
import { type CornerAction, GROUP_GAP, GROUP_RADIUS, InsetGroup, InsetRow, LargeTitle, Panel, PanelHeader, PushedTitle, SCREEN } from '../../ui/native';
import { BillRow } from './BillRow';
import { useInstallments } from '../loans/queries';
import { instalmentLines } from './instalment-rows';
import { MonthlyInstalments } from './MonthlyInstalments';
import { PaySelectedBar } from './PaySelectedBar';
import { MonthlyBuys } from './MonthlyBuys';
import { amountOf, billCurrencyOf, billsInReadCurrency, type BillSummary, isToPay, paidText, pausedOf, sectionsOf, settledOf, skippedText, summaryOf } from './bill-view';
import { HeroSlider } from './HeroSlider';
import { AnnualFees, RepeatingHero, RepeatingList } from './RepeatingBills';
import { nextDateOf } from './YearlyBillsPage';
import { repeatingNeeds } from './repeating-needs';
import { PaySeveralSheet } from './PaySeveralSheet';
import { PaySheet } from './PaySheet';
import { useBillMoney, useMonthlyBills, useSinkingFunds, useYearlyBills } from './queries';
import { type DueFee, useAnnualFees, useUpcomingFees } from '../cards/fee-due';
import { FeeAlert } from '../cards/FeeAlert';
import { FeeRow } from './FeeRow';
import { Unconverted } from '../workspaces/Unconverted';
import { UndoToast } from '../../ui/UndoToast';

const PAGE_KEY = 'recurring-page';

/** The bar's three parts in the kit's own tones: late in alarm, soon in warning, the rest a quiet grey. */
const PART_COLOUR: Record<BillSummary['parts'][number]['key'], string> = { overdue: 'var(--ph-alarm)', dueSoon: 'var(--ph-warn)' };
/** What is already paid, in the green of money settled. */
const PAID_COLOUR = 'var(--ph-up)';

/**
 * The month's figure, in the box it is made of: what is still to pay, a bar dividing it into late and soon,
 * and the key under the bar naming each part's money. Once everything is dealt with it says so, and nothing more.
 */
function StillToPay({ summary, currency }: { summary: BillSummary; currency: string }) {
  if (summary.allPaused) {
    return (
      <Panel>
        <p className="text-[17px] leading-[22px] font-semibold text-[var(--ph-ink-2)]">Nothing to pay in {summary.monthLabel}</p>
      </Panel>
    );
  }
  if (summary.allSettled) {
    return (
      <Panel>
        <p className="text-[17px] leading-[22px] font-semibold text-[var(--ph-up)]">
          All paid for {summary.monthLabel} <span aria-hidden>✓</span>
        </p>
      </Panel>
    );
  }
  const total = summary.parts.reduce((sum, part) => sum + part.minor, 0) + summary.paidMinor;
  return (
    <Panel className="space-y-3">
      <div>
        <p className="text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">Still to pay in {summary.monthLabel}</p>
        <p className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]" data-testid="bills-total">
          {/* The estimate sign is a caveat, not part of the figure: it wears the quiet ink. */}
          {summary.approximate && <span className="text-[var(--ph-ink-3)]">≈ </span>}
          <Money minor={summary.totalMinor} currency={currency} />
        </p>
        {summary.paidMinor > 0 ? (
          <p className="tabular text-[13px] leading-[17px] text-[var(--ph-ink-3)]" data-testid="bills-month-total">
            of <Money minor={summary.monthTotalMinor} currency={currency} /> this month
          </p>
        ) : (
          /* The line's place is kept, so this card is as tall as the Repeating one it slides to. */
          <span aria-hidden className="block h-[17px]" />
        )}
      </div>
      {total > 0 && (
        <>
          <span aria-hidden className="flex w-full gap-[2px] overflow-hidden rounded-full bg-[var(--ph-track)]" style={{ height: 8 }}>
            {summary.paidMinor > 0 && <span className="block h-full" style={{ width: `${(summary.paidMinor / total) * 100}%`, background: PAID_COLOUR }} />}
            {summary.parts.map((part) => (
              <span key={part.key} className="block h-full" style={{ width: `${(part.minor / total) * 100}%`, background: PART_COLOUR[part.key] }} />
            ))}
          </span>
          {/* Three lines are kept whatever is shown, the most this legend has: the Repeating hero keeps the same, so sliding between them never changes the card. */}
          <ul className="flex min-h-[78px] flex-col text-[12.5px] leading-[26px] text-[var(--ph-ink-3)]" data-testid="bills-legend">
            {summary.parts.map((part) => (
              <li key={part.key} className="flex h-[26px] items-center gap-[6px]">
                <span aria-hidden className="block h-2 w-2 rounded-full" style={{ background: PART_COLOUR[part.key] }} />
                {part.label}{' '}
                <span className="tabular text-[var(--ph-ink-2)]">
                  {part.approximate && '~'}
                  <Money minor={part.minor} currency={currency} />
                </span>
              </li>
            ))}
            {summary.paidMinor > 0 && (
              <li className="flex h-[26px] items-center gap-[6px]">
                <span aria-hidden className="block h-2 w-2 rounded-full" style={{ background: PAID_COLOUR }} />
                Paid{' '}
                <span className="tabular text-[var(--ph-ink-2)]">
                  <Money minor={summary.paidMinor} currency={currency} />
                </span>
              </li>
            )}
          </ul>
        </>
      )}
    </Panel>
  );
}

/**
 * The month's bills, most urgent first: what is still to pay, what is late, and what is done. A row pays or skips with a
 * swipe on a phone, or through its ⋯ menu with a mouse; either way an Undo follows for a few seconds. Under them, the
 * month's monthly buys.
 */
export function RecurringPage() {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  // A section from the More sheet; a step down from Cashflow when Cashflow opened it.
  const from = useFrom();
  const backToCashflow = useBackToCashflow();
  const bills = useMonthlyBills(today);
  const yearly = useYearlyBills(today);
  const funds = useSinkingFunds(today);
  const fees = useUpcomingFees(today);
  const annualFees = useAnnualFees(today);
  const plans = useInstallments();
  const [askingFee, setAskingFee] = useState<DueFee | null>(null);
  const accounts = useAccounts().data ?? [];
  const rows = bills.data ?? [];

  const [page, setPageState] = useState(() => {
    try {
      return sessionStorage.getItem(PAGE_KEY) === '1' ? 1 : 0;
    } catch {
      return 0;
    }
  });
  const setPage = useCallback((next: number) => {
    setPageState(next);
    try {
      sessionStorage.setItem(PAGE_KEY, String(next));
    } catch {
      // Remembering the page is a convenience.
    }
  }, []);
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

  const currencyOf = (bill: MonthlyBill) => billCurrencyOf(bill, accounts, ws.baseCurrency);

  // Each row says what its own bill costs, in the money it is paid with. The totals add rows up, so they cannot:
  // every amount is brought into the currency this workspace reads in first, and what no rate reaches is left out
  // of the sum and named above it, rather than added in as though a dollar were a rupiah.
  const money = useBillMoney().data;
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
  const convertFund = money?.converts ? money.convert : money?.convertForeign;
  const needs = repeatingNeeds(
    (yearly.data ?? []).map((bill) => ({ id: bill.id, amountMinor: bill.amountMinor, estimateMinor: bill.estimateMinor, currency: currencyOf(bill), dueOn: nextDateOf(bill) })),
    (funds.data ?? []).map((fund) => ({ billId: fund.billId, monthlyMinor: fund.monthlyMinor })),
    today,
    readCurrency,
    convertFund && ((minor, from) => convertFund(minor, from, today)),
  );
  const changePage = (next: number) => {
    setPage(next);
    if (next !== 0) doneSelecting();
  };
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

  // The count is the select bar's; the page title under it keeps its name, as Cashflow's does.
  const title = 'Recurring';
  // Glyphs at every width, with the names they always had: a screen reader and a test still hear "New bill".
  // While selecting, the bar over the title row holds the ✕ and the action, as Cashflow's does; the title has none of its own.
  const actions: CornerAction[] = selecting
    ? []
    : [
        ...(page === 0 ? [{ key: 'select', label: 'Select bills to pay', glyph: <ListChecks size={20} aria-hidden />, run: () => setSelecting(true) }] : []),
        { key: 'new', label: 'New bill', glyph: <Plus size={22} aria-hidden />, to: '/bills/new' },
      ];

  return (
    <div className={SCREEN}>
      {backToCashflow ? <PushedTitle title={title} actions={actions} {...backToCashflow} /> : <LargeTitle title={title} actions={actions} />}

      <ErrorBox error={error ?? bills.error} />

      <HeroSlider
        label="Recurring"
        names={['Monthly', 'Repeating']}
        page={page}
        onPage={changePage}
        pages={[
          rows.length > 0 ? (
            <div data-testid="bills-summary">
              <Unconverted missing={unconverted} currency={readCurrency} />
              <StillToPay summary={summary} currency={readCurrency} />
            </div>
          ) : (
            <Panel>
              <p className="text-[17px] leading-[22px] font-semibold text-[var(--ph-ink-2)]">No monthly bills yet</p>
            </Panel>
          ),
          <RepeatingHero key="repeating" needs={needs} currency={readCurrency} />,
        ]}
      />

      {page === 1 && <RepeatingList bills={yearly.data ?? []} needs={needs} />}
      {page === 1 && <AnnualFees fees={annualFees} onOpen={(fee) => setAskingFee(fee.card)} />}

      {page === 0 && bills.isSuccess && rows.length === 0 && (
        <InsetGroup>
          <InsetRow title={<span className="text-[var(--ph-tint)]">New bill</span>} label="New bill" to="/bills/new" />
        </InsetGroup>
      )}

      {page === 0 && (
        <>
      {/* A card's annual fee within 30 days sits with Due soon: read-only, no totals, nothing to pay here. */}
      {(() => {
        const sections = sectionsOf(rows);
        const soon = sections.find((section) => section.key === 'dueSoon');
        const feeRows = fees.map((fee, i) => (
          <FeeRow key={fee.card.cardId} fee={fee} separator={i > 0 || (soon?.rows.length ?? 0) > 0} onOpen={() => setAskingFee(fee.card)} />
        ));
        const shown = feeRows.length > 0 && !soon ? [...sections, { key: 'dueSoon' as const, title: 'Due soon', rows: [] as MonthlyBill[] }] : sections;
        return shown.map((section) => (
          <section key={section.key} className="md:max-w-2xl" style={{ marginBottom: GROUP_GAP }}>
            <PanelHeader title={section.title} />
            {/* The group's surface without its clipping: a row's ⋯ menu may hang below it. */}
            <div className="bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS }}>
              {section.rows.map(billRow)}
              {section.key === 'dueSoon' && feeRows}
            </div>
          </section>
        ));
      })()}

      {/* Paused bills come out for nothing this month: a group of their own, under the ones to pay. */}
      {pausedOf(rows).length > 0 && (
        <section className="md:max-w-2xl" style={{ marginBottom: GROUP_GAP }} data-testid="bills-paused">
          <PanelHeader title="Paused" />
          <div className="bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS }}>
            {pausedOf(rows).map(billRow)}
          </div>
        </section>
      )}

      {/* What is paid or skipped is done with: a group of its own, after the ones to pay. Rows open the bill; none swipe. */}
      {settledOf(rows).length > 0 && (
        <section className="md:max-w-2xl" style={{ marginBottom: GROUP_GAP }} data-testid="bills-paid">
          <PanelHeader title="Paid" />
          <div className="bg-[var(--ph-surface)]" style={{ borderRadius: GROUP_RADIUS }}>
            {settledOf(rows).map(billRow)}
          </div>
        </section>
      )}

      {/* Card instalment plans still running: read-only, after the last bill group, in no total (they go with the statement). */}
      <MonthlyInstalments lines={instalmentLines(plans.data ?? [], accounts, ws.baseCurrency, today)} />

      {/* The month's regular buys, set on each holding's own page: due ones with Record, bought ones with the day. */}
      <MonthlyBuys />

        </>
      )}

      {page === 0 && selecting && !payingSeveral && (() => {
        const chosen = readRows.filter((b) => picked.has(b.id));
        const approximate = chosen.some((b) => b.amountMinor === null);
        return (
          <PaySelectedBar
            count={picked.size}
            onPay={() => setPayingSeveral(true)}
            onCancel={doneSelecting}
            pay={
              <>
                <span>Pay {picked.size} selected</span>
                <span className="tabular text-[var(--ph-ink-3)]">
                  {approximate && '~'}
                  <Money minor={chosen.reduce((s, b) => s + amountOf(b), 0)} currency={readCurrency} />
                </span>
              </>
            }
          />
        );
      })()}

      {/* The fee question opens from either page: Due soon on Monthly, Annual fees on Repeating. */}
      {askingFee && <FeeAlert fee={askingFee} today={today} onClose={() => setAskingFee(null)} />}

      {toast && <UndoToast text={toast.text} onUndo={() => void undo()} onDone={clearToast} />}

      {payingSeveral && (
        <PaySeveralSheet
          bills={rows.filter(isToPay)}
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
          onSeeBill={() => navigate({ to: '/bills/$billId', params: { billId: paying.id }, search: from })}
          onLink={(month) => navigate({ to: '/bills/$billId/link', params: { billId: paying.id }, search: { ...from, month } })}
        />
      )}
    </div>
  );
}
