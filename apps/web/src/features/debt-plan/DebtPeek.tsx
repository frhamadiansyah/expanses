import { formatMinor, type ExtraEffect } from '@expanses/core';
import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { cx } from '../../ui';
import { PILL_BLACK, PILL_SMALL, Tag, Track } from '../../ui/desk';
import { iconTint, RowIcon } from '../../ui/native';
import { SidePeek } from '../../ui/native/SidePeek';
import { useRecentTransactions } from '../accounts/queries';
import { debtKindTile } from '../ownables/catalogue-view';
import { debtKindLook, type DeskContext, endsWords, instalmentWords, nextPayments } from './debt-plan-desk-model';
import { loanPay } from './pay-target';
import { PayLink } from './PayLink';
import type { PlanDebt } from './plan-inputs';
import { rateWords } from './debt-plan-desk-model';

/** A small caps heading inside the peek (LEFT, NEXT PAYMENTS). */
const CAPS = 'text-[11.5px] font-bold tracking-[0.06em] text-[var(--mk-ink-3)] uppercase';

/** A debt's kind in a tinted round: the Liabilities page's drawing for it (`debtKindTile`). */
export function DebtKindIcon({ debt, size = 24 }: { debt: Pick<PlanDebt, 'itemId' | 'icon'>; size?: number }) {
  const look = debtKindLook(debt);
  const Glyph = debtKindTile(look.key);
  return (
    <span title={look.label} className="inline-flex shrink-0">
      <RowIcon tint={iconTint(look.colour)} size={size}>
        <Glyph size={Math.round(size * 0.55)} strokeWidth={2.2} aria-hidden />
      </RowIcon>
    </span>
  );
}

/** Where a debt is edited, as its own pages have it: a loan's page, a card's settings, Lend & borrow for a person. */
export function editTarget(debt: PlanDebt): { to: string; params?: Record<string, string>; search?: Record<string, string> } {
  if (debt.kind === 'loan' && debt.accountId) return { to: '/net-worth/loans/$accountId', params: { accountId: debt.accountId } };
  if (debt.kind === 'card' && debt.accountId) return { to: '/cards/$cardId/settings', params: { cardId: debt.accountId } };
  return { to: '/net-worth/lend-borrow', search: debt.personName ? { person: debt.personName } : {} };
}

/** The account a loan's last payment came from, read off its own recent payments; null before the first. */
function useLastPaidFrom(debt: PlanDebt): string | null {
  const loan = debt.kind === 'loan' && debt.accountId ? debt.accountId : null;
  const recent = useRecentTransactions(loan ? [loan] : []);
  if (!loan) return null;
  const last = (recent.data ?? [])
    .filter((tx) => tx.entries.some((entry) => entry.accountId === loan && entry.amountMinor > 0))
    .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn))[0];
  return last?.entries.find((entry) => entry.accountId !== loan && entry.amountMinor < 0 && entry.accountKind !== 'expense')?.accountName ?? null;
}

function Row({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex items-baseline gap-3 border-t border-[var(--mk-line)] px-[16px] py-[9px] text-[13.5px]">
      <span className="shrink-0 text-[var(--mk-ink-2)]">{label}</span>
      <span data-testid={testId} className="min-w-0 flex-1 text-right break-words text-[var(--mk-ink)] tabular-nums">
        {children}
      </span>
    </div>
  );
}

/**
 * A debt in the Mac plan's side peek: what is left (the bar, paid and borrowed), Pay its next payment, Pay extra and
 * Edit — the debt's own pages' sheets —, its rate, instalment, where it was last paid from and when it ends (with the
 * extra, when the extra brings it forward), the next payments with what is late first, and its full schedule.
 */
