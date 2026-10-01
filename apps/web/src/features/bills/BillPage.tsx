import { type BillWindow, dayMonth, isoDate, monthName, ordinal } from '@expanses/core';
import { deleteExpenseTemplate, RecurringError, resumeBill, skipBill, undoBillPayments } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Check, MoreHorizontal, Pause, Pencil, Play, SkipForward } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox, Money } from '../../ui';
import { ActionButtons, GROUP_RADIUS, type GroupChild, InsetGroup, InsetRow, LargeTitle, Panel, PushedTitle, ReadOnlyRow, type RoundAction, SCREEN } from '../../ui/native';
import { CategoryIcon } from '../categories/CategoryIcon';
import { pillOf } from './bill-view';
import { PauseSheet } from './PauseSheet';
import { PaySheet } from './PaySheet';
import { useBillDetail } from './queries';

/** How many months the history shows before See all. */
const HISTORY_SHOWN = 3;

/** "Out 28 Sep · pay by 5 Oct 2026", or "Out and due 1 Oct 2026" when the two are one day. */
export function windowLine(window: BillWindow): string {
  const year = (date: string) => date.slice(0, 4);
  if (window.opensOn === window.payBy) return `Out and due ${dayMonth(window.payBy)} ${year(window.payBy)}`;
  const out = year(window.opensOn) === year(window.payBy) ? dayMonth(window.opensOn) : `${dayMonth(window.opensOn)} ${year(window.opensOn)}`;
  return `Out ${out} · pay by ${dayMonth(window.payBy)} ${year(window.payBy)}`;
}

interface JustPaid {
  ids: string[];
  amountMinor: number;
  paidOn: string;
  month: string;
}

export function BillRoute() {
  const { billId } = useParams({ from: '/bills/$billId' });
  return <BillPage billId={billId} />;
}

/**
 * A bill on its own: what it is, when it is due, every month's history, and the one thing the list has no room
 * for — paying it and staying to see what happened, rather than bouncing back to the list.
 */
