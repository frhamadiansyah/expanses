import { monthName } from '@expanses/core';
import type { AccountRow, MonthlyBill } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { Check, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx, Money } from '../../ui';
import { CategoryIcon } from '../categories/CategoryIcon';
import { isSettled, pillOf, sublineOf } from './bill-view';
import { SwipeRow } from '../../ui/SwipeRow';
import { ROW_PAD_X, ROW_PAD_Y, rowHeight } from '../../ui/native';

/** A line in the ⋯ menu, drawn as the kit's own overflow menu draws one. */
const MENU_ITEM = 'ph-focus-inset block w-full px-[13px] py-[11px] text-left text-[15px] leading-[20px] text-[var(--ph-ink)] hover:bg-[var(--ph-fill)]';

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
  separator = false,
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
  /** A hairline above this row, inset to the text as the kit's are; the group's first row has none. */
  separator?: boolean;
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
    <div data-testid="bill-row" data-bill-id={bill.id} className="group relative">
      {separator && <span aria-hidden className="pointer-events-none absolute top-0 right-0 z-10 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X + 34 }} />}
      <SwipeRow
        className="group-first:rounded-t-[11px] group-last:rounded-b-[11px]"
        enabled={!selecting && !settled}
        onSwipeRight={() => onPay(bill)}
        rightHint="Pay"
        leftAction={
          <button type="button" onClick={() => onSkip(bill)} aria-label={`Skip ${bill.name}`} className="w-[76px] bg-[var(--ph-ink-3)] text-[15px] font-semibold text-white">
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
            className="ph-focus-inset flex w-full items-center gap-[10px] text-left md:pr-12"
            style={{ minHeight: rowHeight(true), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}
          >
            {selecting && !settled ? (
              <span
                aria-hidden
                className={cx(
                  'flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full',
                  picked ? 'bg-[var(--ph-tint)] text-white' : 'ring-[1.5px] ring-[var(--ph-chevron)] ring-inset',
                )}
              >
                {picked && <Check size={16} strokeWidth={2.5} />}
              </span>
            ) : (
              <CategoryIcon categoryId={bill.categoryAccountId} accounts={accounts} size="sm" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{bill.name}</span>
              <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{sublineOf(bill, accountName, today)}</span>
            </span>
            <span className="tabular flex shrink-0 flex-col items-end gap-[3px] text-[15px] leading-[20px] text-[var(--ph-ink)]">
              {bill.state === 'paid' ? (
                <Money minor={bill.paidMinor ?? 0} currency={currency} />
              ) : bill.amountMinor !== null ? (
                <Money minor={bill.amountMinor} currency={currency} />
              ) : bill.estimateMinor !== null ? (
                <span className="text-[var(--ph-ink-3)]">
                  ~<Money minor={bill.estimateMinor} currency={currency} /> · varies
                </span>
              ) : (
                <span className="text-[var(--ph-ink-3)]">Amount varies</span>
              )}
              <span className={cx('rounded-full px-[7px] py-px text-[11px] leading-[15px] font-semibold', pill.className)}>{pill.text}</span>
            </span>
            {!selecting && (
              <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)] md:hidden">
                {'›'}
              </span>
            )}
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
            className="ph-focus absolute top-1/2 right-2 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-tint)] md:flex md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:focus:opacity-100"
          >
            <MoreHorizontal size={18} aria-hidden />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute top-full right-2 z-20 -mt-2 w-48 overflow-hidden bg-[var(--ph-surface)] shadow-[0_10px_30px_-8px_rgb(0_0_0/0.35)]"
              style={{ borderRadius: 11 }}
            >
              {!settled && (
                <button type="button" role="menuitem" onClick={choose(() => onPay(bill))} className={MENU_ITEM}>
                  Pay…
                </button>
              )}
              {!settled && (
                <button type="button" role="menuitem" onClick={choose(() => onSkip(bill))} className={MENU_ITEM}>
                  Skip {monthName(bill.billMonth, 'short')} bill
                </button>
              )}
              <button type="button" role="menuitem" onClick={choose(seeBill)} className={MENU_ITEM}>
                See bill
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
