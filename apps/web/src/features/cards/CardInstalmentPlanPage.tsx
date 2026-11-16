import { formatMinor, installmentSchedule, monthName } from '@expanses/core';
import { setInstallmentCountMode } from '@expanses/db';
import { getRouteApi } from '@tanstack/react-router';
import { useBack } from '../../app/BackHeader';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, ReadOnlyRow } from '../../ui/native';
import { CountSpendingRow, usePlanEditor } from '../loans/InstallmentList';
import { countSpendingFooter } from '../loans/plan-view';
import { useCardLines, useInstallments, useStatementDay } from '../loans/queries';
import { useMonthStart } from '../workspaces/queries';
import { CardScreen, useCardPage } from './card-page';
import { TextLine } from './rows';

const route = getRouteApi('/cards/$cardId/settings/instalments/$planId');

const dayMonthYear = (iso: string) => `${Number(iso.slice(8, 10))} ${monthName(iso.slice(0, 7), 'short')} ${iso.slice(0, 4)}`;

/**
 * One instalment plan on a page of its own (card instalments, option C): its figures and how its spending counts
 * (At purchase | Each month). The instalment rows on the statement and on Cashflow open here; ✎ changes the plan.
 */
export function CardInstalmentPlanPage() {
  const { cardId, planId } = route.useParams();
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const { page, gate } = useCardPage(cardId);
  const plans = useInstallments(cardId);
  const plan = (plans.data ?? []).find((row) => row.id === planId);
  const statementDay = useStatementDay(cardId).data ?? 1;
  const monthStart = useMonthStart();
  const lines = useCardLines(cardId, !!plan?.transactionId);
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
  const purchase = plan.transactionId ? (lines.data ?? []).find((line) => line.transactionId === plan.transactionId && !line.instalment) : undefined;
  const footer = countSpendingFooter(plan, installmentSchedule(plan, statementDay), currency, monthStart);

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
          <ReadOnlyRow label="Amount" value={formatMinor(plan.totalMinor, currency)} />
          <ReadOnlyRow label="Months" value={String(plan.months)} />
          <ReadOnlyRow label="Each month" value={formatMinor(plan.monthlyMinor, currency)} />
          <ReadOnlyRow label="Purchase" value={purchase ? `${purchase.description} · ${dayMonthYear(purchase.occurredOn)}` : plan.transactionId ? 'Chosen' : 'None'} />
        </InsetGroup>

        <InsetGroup header="Count spending" footer={footer}>
          <CountSpendingRow value={plan.countMode} onChange={(mode) => void setMode(mode)} disabled={busy} />
        </InsetGroup>
        <ErrorBox error={error} />

        {editor.node}
      </div>
    </CardScreen>
  );
}
