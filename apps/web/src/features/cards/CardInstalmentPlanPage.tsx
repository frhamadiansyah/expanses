import { formatMinor, installmentSchedule, isoDate, monthName } from '@expanses/core';
import { setInstallmentCountMode } from '@expanses/db';
import { getRouteApi } from '@tanstack/react-router';
import { useBack } from '../../app/BackHeader';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ProgressBar, ReadOnlyRow } from '../../ui/native';
import { categoryLabel, CountSpendingRow, NoPurchaseWarning, usePlanEditor } from '../loans/InstallmentList';
import { countSpendingFooter, noPurchaseWarning, planProgress, purchaseStateOf } from '../loans/plan-view';
import { useCardLines, useCardRecordsFrom, useInstallments, usePlanCategoryChoices, usePlanInstalments, useStatementDay } from '../loans/queries';
import { useMonthStart } from '../workspaces/queries';
import { CardScreen, useCardPage } from './card-page';
import { Line, SUBTITLE, TextLine, TITLE } from './rows';

const route = getRouteApi('/cards/$cardId/settings/instalments/$planId');

const STATUS_WORD = { paid: 'paid', billed: 'billed', upcoming: 'upcoming' } as const;
const dayMonthYear = (iso: string) => `${Number(iso.slice(8, 10))} ${monthName(iso.slice(0, 7), 'short')} ${iso.slice(0, 4)}`;

/**
 * One instalment plan on a page of its own (card instalments, option C): how far it is — paid of its months, what is
 * left, when it ends — how its spending counts (At purchase | Each month), and each of its instalments, newest first,
 * paid, billed or upcoming. The instalment rows on the statement and on Cashflow open here; ✎ changes the plan.
 */
export function CardInstalmentPlanPage() {
  const { cardId, planId } = route.useParams();
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const { page, gate } = useCardPage(cardId);
  const plans = useInstallments(cardId);
  const plan = (plans.data ?? []).find((row) => row.id === planId);
  const today = isoDate();
  const statuses = usePlanInstalments(planId, today);
  const statementDay = useStatementDay(cardId).data ?? 1;
  const monthStart = useMonthStart();
  const lines = useCardLines(cardId);
  const recordsFrom = useCardRecordsFrom(cardId).data ?? null;
  const categories = usePlanCategoryChoices(!!plan && !plan.transactionId).data ?? [];
  const fallback = `/cards/${cardId}/settings/instalments` as const;
  // Removed from its own page, the plan has no page left: back to where it was opened from.
  const goBack = useBack(fallback);
  const editor = usePlanEditor(cardId, page?.currency ?? '', { onRemoved: goBack });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  if (!page || !plan) {
    return (
      <CardScreen title="Instalment plan" back="Instalments" fallback={fallback}>
        {gate ?? (plans.isSuccess && <TextLine tone="ink-3">This plan is not on this card any more.</TextLine>)}
      </CardScreen>
    );
  }
  const currency = page.currency;
  const progress = planProgress(plan.totalMinor, statuses.data ?? []);
  const purchase = plan.transactionId ? (lines.data ?? []).find((line) => line.transactionId === plan.transactionId && !line.instalment) : undefined;
  const categoryName = plan.categoryAccountId ? categoryLabel(plan.categoryAccountId, categories) || null : null;
  const state = purchaseStateOf(plan, lines.data ?? [], recordsFrom);
  const footer = countSpendingFooter(plan, installmentSchedule(plan, statementDay), currency, monthStart, {
    categoryName,
    recordsFrom,
    investment: plan.linkedToTrade,
    beforeRecords: state === 'before-records',
  });
  // A plan left with no purchase though one may be recorded (auto-link found none, or several): said until it is chosen.
  const warning = noPurchaseWarning(state, plan.countMode, categoryName, true);

  async function setMode(countMode: 'at_purchase' | 'each_month') {
    if (!plan || countMode === plan.countMode) return;
    setError(null);
    setBusy(true);
    try {
      await setInstallmentCountMode(database, ws, plan.id, countMode);
      await invalidate();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardScreen
      title={plan.description}
      back="Instalments"
      fallback={fallback}
      actions={[{ key: 'edit', label: 'Edit plan', glyph: <Pencil size={19} aria-hidden />, run: () => editor.open(plan) }]}
    >
      <div data-testid="instalment-plan-page">
        <InsetGroup>
          <Line testId="instalment-progress">
            <span className="flex w-full items-baseline justify-between gap-[8px]">
              <span className={TITLE}>
                {progress.paid} of {progress.of} paid
              </span>
              <span className="tabular shrink-0 text-[15px] leading-[20px] text-[var(--ph-ink)]">{formatMinor(progress.leftMinor, currency)} left</span>
            </span>
            <ProgressBar className="my-[6px] w-full" currentMinor={progress.paid} targetMinor={progress.of} label={`${plan.description}: ${progress.paid} of ${progress.of} paid`} />
            <span className={`block ${SUBTITLE}`}>
              {progress.endsMonth ? `Ends ${monthName(progress.endsMonth, 'long')} ${progress.endsMonth.slice(0, 4)} · ` : ''}
              {formatMinor(plan.monthlyMinor, currency)} a month
            </span>
          </Line>
        </InsetGroup>

        <InsetGroup>
          <ReadOnlyRow label="Amount" value={formatMinor(plan.totalMinor, currency)} />
          <ReadOnlyRow label="Months" value={String(plan.months)} />
          <ReadOnlyRow label="Each month" value={formatMinor(plan.monthlyMinor, currency)} />
          <ReadOnlyRow label="Purchase" value={purchase ? `${purchase.description} · ${dayMonthYear(purchase.occurredOn)}` : plan.transactionId ? 'Chosen' : 'None'} />
          {!plan.transactionId && <ReadOnlyRow label="Category" value={categoryName ?? 'Uncategorised'} />}
        </InsetGroup>

        {plan.linkedToTrade ? (
          // An investment bought with the card (TF 139): never spending, so there is no choice to make.
          <p data-testid="investment-plan-note" className="mx-[16px] mb-[18px] text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
            {footer}
          </p>
        ) : (
          <InsetGroup header="Count spending" footer={footer}>
            <CountSpendingRow value={plan.countMode} onChange={(mode) => void setMode(mode)} disabled={busy} />
          </InsetGroup>
        )}
        <ErrorBox error={error} />
        <NoPurchaseWarning text={warning} />

        <InsetGroup header="Instalments">
          {progress.rows.length === 0 && <TextLine tone="ink-3">None yet</TextLine>}
          {progress.rows.map((row) => (
            <InsetRow
              key={row.number}
              testId="plan-instalment"
              title={`${row.number} of ${row.of}`}
              subtitle={`${dayMonthYear(row.statementOn)} · ${STATUS_WORD[row.status]}`}
              value={formatMinor(row.amountMinor, currency)}
              valueTone="ink"
              // The statement it is billed on, where the payment that covers it is.
              to="/cards/$cardId/statement"
              params={{ cardId }}
            />
          ))}
        </InsetGroup>
        {editor.node}
      </div>
    </CardScreen>
  );
}