export function BillPage({ billId }: { billId: string }) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts().data ?? [];
  const today = isoDate();
  const detail = useBillDetail(billId, today);

  const [paying, setPaying] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [allHistory, setAllHistory] = useState(false);
  const [justPaid, setJustPaid] = useState<JustPaid | null>(null);
  const [error, setError] = useState<unknown>(null);

  // A stopped bill's own page turns into this: gone from the list, but its history is still there if anyone asks.
  if (detail.error instanceof RecurringError && detail.error.code === 'NOT_FOUND') {
    return (
      <div className={SCREEN}>
        <LargeTitle title="Bill stopped" back="Recurring" backTo="/bills" />
        <InsetGroup footer="This bill has been stopped.">
          <InsetRow title={<span className="text-[var(--ph-tint)]">Back to Recurring</span>} label="Back to Recurring" to="/bills" />
        </InsetGroup>
      </div>
    );
  }

  if (!detail.data) return <ErrorBox error={detail.error} />;

  const { bill, history, bookName } = detail.data;
  const account = accounts.find((a) => a.id === bill.moneyAccountId);
  const currency = account?.currency ?? ws.baseCurrency;
  const pill = pillOf(bill);
  // The month just paid, which is not always the month the page now speaks for: paying last month's overdue bill, or
  // choosing another month in For, moves the bill on. The confirmation follows the payment, not the bill.
  const paidMonth = justPaid ? history.find((row) => row.month === justPaid.month && row.state === 'paid') : undefined;

  async function undo() {
    if (!justPaid) return;
    setError(null);
    try {
      await undoBillPayments(database, ws, justPaid.ids);
      await invalidate();
      setJustPaid(null);
    } catch (e) {
      setError(e);
    }
  }

  // The month Pay and Skip act on: the oldest one still owed, else the next one ahead. A paused month comes last, so
  // it is never the one picked — it can still be chosen in the pay sheet's For.
  const actMonth = bill.payableMonths[0] ?? null;
  const actName = actMonth ? monthName(actMonth, 'long') : '';
  // Plain "Pay" while it pays the month the card shows; once that is settled, the button names the month it moves on to.
  const payLabel = actMonth === bill.billMonth ? 'Pay' : `Pay ${actName}`;

  async function act(run: () => Promise<void>) {
    setError(null);
    try {
      await run();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  async function stop() {
    // Keeps every payment and skip on record; it just stops asking for the next one.
    if (!window.confirm(`Stop ${bill.name}? Its payments stay in the history.`)) return;
    setError(null);
    try {
      await deleteExpenseTemplate(database, ws, bill.id);
      await invalidate();
      await navigate({ to: '/bills' });
    } catch (e) {
      setError(e);
    }
  }

  const actions: RoundAction[] = [
    ...(actMonth
      ? [
          { key: 'pay', label: payLabel, glyph: <Check size={20} aria-hidden />, run: () => setPaying(true) },
          { key: 'skip', label: 'Skip', glyph: <SkipForward size={20} aria-hidden />, run: () => void act(() => skipBill(database, ws, bill.id, actMonth)) },
        ]
      : []),
    bill.pausedUntil
      ? { key: 'resume', label: 'Resume', glyph: <Play size={20} aria-hidden />, run: () => void act(() => resumeBill(database, ws, bill.id)) }
      : { key: 'pause', label: 'Pause', glyph: <Pause size={20} aria-hidden />, run: () => setPausing(true) },
    { key: 'edit', label: 'Edit', glyph: <Pencil size={18} aria-hidden />, to: '/bills/$billId/edit', params: { billId } },
  ];

  const category = accounts.find((a) => a.id === bill.categoryAccountId);
  const shown = allHistory ? history : history.filter((row, index) => index < HISTORY_SHOWN || row.month === paidMonth?.month);

  return (
    <div className={SCREEN}>
      <PushedTitle
        title={bill.name}
        back="Recurring"
        backTo="/bills"
        actions={[{ key: 'more', label: 'More', glyph: <MoreHorizontal size={20} aria-hidden />, menu: [{ key: 'stop', label: 'Stop this bill', run: () => void stop() }] }]}
      />

      <ErrorBox error={error} />

      {/* The month's bill: which month, what it comes to, when it is out and due, and where it stands. */}
      <Panel testId="bill-hero" className="space-y-[6px]">
        <div className="flex items-center gap-[10px]">
          <CategoryIcon categoryId={bill.categoryAccountId} accounts={accounts} size="row" />
          <p className="flex-1 text-[12px] font-semibold tracking-[0.08em] text-[var(--ph-ink-3)] uppercase">{monthName(bill.billMonth, 'long')} bill</p>
          <span className={cx('rounded-full px-[8px] py-[2px] text-[12px] leading-[16px] font-semibold', pill.className)} data-testid="bill-status">
            {pill.text}
          </span>
        </div>
        {bill.amountMinor !== null ? (
          <p className="tabular truncate text-[26px] leading-[32px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]">
            <Money minor={bill.amountMinor} currency={currency} />
          </p>
        ) : (
          <p className="text-[26px] leading-[32px] font-bold tracking-[-0.02em] text-[var(--ph-ink-3)]">
            Amount varies
            {bill.estimateMinor !== null && (
              <span className="tabular ml-[8px] text-[13px] leading-[18px] font-normal tracking-normal">
                last month <Money minor={bill.estimateMinor} currency={currency} />
              </span>
            )}
          </p>
        )}
        <p className="text-[13px] leading-[18px] text-[var(--ph-ink-3)]">{windowLine(bill.window)}</p>
      </Panel>

      {justPaid && paidMonth && (
        /* A confirmation with its own Undo beside it — a banner, not a row, so the two never share one tap target. */
        <div
          data-testid="just-paid"
          role="status"
          className="mb-[18px] flex items-center justify-between gap-3 bg-[var(--ph-tint-panel)] pl-[13px] text-[15px] leading-[20px] text-[var(--ph-tint-ink)] md:max-w-2xl"
          style={{ borderRadius: GROUP_RADIUS }}
        >
          <span className="tabular py-[11px]">
            ✓ Paid <Money minor={justPaid.amountMinor} currency={currency} /> on {dayMonth(justPaid.paidOn)}
            {justPaid.month !== bill.billMonth && ` · ${monthName(justPaid.month, 'long')} bill`}
          </span>
          <button type="button" onClick={() => void undo()} className="ph-focus-inset min-h-11 shrink-0 px-[13px] font-semibold">
            Undo
          </button>
        </div>
      )}

      <ActionButtons actions={actions} />

      <InsetGroup>
        <ReadOnlyRow label="Repeats" value="Every month" />
        <ReadOnlyRow label="Out on" value={`The ${ordinal(bill.dayOfMonth)}`} />
        <ReadOnlyRow label="Pay by" value={bill.payByDay === null ? 'The day it is out' : `The ${ordinal(bill.payByDay)}`} />
        <ReadOnlyRow label="Paid from" value={account?.name ?? ''} />
        <ReadOnlyRow label="Category" value={category?.name ?? ''} />
        {bookName ? <ReadOnlyRow label="Workspace" value={bookName} /> : null}
      </InsetGroup>

      <div data-testid="bill-history">
        <InsetGroup header="History">
          {[
            ...shown.map((row) => (
              <HistoryRow
                key={row.month}
                fresh={paidMonth?.month === row.month}
                title={`${monthName(row.month, 'long')} bill`}
                value={
                  row.state === 'paid' ? (
                    <>
                      <Money minor={row.paidMinor ?? 0} currency={currency} /> · paid {dayMonth(row.paidOn!)}
                    </>
                  ) : (
                    pillOf({ ...row, paidOn: null }).text
                  )
                }
              />
            )),
            ...(history.length > shown.length
              ? [<InsetRow key="all" title={<span className="text-[var(--ph-tint)]">See all</span>} label="See all" chevron={false} onClick={() => setAllHistory(true)} />]
              : []),
          ]}
        </InsetGroup>
      </div>

      {paying && (
        <PaySheet
          bill={bill}
          today={today}
          onClose={() => setPaying(false)}
          onPaid={(ids, amountMinor, paidOn, month) => {
            setPaying(false);
            setJustPaid({ ids, amountMinor, paidOn, month });
          }}
          onSkipped={() => setPaying(false)}
        />
      )}

      {pausing && <PauseSheet bill={bill} onClose={() => setPausing(false)} onPaused={() => setPausing(false)} />}
    </div>
  );
}

/**
 * A month in the bill's history. The month just paid is washed in the tint and marked `data-new`, so the payment
 * that just happened is the row the eye lands on — the row itself stays the kit's.
 */
function HistoryRow({ position, fresh, title, value }: GroupChild & { fresh: boolean; title: string; value: ReactNode }) {
  return (
    // The wash sits on the wrapper: the row draws itself on a transparent ground, which would win over it.
    <div data-new={fresh} className={cx(fresh && 'bg-[var(--ph-tint-panel)]')}>
      <InsetRow position={position} title={title} value={value} valueTone="ink-2" />
    </div>
  );
}
