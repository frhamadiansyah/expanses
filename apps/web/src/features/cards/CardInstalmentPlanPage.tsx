import { formatMinor, installmentSchedule, isoDate, monthName } from '@expanses/core';
import { setPlanPaidSoFar } from '@expanses/db';
import { getRouteApi } from '@tanstack/react-router';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useBack } from '../../app/BackHeader';
import { Pencil } from 'lucide-react';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, ProgressBar, ReadOnlyRow } from '../../ui/native';
import { categoryLabel, NoPurchaseWarning, usePlanEditor } from '../loans/InstallmentList';
import { PaidList } from '../loans/PaidList';
import { countingLine, dayMonthYear, mayCountTwice, noPurchaseWarning, owedFooter, paidListRows, planProgress } from '../loans/plan-view';
import { useCardDays, useCardHasOpening, useCardLines, useInstallments, usePlanCategoryChoices, usePlanInstalments } from '../loans/queries';
import { useMonthStart } from '../workspaces/queries';
import { CardScreen, useCardPage } from './card-page';
import { Line, SUBTITLE, TextLine, TITLE } from './rows';

const route = getRouteApi('/cards/$cardId/settings/instalments/$planId');

const STATUS_WORD = { paid: 'paid', billed: 'billed', upcoming: 'upcoming' } as const;

/**
 * One instalment plan on a page of its own (card instalments, option C): how far it is — paid of its months, what is
 * left, when it ends — how its spending counts (At purchase | Each month), and each of its instalments, newest first,
 * paid, billed or upcoming. The instalment rows on the statement and on Cashflow open here; ✎ changes the plan. A plan
 * with no purchase lists them as its Paid list (owner, 17 Nov 2026, mockup 1b): a tap on a circle ticks it and every one
 * before it, or unticks it and every one after, and the card's balance follows.
 */
export function CardInstalmentPlanPage() {
  const { cardId, planId } = route.useParams();
  const accounts = useAccounts().data ?? [];
  const { page, gate } = useCardPage(cardId);
  const plans = useInstallments(cardId);
  const plan = (plans.data ?? []).find((row) => row.id === planId);
  const today = isoDate();
  const statuses = usePlanInstalments(planId, today);
  const days = useCardDays(cardId).data;
  const statementDay = days?.statementDay ?? 1;
  const monthStart = useMonthStart();
  const lines = useCardLines(cardId);
  const categories = usePlanCategoryChoices(!!plan && !plan.transactionId).data ?? [];
  const hasOpening = useCardHasOpening(cardId, !!plan && !plan.transactionId).data ?? false;
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const [paidOpen, setPaidOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fallback = `/cards/${cardId}/settings/instalments` as const;
  // Removed from its own page, the plan has no page left: back to where it was opened from.
  const goBack = useBack(fallback);
  const editor = usePlanEditor(cardId, page?.currency ?? '', { onRemoved: goBack });

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
  // How it counts is the app's (TF 139): an investment buy, or Investment chosen with no purchase, is saving.
  const investment = plan.countMode === 'at_purchase' && (plan.linkedToTrade || !plan.transactionId);
  // A purchase counts in its own category, which its instalment rows name.
  const ownRow = (lines.data ?? []).find((line) => line.instalment?.planId === plan.id && line.instalment.categoryId);
  const purchaseCategory = ownRow?.instalment?.categoryId ? (accounts.find((account) => account.id === ownRow.instalment!.categoryId)?.name ?? null) : null;
  const line = countingLine({ investment, monthlyMinor: plan.monthlyMinor, transactionId: plan.transactionId }, installmentSchedule(plan, statementDay), currency, monthStart, {
    categoryName: plan.transactionId ? purchaseCategory : categoryName,
    paidSoFar: plan.paidSoFar,
  });
  // A plan with no purchase while the card holds an untied purchase of its total: said until it is chosen.
  const warning = noPurchaseWarning(mayCountTwice(plan, lines.data ?? []), investment, categoryName);
  // With no purchase: the Paid list. One a card payment covers is paid, but not the list's to untick.
  const covered = new Set((statuses.data ?? []).filter((row) => row.status === 'paid' && !row.ticked).map((row) => row.number));
  const paidRows = plan.transactionId
    ? null
    : paidListRows({ schedule: installmentSchedule(plan, statementDay), paidSoFar: plan.paidSoFar, dueDay: days?.dueDay ?? null, covered, today, open: 0, expanded: paidOpen });
  const cardName = accounts.find((account) => account.id === cardId)?.name ?? 'the card';
  const ownId = plan.id;
  async function tick(paidSoFar: number) {
    setError(null);
    setBusy(true);
    try {
      await setPlanPaidSoFar(database, ws, ownId, paidSoFar);
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
          {!plan.transactionId && <ReadOnlyRow label="Category" value={investment ? 'Investment (not spending)' : (categoryName ?? 'Personal · Uncategorised')} />}
        </InsetGroup>

        {/* How it counts, said plainly: the app decides it from the purchase or the category. */}
        <p data-testid="plan-counting" className="mx-[16px] mb-[18px] text-[13px] leading-[18px] text-[var(--ph-ink-3)]">
          {line}
        </p>
        <NoPurchaseWarning text={warning} />

        <ErrorBox error={error} />
        {paidRows ? (
          <PaidList
            header="Instalments"
            rows={paidRows}
            currency={currency}
            footer={<span data-testid="plan-owed">{owedFooter(plan, plan.paidSoFar, currency, cardName, hasOpening)}</span>}
            disabled={busy}
            onTap={(paidSoFar) => void tick(paidSoFar)}
            onExpand={() => setPaidOpen(true)}
          />
        ) : (
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
        )}
        {editor.node}
      </div>
    </CardScreen>
  );
}
