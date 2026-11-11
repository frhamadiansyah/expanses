import type { DebtPlanSettings } from '@expanses/db';
import { ListOrdered, Wallet } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { usePhone } from '../../app/use-phone';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { PlanHeader } from './PlanHeader';
import { ExtraControls, MethodControl, settingsOf } from './PlanControls';
import { methodLabel, payFirstRows } from './plan-view';
import { PlanTable } from './PlanTable';
import { type DebtPlanModel, useDebtPlan, useDebtPlanSettings, useSaveDebtPlanSettings } from './queries';

/**
 * The Debt-free plan (spec §4.0): a page of its own, opened from Net worth, Liabilities, Account and the sidebar. It
 * reads every debt the Liabilities page reads and never posts; each Pay opens the debt's own existing sheet.
 */
export function DebtPlanPage() {
  const { ws } = useApp();
  const phone = usePhone();
  const { model, error } = useDebtPlan();

  return (
    <div className={SCREEN}>
      <PushedTitle title="Debt-free plan" back="Net worth" backTo="/net-worth" />
      <ErrorBox error={error} />
      {model && model.debts.length === 0 && (
        <>
          <Empty>Nothing owed. Debts added on Liabilities show up here.</Empty>
          <InsetGroup>
            <InsetRow icon={<Wallet size={16} aria-hidden />} title="Liabilities" to="/net-worth/loans" />
          </InsetGroup>
        </>
      )}
      {model && model.debts.length > 0 && !phone && <WidePlan model={model} baseCurrency={ws.baseCurrency} />}
      {model && model.debts.length > 0 && phone && (
        <>
          <PlanHeader model={model} baseCurrency={ws.baseCurrency} />
          <InsetGroup>
            <InsetRow icon={<ListOrdered size={16} aria-hidden />} title="Pay first" value={methodLabel(model.method)} to="/net-worth/plan/pay-first" testId="plan-row-pay-first" />
          </InsetGroup>
        </>
      )}
    </div>
  );
}

/**
 * The plan on a wide screen (spec §4.5): the header, the order and the extra in a fixed left column, and the numbered
 * list as a table beside them. Moving debts by hand stays on Pay first, which the wide screen still opens.
 */
function WidePlan({ model, baseCurrency }: { model: DebtPlanModel; baseCurrency: string }) {
  const settings = useDebtPlanSettings();
  const saveSettings = useSaveDebtPlanSettings();
  const [saveError, setSaveError] = useState<unknown>(null);
  const saved = settingsOf(settings.data);
  const save = (next: DebtPlanSettings) => {
    setSaveError(null);
    saveSettings(next).catch(setSaveError);
  };
  const rows = payFirstRows(model.debts, model.effect.plan.order, model.extraMinor, baseCurrency);
  return (
    <div className="grid grid-cols-[260px_minmax(0,1fr)] items-start gap-6" data-testid="plan-wide">
      <div className="min-w-0">
        <PlanHeader model={model} baseCurrency={baseCurrency} />
        <MethodControl model={model} saved={saved} save={save} width={260} />
        <ExtraControls model={model} saved={saved} save={save} baseCurrency={baseCurrency} />
        <ErrorBox error={saveError} />
      </div>
      <div className="min-w-0">
        <PlanTable rows={rows} />
        {model.method === 'byHand' && (
          <InsetGroup>
            <InsetRow icon={<ListOrdered size={16} aria-hidden />} title="Set the order by hand" to="/net-worth/plan/pay-first" />
          </InsetGroup>
        )}
      </div>
    </div>
  );
}