export function DebtPeek({
  debt,
  ctx,
  effect,
  extraMinor,
  top,
  first,
  last,
  onStep,
  onClose,
  onSchedule,
}: {
  debt: PlanDebt;
  ctx: DeskContext;
  effect: ExtraEffect;
  extraMinor: number;
  top: number;
  first: boolean;
  last: boolean;
  onStep: (by: -1 | 1) => void;
  onClose: () => void;
  onSchedule: () => void;
}) {
  const navigate = useNavigate();
  const paidFrom = useLastPaidFrom(debt);
  const payments = nextPayments(debt, ctx, 3);
  const instalment = instalmentWords(debt, ctx);
  const ends = endsWords(debt, effect, extraMinor);
  const repaid = debt.borrowedMinor > 0 ? Math.min(100, Math.max(0, (debt.repaidMinor / debt.borrowedMinor) * 100)) : 0;
  const pay = debt.next?.pay ?? null;
  const edit = editTarget(debt);
  return (
    <SidePeek
      top={top}
      label="Debt details"
      testId="debt-peek"
      noun="debt"
      first={first}
      last={last}
      onStep={onStep}
      onClose={onClose}
      title={
        <span className="flex items-center gap-[8px]">
          <DebtKindIcon debt={debt} size={26} />
          <span data-testid="debt-peek-name">{debt.name}</span>
        </span>
      }
    >
      <div className="px-[16px] pt-[2px] pb-[12px]">
        <div className={CAPS}>Left</div>
        <div data-testid="debt-peek-left" className="text-[24px] leading-[30px] font-extrabold tracking-[-0.3px] text-[var(--mk-ink)] tabular-nums">
          {formatMinor(debt.leftMinor, debt.currency)}
        </div>
        <Track share={repaid / 100} colour="var(--mk-c-green)" className="my-[9px]" />
        <div className="flex flex-wrap gap-x-[12px] text-[12.5px] text-[var(--mk-ink)] tabular-nums">
          <span>
            <span className="text-[var(--mk-ink-2)]">Paid</span> <span data-testid="debt-peek-paid">{formatMinor(debt.repaidMinor, debt.currency)}</span>
          </span>
          <span>
            <span className="text-[var(--mk-ink-2)]">Borrowed</span> <span data-testid="debt-peek-borrowed">{formatMinor(debt.borrowedMinor, debt.currency)}</span>
          </span>
        </div>
      </div>
      <div className="flex flex-wrap gap-[6px] px-[16px] pb-[14px]">
        {pay && (
          <PayLink target={pay} className={PILL_BLACK} label={`Pay ${debt.name}`} testId="debt-peek-pay">
            Pay{debt.next?.minor != null ? ` ${formatMinor(debt.next.minor, debt.currency)}` : ''}
          </PayLink>
        )}
        {debt.kind === 'loan' && debt.accountId && debt.hasTerms && (
          <PayLink target={loanPay(debt.accountId, 'extra')} className={cx(PILL_SMALL, 'h-[30px] px-[13px]')} testId="debt-peek-extra">
            Pay extra
          </PayLink>
        )}
        <button type="button" className={cx(PILL_SMALL, 'h-[30px] px-[13px]')} onClick={() => void navigate(edit as Parameters<typeof navigate>[0])}>
          Edit
        </button>
      </div>
      <Row label="Rate" testId="debt-peek-rate">
        {rateWords(debt)}
      </Row>
      {instalment && (
        <Row label="Instalment" testId="debt-peek-instalment">
          {instalment}
        </Row>
      )}
      {debt.kind === 'loan' && (
        <Row label="Paid from" testId="debt-peek-paid-from">
          {paidFrom ?? '—'}
        </Row>
      )}
      {ends && (
        <Row label="Ends" testId="debt-peek-ends">
          {ends}
        </Row>
      )}
      <div className={cx(CAPS, 'border-t border-[var(--mk-line)] px-[16px] pt-[12px] pb-[4px]')}>Next payments</div>
      {payments.length === 0 && <p className="px-[16px] pb-[8px] text-[13px] text-[var(--mk-ink-2)]">No fixed months.</p>}
      <ul aria-label="Next payments">
        {payments.map((payment, index) => (
          <li key={payment.key} data-testid="debt-peek-payment" className={cx('flex items-center gap-[8px] px-[16px] py-[8px] text-[13.5px]', index > 0 && 'border-t border-[var(--mk-line)]')}>
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[6px]">
              {payment.late && <Tag tone="red">{payment.late}</Tag>}
              <span className="text-[var(--mk-ink)]">{payment.when}</span>
            </span>
            <span className="shrink-0 whitespace-nowrap text-[var(--mk-ink)] tabular-nums">{payment.minor !== null ? formatMinor(payment.minor, payment.currency) : ''}</span>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onSchedule} data-testid="debt-peek-schedule" className="border-t border-[var(--mk-line)] px-[16px] py-[10px] text-left text-[13.5px] font-semibold text-[var(--mk-blue)] hover:underline">
        Full schedule ›
      </button>
    </SidePeek>
  );
}
