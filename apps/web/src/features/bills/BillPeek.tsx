import { dayMonth, formatMinor, isoDate, monthName, ordinal, periodicRepeat, thisBillMonth, yearlyRepeat } from '@expanses/core';
import { RecurringError, resumeBill, skipBill, undoBillPayments, unskipBill } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { useOpenReceipt } from '../transactions/ReceiptPeekHost';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { moneyHolders, useAccounts, useInvalidateAll, useMemberPayers } from '../../lib/queries';
import { cx, ErrorBox } from '../../ui';
import type { ToastIcon } from '../../ui/UndoToast';
import { PEEK_BUTTON, SidePeek } from '../../ui/native/SidePeek';
import { CategoryIcon } from '../categories/CategoryIcon';
import { useMonthStart } from '../workspaces/queries';
import { billCurrencyOf, heroLineOf, pillOf, skippedText } from './bill-view';
import { windowLine } from './BillPage';
import { usePaidFromLabels } from './PaidFromSheet';
import { PauseSheet } from './PauseSheet';
import { PaySheet } from './PaySheet';
import { useBillDetail, useSinkingFunds } from './queries';

/** How many months of history the peek lists; the bill's own page has them all. */
const HISTORY_SHOWN = 6;

export interface PeekToast {
  text: string;
  icon: ToastIcon;
  undo: () => Promise<void>;
}

/**
 * A bill in the Mac Bills page's side peek: the bill's own page in a column — its month, amount and standing, Pay, Skip,
 * Pause and Edit, what it is (repeats, dates, account, category), its sinking fund, and its earlier months, each paid
 * one a click from its payment. Open bill (or a double-click on its row) goes to the whole page.
 */
