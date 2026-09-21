import { billSchedule, dayMonth, isoDate, monthName } from '@expanses/core';
import { deleteExpenseTemplate, RecurringError, skipBill, undoBillPayments } from '@expanses/db';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Pencil } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { cx, ErrorBox, Money } from '../../ui';
import { DestructiveRow, GROUP_RADIUS, type GroupChild, Hero, InsetGroup, InsetRow, LargeTitle, ReadOnlyRow, SCREEN } from '../../ui/native';
import { CategoryIcon } from '../categories/CategoryIcon';
import { isSettled, pillOf } from './bill-view';
import { PaySheet } from './PaySheet';
import { useBillDetail } from './queries';

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

  async function skip() {
    setError(null);
    try {
      await skipBill(database, ws, bill.id, bill.billMonth);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  async function stop() {
    // Keeps every payment and skip on record; it just stops asking for the next one.
    if (!window.confirm(`Stop ${bill.name}? Its payments stay in your history.`)) return;
    setError(null);
    try {
      await deleteExpenseTemplate(database, ws, bill.id);
      await invalidate();
      await navigate({ to: '/bills' });
    } catch (e) {
      setError(e);
    }
  }

  const month = monthName(bill.billMonth, 'long');

  return (
    <div className={SCREEN}>
      <LargeTitle
        title={bill.name}
        back="Recurring"
        backTo="/bills"
        actions={[{ key: 'edit', label: 'Edit bill', glyph: <Pencil size={18} aria-hidden />, to: '/bills/$billId/edit', params: { billId } }]}
      />

      <ErrorBox error={error} />

      <div data-testid="bill-hero" className="flex flex-col items-center md:max-w-2xl">
        {/* The category's own mark, tinted in its family's colour — the hero's plain circle would lose the colour. */}
        <span className="mb-[10px]">
          <CategoryIcon categoryId={bill.categoryAccountId} accounts={accounts} size="lg" />
        </span>
        <Hero
          minor={bill.amountMinor}
          currency={currency}
          empty="Amount varies"
          caption={
            <>
              <span className="block">{billSchedule(bill.dayOfMonth, bill.payByDay)}</span>
              <span className={cx('mt-[6px] inline-block rounded-full px-[7px] py-px text-[11px] leading-[15px] font-semibold', pill.className)}>{pill.text}</span>
            </>
          }
        />
      </div>

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

      {!isSettled(bill) && (
        <InsetGroup>
          <InsetRow title={<span className="text-[var(--ph-tint)]">Pay {month} bill</span>} label={`Pay ${month} bill`} onClick={() => setPaying(true)} chevron={false} />
        </InsetGroup>
      )}

      <InsetGroup>
        <ReadOnlyRow label="Paid from" value={account?.name ?? ''} />
        {bookName ? <ReadOnlyRow label="Workspace" value={bookName} /> : null}
      </InsetGroup>

      <div data-testid="bill-history">
        <InsetGroup header="History">
          {history.map((row) => (
            <HistoryRow
              key={row.month}
              fresh={paidMonth?.month === row.month}
              title={`${monthName(row.month, 'long')} bill`}
              value={
                row.state === 'paid' ? (
                  <>
                    <Money minor={row.paidMinor ?? 0} currency={currency} /> · paid {dayMonth(row.paidOn!)}
                  </>
                ) : row.state === 'skipped' ? (
                  'Skipped'
                ) : (
                  pillOf({ ...row, paidOn: null }).text
                )
              }
            />
          ))}
        </InsetGroup>
      </div>

      {!isSettled(bill) && (
        <InsetGroup>
          <InsetRow title={<span className="font-normal text-[var(--ph-ink-2)]">Skip {month} bill</span>} label={`Skip ${month} bill`} onClick={() => void skip()} chevron={false} />
        </InsetGroup>
      )}

      <InsetGroup>
        <DestructiveRow label="Stop this bill" onClick={() => void stop()} />
      </InsetGroup>

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
    </div>
  );
}

/**
 * A month in the bill's history. The month just paid is washed in the tint and marked `data-new`, so the payment
 * that just happened is the row the eye lands on — the row itself stays the kit's.
 */
function HistoryRow({ position, fresh, title, value }: GroupChild & { fresh: boolean; title: string; value: ReactNode }) {
  return (
    <div data-new={fresh}>
      <InsetRow position={position} title={title} value={value} valueTone="ink-2" className={cx(fresh && 'bg-[var(--ph-tint-panel)]')} />
    </div>
  );
}
