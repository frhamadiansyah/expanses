import { monthName } from '@expanses/core';
import type { AccountRow, MonthlyBill } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { Check, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx, Money } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { isSettled, pillOf, sublineOf } from './bill-view';
import { SwipeRow } from '../../ui/SwipeRow';

/**
 * One bill on the Recurring list. A swipe right pays it, a swipe left offers Skip; on a desktop the same two actions
 * sit behind the ⋯ button that shows on hover and focus, so a mouse loses nothing a thumb has.
 */
export function BillRow({
  bill,
  accounts,
  today,
  currency,
  onPay,
  onSkip,
  selecting = false,
  picked = false,
  onToggle,
}: {
  bill: MonthlyBill;
  accounts: readonly AccountRow[];
  today: string;
  /** The paying account's currency, which is what the bill's amounts are in. */
  currency: string;
  onPay: (bill: MonthlyBill) => void;
  onSkip: (bill: MonthlyBill) => void;
  selecting?: boolean;
  picked?: boolean;
  onToggle?: (bill: MonthlyBill) => void;
}) {
  const settled = isSettled(bill);
  const accountName = accounts.find((account) => account.id === bill.moneyAccountId)?.name ?? '';
  const pill = pillOf(bill);
  const navigate = useNavigate();
  const seeBill = () => void navigate({ to: '/bills/$billId', params: { billId: bill.id } });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [menuOpen]);

  const choose = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };

  return (
    <div data-testid="bill-row" data-bill-id={bill.id} className="group relative border-t border-slate-100 first:border-t-0">
      <SwipeRow
        className="group-first:rounded-t-xl group-last:rounded-b-xl"
        enabled={!selecting && !settled}
        onSwipeRight={() => onPay(bill)}
        rightHint="Pay"
        leftAction={
          <button type="button" onClick={() => onSkip(bill)} aria-label={`Skip ${bill.name}`} className="w-[76px] bg-slate-500 text-sm font-semibold text-white">
            Skip
          </button>
        }
      >
        {(suppressClick) => (
          <button
            type="button"
            role={selecting ? 'checkbox' : undefined}
            aria-checked={selecting ? picked : undefined}
            aria-label={selecting ? `Select ${bill.name}` : undefined}
            disabled={selecting && settled}
            onClick={() => {
              if (suppressClick()) return;
              if (selecting) onToggle?.(bill);
              // A tap always opens the bill's own page; paying and skipping stay one swipe or menu tap away.
              else seeBill();
            }}
            className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left md:pr-12"
          >
            {selecting && !settled ? (
              <span
                aria-hidden
                className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', picked ? 'bg-emerald-600 text-white' : 'bg-slate-100')}
              >
                {picked && <Check size={18} strokeWidth={2.5} />}
              </span>
            ) : (
              <CategoryIcon categoryId={bill.categoryAccountId} accounts={accounts} />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{bill.name}</span>
              <span className="block truncate text-xs text-slate-500">{sublineOf(bill, accountName, today)}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1 text-sm">
              {bill.state === 'paid' ? (
                <Money minor={bill.paidMinor ?? 0} currency={currency} />
              ) : bill.amountMinor !== null ? (
                <Money minor={bill.amountMinor} currency={currency} />
              ) : bill.estimateMinor !== null ? (
                <span className="text-slate-500">
                  ~<Money minor={bill.estimateMinor} currency={currency} /> · varies
                </span>
              ) : (
                <span className="text-slate-500">Amount varies</span>
              )}
              <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', pill.className)}>{pill.text}</span>
            </span>
          </button>
        )}
      </SwipeRow>

      {/* Outside the sliding layer, so a drag never lands on it and it never slides away with the row. Every row —
          paid and skipped too — offers its ⋯ menu, since See bill is a way in for all of them; Pay and Skip only
          make sense while the month is still unsettled. */}
      {!selecting && (
        <div ref={menuRef}>
          <button
            type="button"
            aria-label={`Actions for ${bill.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="absolute top-1/2 right-2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 md:flex md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:focus:opacity-100"
          >
            <MoreHorizontal size={18} aria-hidden />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute top-full right-2 z-20 -mt-2 w-48 overflow-hidden rounded-xl bg-white py-1 shadow-xl ring-1 ring-slate-200">
              {!settled && (
                <button type="button" role="menuitem" onClick={choose(() => onPay(bill))} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100">
                  Pay…
                </button>
              )}
              {!settled && (
                <button type="button" role="menuitem" onClick={choose(() => onSkip(bill))} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100">
                  Skip {monthName(bill.billMonth, 'short')} bill
                </button>
              )}
              <button type="button" role="menuitem" onClick={choose(seeBill)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-100">
                See bill
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
