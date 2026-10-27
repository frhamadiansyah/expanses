import { formatMinor } from '@expanses/core';
import { CreditCard } from 'lucide-react';
import { cx } from '../../ui';
import { ROW_PAD_X, ROW_PAD_Y, rowHeight, toneClass } from '../../ui/native';
import type { DueFee } from '../cards/fee-due';

/** A card's fee and the day it is next charged, as the Recurring list holds them. */
interface UpcomingDue {
  card: DueFee;
  on: string;
}
import { feeDateText } from '../cards/fee-line';

/**
 * A card's annual fee on the Recurring list, drawn exactly as a bill is: a round icon, the name with a small line
 * under it, the amount at the right with when it is charged under that, and the chevron. Read-only: nothing to swipe,
 * nothing to pay here, a tap opens the question of whether it was waived.
 */
export function FeeRow({ fee, separator, onOpen }: { fee: UpcomingDue; separator: boolean; onOpen: () => void }) {
  const { card, on } = fee;
  return (
    <div data-testid="annual-fee-row" className="relative">
      {separator && <span aria-hidden className="pointer-events-none absolute top-0 right-0 z-10 bg-[var(--ph-hair)]" style={{ height: 0.5, left: ROW_PAD_X + 34 }} />}
      <button
        type="button"
        onClick={onOpen}
        className="ph-focus-inset flex w-full items-center gap-[10px] text-left"
        style={{ minHeight: rowHeight(true), padding: `${ROW_PAD_Y}px ${ROW_PAD_X}px` }}
      >
        <span aria-hidden className="flex h-[28px] w-[28px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink-2)]">
          <CreditCard size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] leading-[20px] font-medium text-[var(--ph-ink)]">{`Annual fee · ${card.name}`}</span>
          <span className="mt-[2px] block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">Charged to the card</span>
        </span>
        <span className="tabular flex shrink-0 flex-col items-end text-[15px] leading-[20px] text-[var(--ph-ink)]">
          {card.annualFeeMinor !== null ? formatMinor(card.annualFeeMinor, card.currency) : <span className="text-[var(--ph-ink-3)]">Amount not set</span>}
          <span className={cx('mt-[2px] text-[12.5px] leading-[16px]', toneClass('warn'))}>{feeDateText(on)}</span>
        </span>
        <span aria-hidden className="shrink-0 text-[17px] leading-none text-[var(--ph-chevron)] md:hidden">
          {'›'}
        </span>
      </button>
    </div>
  );
}
