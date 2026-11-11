import { formatMinor } from '@expanses/core';
import { Money } from '../../ui';
import { Panel, ProgressRing } from '../../ui/native';
import type { DebtPlanModel } from './queries';
import { PayLink } from './PayLink';

/**
 * The plan's header (spec §4.0): the ring with the share repaid, Left to pay, the Debt-free month (or why it is not
 * known), the three counts, and Pay next. Every figure is the base currency; a debt with no rate is named, not added.
 */
export function PlanHeader({ model, baseCurrency }: { model: DebtPlanModel; baseCurrency: string }) {
  const { summary } = model;
  const { counts, debtFree, payNext } = summary;
  return (
    <Panel testId="plan-header">
      <div className="flex items-center gap-4">
        <ProgressRing fraction={summary.percent / 100} reached={false} size={72} inner={7} text="text-[15px]" label={`${summary.percent}% repaid`} testId="plan-ring" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-[17px] text-[var(--ph-ink-3)]">Left to pay</p>
          {summary.leftMinor === null ? (
            <p data-testid="plan-left" className="text-[22px] leading-[28px] font-extrabold tracking-[-0.03em] text-[var(--ph-warn)]">
              No {summary.missing.join(', ')} rate yet
            </p>
          ) : (
            <p data-testid="plan-left" className="text-[28px] leading-[34px] font-extrabold tracking-[-0.03em] text-[var(--ph-ink)]">
              <Money minor={summary.leftMinor} currency={baseCurrency} />
            </p>
          )}
          {summary.repaidMinor !== null && summary.borrowedMinor !== null && (
            <p data-testid="plan-repaid" className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
              repaid {formatMinor(summary.repaidMinor, baseCurrency)} of {formatMinor(summary.borrowedMinor, baseCurrency)}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 border-t border-[var(--ph-hair)] pt-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] text-[var(--ph-ink-2)]">Debt-free</span>
          <span data-testid="plan-debt-free" className="text-[15px] font-semibold text-[var(--ph-ink)]">
            {debtFree.month ?? (counts.active > 0 ? 'Unknown' : '—')}
          </span>
        </div>
        {debtFree.why && (
          <p data-testid="plan-debt-free-why" className="mt-1 text-right text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
            {debtFree.why}
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 border-t border-[var(--ph-hair)] pt-3 text-center">
        <Count testId="plan-count-active" n={counts.active} word="active" tone="text-[var(--ph-ink)]" />
        <Count testId="plan-count-late" n={counts.late} word="late" tone={counts.late > 0 ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink)]'} />
        <Count testId="plan-count-paid-off" n={counts.paidOff} word="paid off" tone={counts.paidOff > 0 ? 'text-[var(--ph-up)]' : 'text-[var(--ph-ink)]'} />
      </div>

      {payNext && payNext.item.pay && (
        <div data-testid="plan-pay-next" className="mt-4">
          <PayLink
            target={payNext.item.pay}
            className="flex min-h-[48px] w-full items-center justify-center rounded-[12px] bg-[var(--ph-tint)] px-4 text-center text-[16px] font-semibold text-white"
          >
            <span className="truncate">
              Pay next · {payNext.debt.name}
              {payNext.item.minor !== null && <> {formatMinor(payNext.item.minor, payNext.item.currency)}</>}
            </span>
          </PayLink>
          <p className={`mt-[6px] text-center text-[13px] leading-[17px] ${payNext.item.status === 'late' ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-ink-3)]'}`}>{payNext.when}</p>
        </div>
      )}
    </Panel>
  );
}

function Count({ testId, n, word, tone }: { testId: string; n: number; word: string; tone: string }) {
  return (
    <div data-testid={testId}>
      <span className={`block text-[20px] leading-[24px] font-bold ${tone}`}>{n}</span> <span className="block text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{word}</span>
    </div>
  );
}
