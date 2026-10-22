import { formatMinor, isoDate } from '@expanses/core';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { MONEY_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, PushedTitle, SCREEN } from '../../ui/native';
import { useGoals } from '../goals/queries';
import { TradeSheet } from './AssetSheets';
import { useAssetValues, useDueTemplates, useTradeTemplates } from './queries';
import { TemplateList } from './TemplateList';
import { type TradeDraft, typedAmount } from './trade-form';

/**
 * The monthly plans, off Buy & sell: what is due now with Record beside it, then every plan with Add a plan.
 *
 * Recording a due buy opens the full form with the plan's holding, amount, account and goal in it, and saves against
 * the plan, so it stops being due — the units still come from the fund's or broker's confirmation.
 */
export function MonthlyPlansPage() {
  const { ws } = useApp();
  const values = useAssetValues();
  const templates = useTradeTemplates();
  const due = useDueTemplates();
  const accounts = useAccounts();
  const goals = useGoals();
  const [recording, setRecording] = useState<{ templateId: string; initial: Partial<TradeDraft> } | null>(null);

  const holdings = (values.data ?? [])
    .filter((row) => row.mode === 'market' || row.mode === 'amount')
    .map((row) => ({ accountId: row.accountId, name: row.name, currency: row.currency, byMoney: row.mode === 'amount' }));
  const nameOf = (accountId: string) => holdings.find((row) => row.accountId === accountId)?.name ?? 'Holding';
  const currencyOf = (accountId: string) => holdings.find((row) => row.accountId === accountId)?.currency ?? ws.baseCurrency;
  const cashAccounts = moneyHolders(accounts.data ?? []).filter((account) => MONEY_SUBTYPES.includes(account.subtype));
  const goalOptions = (goals.data ?? []).map((goal) => ({ id: goal.id, name: goal.name }));
  const open = recording ? holdings.find((row) => row.accountId === recording.initial.accountId) : undefined;

  return (
    <div className={SCREEN}>
      <PushedTitle title="Monthly plans" back="Buy & sell" backTo="/net-worth/trades" />
      <ErrorBox error={values.error ?? templates.error} />

      {(due.data?.length ?? 0) > 0 && (
        <InsetGroup header="Due now" footer="Confirm the units and amount from the fund or broker confirmation before saving.">
          {(due.data ?? []).map((template) => (
            <InsetRow
              key={template.id}
              title={nameOf(template.accountId)}
              subtitle={`${template.amountMinor === null ? '' : `${formatMinor(template.amountMinor, currencyOf(template.accountId))} · `}due on the ${template.dayOfMonth}`}
              label={`Record it · ${nameOf(template.accountId)}`}
              onClick={() =>
                setRecording({
                  templateId: template.id,
                  initial: {
                    kind: 'buy',
                    accountId: template.accountId,
                    cashAccountId: template.cashAccountId,
                    gross: template.amountMinor === null ? '' : typedAmount(template.amountMinor, currencyOf(template.accountId)),
                    goalId: template.goalId ?? '',
                    occurredOn: isoDate(),
                  },
                })
              }
            />
          ))}
        </InsetGroup>
      )}

      {holdings.length > 0 && <TemplateList templates={templates.data ?? []} holdings={holdings} cashAccounts={cashAccounts} goals={goalOptions} />}

      {recording && open && (
        <TradeSheet title="Buy" holding={open} initial={recording.initial} editing={null} templateId={recording.templateId} onClose={() => setRecording(null)} />
      )}
    </div>
  );
}
