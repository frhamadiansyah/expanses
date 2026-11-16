import { formatMinor } from '@expanses/core';
import type { ReactNode } from 'react';
import { cx } from '../../ui';
import { type GroupChild, InsetGroup, SelectCircle } from '../../ui/native';
import { Line, SUBTITLE, TITLE } from '../cards/rows';
import type { PaidRow } from './plan-view';

/**
 * One row of a plan's Paid list: the instalment, its date and amount, and its circle. A tap on the circle ticks it and
 * every one before it, or unticks it and every one after it. The folded row of older paid ones opens on a tap.
 */
function PaidListRow({ row, currency, disabled, onTap, onExpand, position }: GroupChild & { row: PaidRow; currency: string; disabled: boolean; onTap: (to: number) => void; onExpand: () => void }) {
  const text = (
    <span className="min-w-0 flex-1 py-[10px] text-left">
      <span className={cx('block truncate', TITLE)}>{row.title}</span>
      <span className={cx('mt-[2px] block truncate', SUBTITLE)}>{row.subtitle}</span>
    </span>
  );
  if (row.folded) {
    return (
      <Line position={position} testId="paid-row" pad="0">
        <button type="button" onClick={onExpand} aria-label={`${row.title}, paid. Show each`} className="ph-focus-inset flex w-full items-center gap-[10px] bg-transparent" style={{ padding: '0 12px 0 13px' }}>
          {text}
          <span className="flex w-[36px] shrink-0 justify-center">
            <SelectCircle picked />
          </span>
        </button>
      </Line>
    );
  }
  const tapTo = row.tapTo;
  return (
    <Line position={position} testId="paid-row" className="flex items-center gap-[10px]" pad="0 12px 0 13px">
      {text}
      {row.amountMinor !== null && (
        <span className={cx('tabular shrink-0 text-[15px] leading-[20px]', row.ticked ? 'text-[var(--ph-ink-3)]' : 'text-[var(--ph-ink)]')}>{formatMinor(row.amountMinor, currency)}</span>
      )}
      <button
        type="button"
        role="checkbox"
        aria-checked={row.ticked}
        aria-label={`${row.title} paid`}
        disabled={disabled || tapTo === null}
        onClick={() => tapTo !== null && onTap(tapTo)}
        className={cx('ph-focus flex h-[44px] w-[36px] shrink-0 items-center justify-center', tapTo === null && 'opacity-60')}
      >
        <SelectCircle picked={row.ticked} />
      </button>
    </Line>
  );
}

/**
 * A plan's instalments under a header, newest first, with what is owed said under them (owner, 17 Nov 2026, mockup 1b):
 * the new plan's sheet and the plan's own page draw the same list, and a tap changes what is paid.
 */
export function PaidList({
  header,
  rows,
  currency,
  footer,
  disabled = false,
  onTap,
  onExpand,
}: {
  header: string;
  rows: readonly PaidRow[];
  currency: string;
  footer?: ReactNode;
  disabled?: boolean;
  onTap: (paidSoFar: number) => void;
  onExpand: () => void;
}) {
  return (
    <div data-testid="paid-list">
      <InsetGroup header={header} footer={footer}>
        {rows.map((row) => (
          <PaidListRow key={row.key} row={row} currency={currency} disabled={disabled} onTap={onTap} onExpand={onExpand} />
        ))}
      </InsetGroup>
    </div>
  );
}
