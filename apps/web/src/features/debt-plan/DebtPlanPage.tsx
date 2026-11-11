import { ListOrdered, Wallet } from 'lucide-react';
import { useApp } from '../../app/context';
import { Empty, ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { PlanHeader } from './PlanHeader';
import { methodLabel } from './plan-view';
import { useDebtPlan } from './queries';

/**
 * The Debt-free plan (spec §4.0): a page of its own, opened from Net worth, Liabilities, Account and the sidebar. It
 * reads every debt the Liabilities page reads and never posts; each Pay opens the debt's own existing sheet.
 */
export function DebtPlanPage() {
  const { ws } = useApp();
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
      {model && model.debts.length > 0 && (
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
