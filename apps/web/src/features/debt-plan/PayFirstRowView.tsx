import { formatMinor } from '@expanses/core';
import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { debtLink, loanPay } from './pay-target';
import type { PlanDebt } from './plan-inputs';
import type { PayFirstRow } from './plan-view';
import { PayLink } from './PayLink';

/** Where a debt opens (`debtLink`), in the shape a `Link` takes. */
export function debtDestination(debt: PlanDebt): { to: LinkProps['to']; params?: LinkProps['params']; search?: LinkProps['search'] } {
  return debtLink(debt) as { to: LinkProps['to']; params?: LinkProps['params']; search?: LinkProps['search'] };
}

/** The round badge: "!" in red for a late debt, otherwise its place in line. */
export function PlaceBadge({ place }: { place: number | null }) {
  return (
    <span
      aria-hidden
      className={`flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white ${place === null ? 'bg-[var(--ph-alarm)]' : 'bg-[var(--ph-ink)]'}`}
    >
      {place === null ? '!' : place}
    </span>
  );
}

export const PAY_BUTTON = 'ph-focus flex h-[30px] shrink-0 items-center rounded-full bg-[var(--ph-tint)] px-[14px] text-[14px] font-semibold text-white';

/** One debt in pay order: badge, name (with its late tag), what it is, the amount next due, and Pay. */
export function PayFirstRowView({ row, trailing }: { row: PayFirstRow; trailing?: ReactNode }) {
  const { debt } = row;
  return (
    <div className="flex items-center gap-3 px-[16px] py-[11px]">
      <PlaceBadge place={row.place} />
      <Link {...debtDestination(debt)} className="ph-focus min-w-0 flex-1 rounded">
        <span className="block truncate text-[17px] leading-[22px] font-medium text-[var(--ph-ink)] md:text-[15px] md:leading-[20px]">{debt.name}</span>
        <span className="mt-[2px] flex min-w-0 items-center gap-[6px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
          {row.lateTag && <span className="shrink-0 rounded-[4px] bg-[var(--ph-alarm-panel)] px-[5px] font-semibold text-[var(--ph-alarm)]">{row.lateTag}</span>}
          <span className="truncate">{row.subtitle}</span>
        </span>
      </Link>
      <span className="flex shrink-0 flex-col items-end">
        {row.amountMinor !== null && <span className="tabular text-[15px] text-[var(--ph-ink)]">{formatMinor(row.amountMinor, debt.currency)}</span>}
        {row.extraTag && debt.accountId && (
          <PayLink target={loanPay(debt.accountId, 'extra')} className="ph-focus rounded text-[12.5px] leading-[16px] font-semibold text-[var(--ph-up)]" testId="plan-extra-tag">
            {row.extraTag}
          </PayLink>
        )}
      </span>
      {row.pay ? (
        <PayLink target={row.pay} className={PAY_BUTTON} label={`Pay ${debt.name}`}>
          Pay
        </PayLink>
      ) : (
        <span className="w-[52px] shrink-0" aria-hidden />
      )}
      {trailing}
    </div>
  );
}
