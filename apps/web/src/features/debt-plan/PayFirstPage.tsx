import type { DebtPlanSettings } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { usePhone, useSideways } from '../../app/use-phone';
import { DesktopDebtPlan } from './DesktopDebtPlan';
import { ErrorBox } from '../../ui';
import { Panel, PushedTitle, SCREEN } from '../../ui/native';
import { ByHandList, Hair } from './ByHandList';
import { ExtraControls, MethodControl, settingsOf } from './PlanControls';
import { payFirstRows } from './plan-view';
import { PayFirstRowView } from './PayFirstRowView';
import { useDebtPlan, useDebtPlanSettings, useSaveDebtPlanSettings } from './queries';

/**
 * Pay first (spec §4.1): the order the debts are paid in, the suggestion, an extra amount a month with the month it
 * brings forward and the interest it saves, and every active debt in that order — late ones on top — each with Pay.
 */
export function PayFirstPage() {
  const phone = usePhone();
  const sideways = useSideways();
  // On a wide screen Pay first is the Plan view's own box and table.
  if (!phone && !sideways) return <DesktopDebtPlan view="plan" />;
  return <PhonePayFirstPage />;
}

function PhonePayFirstPage() {
  const { ws } = useApp();
  const { model, error } = useDebtPlan();
  const settings = useDebtPlanSettings();
  const saveSettings = useSaveDebtPlanSettings();
  const [saveError, setSaveError] = useState<unknown>(null);
  // The order just moved by hand, shown at once while it saves.
  const [moved, setMoved] = useState<string[] | null>(null);

  const saved = settingsOf(settings.data);
  const save = (next: DebtPlanSettings) => {
    setSaveError(null);
    saveSettings(next).catch(setSaveError);
  };

  const order = model ? (model.method === 'byHand' && moved ? [...model.effect.plan.order.filter((key) => !moved.includes(key)), ...moved] : model.effect.plan.order) : [];
  // Late debts stay first whatever was moved: they are the ones outside `moved`, and the engine puts them first.
  const rows = model ? payFirstRows(model.debts, order, model.extraMinor, ws.baseCurrency) : [];

  return (
    <div className={SCREEN}>
      <PushedTitle title="Pay first" back="Debt-free plan" backTo="/net-worth/plan" />
      <ErrorBox error={error ?? saveError} />
      {model && (
        <>
          <MethodControl
            model={model}
            saved={saved}
            save={(next) => {
              setMoved(null);
              save(next);
            }}
          />
          <ExtraControls model={model} saved={saved} save={save} baseCurrency={ws.baseCurrency} />
          {rows.length > 0 &&
            (model.method === 'byHand' ? (
              <ByHandList
                rows={rows}
                onOrder={(next) => {
                  setMoved(next);
                  save({ ...saved, method: 'byHand', order: next });
                }}
              />
            ) : (
              <Panel pad={false}>
                <ul>
                  {rows.map((row, index) => (
                    <li key={row.debt.key} data-testid="pay-first-row" data-name={row.debt.name} className="relative">
                      {index > 0 && <Hair />}
                      <PayFirstRowView row={row} />
                    </li>
                  ))}
                </ul>
              </Panel>
            ))}
        </>
      )}
    </div>
  );
}