export function BillPeek({
  billId,
  top,
  first,
  last,
  onStep,
  onClose,
  onToast,
}: {
  billId: string;
  top: number;
  first: boolean;
  last: boolean;
  onStep: (by: -1 | 1) => void;
  onClose: () => void;
  onToast: (toast: PeekToast) => void;
}) {
  const { database, ws } = useApp();
  const navigate = useNavigate();
  // A paid month opens its payment's Mac receipt in this peek's place, with ‹ back to the bill.
  const openReceipt = useOpenReceipt();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const accounts = useAccounts().data ?? [];
  const { nameOf: paidName } = usePaidFromLabels(moneyHolders(accounts));
  const memberPayers = useMemberPayers().data;
  const detail = useBillDetail(billId, today);
  const fund = (useSinkingFunds(today).data ?? []).find((f) => f.billId === billId);
  const monthStart = useMonthStart();
  const [paying, setPaying] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const shell = (title: ReactNode, children: ReactNode) => (
    <SidePeek top={top} label="Bill details" testId="bill-peek" titleTestId="peek-title" noun="bill" title={title} first={first} last={last} onStep={onStep} onClose={onClose}>
      {children}
    </SidePeek>
  );

  if (detail.error instanceof RecurringError && detail.error.code === 'NOT_FOUND')
    return shell('Bill stopped', <p className="px-[14px] py-2 text-[13px] text-[var(--ph-ink-3)]">This bill has been stopped.</p>);
  if (!detail.data) return shell('', <ErrorBox error={detail.error} />);

  const { bill, history, bookName } = detail.data;
  const currency = billCurrencyOf(bill, accounts, ws.baseCurrency);
  const hero = heroLineOf(bill, windowLine(bill.window));
  const account = accounts.find((a) => a.id === bill.moneyAccountId);
  const category = accounts.find((a) => a.id === bill.categoryAccountId);
  // The month Pay and Skip act on, as the bill's page picks it: the oldest still owed, else the next one ahead.
  const actMonth = bill.payableMonths[0] ?? null;
  const payLabel = actMonth === bill.billMonth ? 'Pay' : `Pay ${actMonth ? monthName(actMonth, 'long') : ''}`;

  async function act(run: () => Promise<void>) {
    setError(null);
    try {
      await run();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const facts: { label: string; value: string }[] = [
    {
      label: 'Repeats',
      value:
        bill.repeat === 'yearly' ? yearlyRepeat(bill.repeatMonth!, bill.dayOfMonth) : bill.repeat === 'months' ? periodicRepeat(bill.repeatEvery!, bill.repeatMonth!, bill.dayOfMonth) : 'Every month',
    },
    ...(bill.repeat === 'monthly' ? [{ label: 'Out on', value: `The ${ordinal(bill.dayOfMonth)}` }] : []),
    {
      label: 'Due by',
      value: bill.repeat !== 'monthly' ? `The ${ordinal(bill.payByDay ?? bill.dayOfMonth)}` : bill.payByDay === null ? 'The bill date' : `The ${ordinal(bill.payByDay)}`,
    },
    ...(bill.currency ? [{ label: 'Currency', value: bill.currency }] : []),
    {
      label: 'Paid from',
      value: account ? paidName(account) : (memberPayers?.get(bill.moneyAccountId)?.name ?? ''),
    },
    { label: 'Category', value: category?.name ?? '' },
    ...(bookName ? [{ label: 'Workspace', value: bookName }] : []),
  ];
  const shown = history.slice(0, HISTORY_SHOWN);

  return shell(
    <span className="inline-flex items-center gap-[7px]">
      <CategoryIcon categoryId={bill.categoryAccountId} accounts={accounts} size="xs" />
      {bill.name}
    </span>,
    <>
      <div className="px-[14px] pb-[10px]">
        <div className="text-[11px] text-[var(--ph-ink-3)]">
          {monthName(bill.billMonth, 'long')}
          {bill.repeat !== 'monthly' && ` ${bill.billMonth.slice(0, 4)}`} bill
        </div>
        <div data-testid="peek-amount" className="text-[22px] font-semibold text-[var(--ph-ink)] tabular-nums">
          {bill.amountMinor !== null ? formatMinor(bill.amountMinor, currency) : <span className="text-[var(--ph-ink-3)]">Amount varies</span>}
        </div>
        {bill.amountMinor === null && bill.estimateMinor !== null && <div className="text-[12px] text-[var(--ph-ink-3)] tabular-nums">last time {formatMinor(bill.estimateMinor, currency)}</div>}
        <div data-testid="peek-status" className="mt-[2px] text-[13px] text-[var(--ph-ink-3)]">
          {hero.lead && <span className={hero.tone === 'alarm' ? 'text-[var(--ph-alarm)]' : hero.tone === 'warn' ? 'text-[var(--ph-warn)]' : undefined}>{hero.lead}</span>}
          {hero.lead && ' · '}
          {hero.rest}
        </div>
      </div>
      <div className="flex flex-wrap gap-2 px-[14px] pb-[12px]">
        {actMonth && (
          <button type="button" onClick={() => setPaying(true)} className="rounded-[6px] bg-[var(--ph-ink)] px-3 py-[4px] text-[13px] font-medium text-[var(--ph-surface)]">
            {payLabel}
          </button>
        )}
        {actMonth && (
          <button
            type="button"
            className={PEEK_BUTTON}
            onClick={() =>
              void act(async () => {
                await skipBill(database, ws, bill.id, actMonth);
                onToast({
                  icon: 'skipped',
                  text: skippedText(bill.name, actMonth, today, thisBillMonth(today, bill.dayOfMonth, monthStart)),
                  undo: () => unskipBill(database, ws, bill.id, actMonth),
                });
              })
            }
          >
            Skip
          </button>
        )}
        {bill.pausedUntil ? (
          <button type="button" className={PEEK_BUTTON} onClick={() => void act(() => resumeBill(database, ws, bill.id))}>
            Resume
          </button>
        ) : (
          <button type="button" className={PEEK_BUTTON} onClick={() => setPausing(true)}>
            Pause
          </button>
        )}
        <button type="button" className={PEEK_BUTTON} onClick={() => void navigate({ to: '/bills/$billId/edit', params: { billId } })}>
          Edit
        </button>
        <button type="button" className={PEEK_BUTTON} onClick={() => void navigate({ to: '/bills/$billId', params: { billId } })}>
          Open bill
        </button>
      </div>
      <ErrorBox error={error} />
      <dl className="border-t border-[var(--ph-hair)]">
        {facts.map((row) => (
          <div key={row.label} className="flex border-t border-[var(--ph-hair)] px-3 py-2 text-[13px] first:border-t-0">
            <dt className="w-[96px] shrink-0 text-[var(--ph-ink-3)]">{row.label}</dt>
            <dd className="min-w-0 flex-1 break-words text-[var(--ph-ink)]">{row.value}</dd>
          </div>
        ))}
        {bill.repeat !== 'monthly' && fund && (
          <>
            <div className="flex border-t border-[var(--ph-hair)] px-3 py-2 text-[13px]" data-testid="peek-fund">
              <dt className="w-[96px] shrink-0 text-[var(--ph-ink-3)]">Saved</dt>
              <dd className="min-w-0 flex-1 text-[var(--ph-ink)] tabular-nums">
                {formatMinor(fund.savedMinor, fund.currency)} <span className="text-[var(--ph-ink-3)]">of {formatMinor(fund.targetMinor, fund.currency)}</span>
                <div aria-hidden className="mt-[5px] h-[5px] overflow-hidden rounded-full bg-[var(--ph-track)]">
                  <div
                    className="h-full rounded-full bg-[var(--ph-up)]"
                    style={{
                      width: `${fund.targetMinor > 0 ? Math.min(1, fund.savedMinor / fund.targetMinor) * 100 : 0}%`,
                    }}
                  />
                </div>
              </dd>
            </div>
            <div className="flex border-t border-[var(--ph-hair)] px-3 py-2 text-[13px]">
              <dt className="w-[96px] shrink-0 text-[var(--ph-ink-3)]">Each month</dt>
              <dd className="min-w-0 flex-1 text-[var(--ph-ink)] tabular-nums">
                {formatMinor(fund.monthlyMinor, fund.currency)} <span className="text-[var(--ph-ink-3)]">in {fund.accountName}</span>
              </dd>
            </div>
          </>
        )}
      </dl>
      <h3 className="flex items-baseline justify-between px-[14px] pt-[12px] pb-[4px] text-[11px] font-semibold text-[var(--ph-ink-3)]">
        <span>History</span>
        {history.length > shown.length && <span className="font-normal">{`latest ${shown.length} of ${history.length}`}</span>}
      </h3>
      <ul aria-label={`${bill.name} history`} data-testid="peek-history" className="pb-3">
        {shown.length === 0 && <li className="px-[14px] py-2 text-[12.5px] text-[var(--ph-ink-3)]">Nothing paid yet.</li>}
        {shown.map((row) => {
          const title = bill.repeat !== 'monthly' ? `${row.month.slice(0, 4)} bill` : `${monthName(row.month, 'long')} bill`;
          const payment = row.state === 'paid' ? row.payments[0] : undefined;
          return (
            <li key={row.month}>
              <button
                type="button"
                data-testid="peek-history-row"
                disabled={!payment}
                onClick={() =>
                  payment &&
                  (openReceipt
                    ? openReceipt(payment.id, { back: bill.name })
                    : void navigate({
                        to: '/transactions/$transactionId',
                        params: { transactionId: payment.id },
                      }))
                }
                className="flex w-full items-baseline gap-2 px-[14px] py-[5px] text-left text-[13px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)] disabled:hover:bg-transparent"
              >
                <span className="min-w-0 flex-1 truncate">{title}</span>
                <span className={cx('shrink-0 tabular-nums', row.state !== 'paid' && 'text-[var(--ph-ink-3)]')}>
                  {row.state === 'paid' ? `${formatMinor(row.paidMinor ?? 0, row.paidCurrency ?? currency)} · ${row.paidOn ? dayMonth(row.paidOn) : ''}` : pillOf({ ...row, paidOn: null }).text}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {paying && (
        <PaySheet
          bill={bill}
          today={today}
          onClose={() => setPaying(false)}
          onPaid={(ids, amountMinor, _paidOn, month) => {
            setPaying(false);
            onToast({
              icon: 'paid',
              text: `Paid ${bill.name}${month !== bill.billMonth ? ` · ${monthName(month, 'long')} bill` : ''} · ${formatMinor(amountMinor, currency)}`,
              undo: () => undoBillPayments(database, ws, ids),
            });
          }}
          onSkipped={(month) => {
            setPaying(false);
            onToast({
              icon: 'skipped',
              text: skippedText(bill.name, month, today, thisBillMonth(today, bill.dayOfMonth, monthStart)),
              undo: () => unskipBill(database, ws, bill.id, month),
            });
          }}
          onSeeBill={() => void navigate({ to: '/bills/$billId', params: { billId } })}
          onLink={(month) =>
            void navigate({
              to: '/bills/$billId/link',
              params: { billId },
              search: { month },
            })
          }
        />
      )}
      {pausing && <PauseSheet bill={bill} onClose={() => setPausing(false)} onPaused={() => setPausing(false)} />}
    </>,
  );
}
