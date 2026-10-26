import { useState } from 'react';
import { InsetGroup, PickerRow } from '../../ui/native';
import { planRowValue } from './monthly-plans';
import { PlanSheet } from './PlanSheet';
import { useAssetValues, useTradeTemplates } from './queries';
import { useStockAndBroker } from './StockAndBroker';

/**
 * A holding's regular buy: the money and the day, opening the sheet that sets, changes or removes it. Set once and
 * left, so it sits in the holding's Settings; when its day comes it is due on the Recurring page, under the bills.
 */
export function MonthlyPlanGroup({ accountId }: { accountId: string }) {
  const values = useAssetValues();
  const templates = useTradeTemplates();
  const stock = useStockAndBroker(accountId);
  const [open, setOpen] = useState(false);

  const value = values.data?.find((row) => row.accountId === accountId);
  // Only a holding bought by the unit or by the money takes a plan, as Add a plan offered before.
  if (!value || (value.mode !== 'market' && value.mode !== 'amount') || !templates.isSuccess) return null;
  const plans = templates.data.filter((template) => template.accountId === accountId && template.kind === 'buy');
  const holding = { accountId, name: value.name, currency: value.currency, byMoney: value.mode === 'amount' };

  return (
    <>
      <InsetGroup>
        <PickerRow
          label="Monthly plan"
          value={planRowValue(plans, value.currency)}
          info="When its day comes, the buy is due on Recurring, under the bills."
          onOpen={() => setOpen(true)}
          testId="monthly-plan"
        />
      </InsetGroup>
      {open && <PlanSheet holding={holding} plans={plans} defaultCashId={stock.link?.brokerAccountId ?? null} onClose={() => setOpen(false)} />}
    </>
  );
}
