import { formatUnits, groupTypedAmount, ordinal, parseGroupedMajor, parseUnits } from '@expanses/core';
import { deleteTradeTemplate, saveTradeTemplate, type TradeTemplateRow } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { MONEY_SUBTYPES } from '../../lib/account-types';
import { moneyHolders, useAccounts, useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { DestructiveRow, InsetGroup, InsetRow, ReadOnlyRow, SelectRow, SwitchRow, TextRow } from '../../ui/native';
import { useGoals } from '../goals/queries';
import { planFigure } from './monthly-plans';
import { typedAmount } from './trade-form';

/** A day every month has. */
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

type Holding = { accountId: string; name: string; currency: string };

/**
 * A holding's monthly plan, set from the holding's own page: the money, the day, the account it is paid from and the
 * goal it is for. Nothing is bought by it — on the day the Recurring page shows it as due, with Record beside it.
 *
 * A holding with one plan, or none, opens straight on the form. One with several (Buy & sell used to allow as many as
 * were added) opens on their list, each opening its own form, with Add a plan under them.
 */
export function PlanSheet({
  holding,
  plans,
  defaultCashId = null,
  title = 'Monthly plan',
  onClose,
}: {
  holding: Holding;
  /** This holding's plans, oldest first. */
  plans: readonly TradeTemplateRow[];
  /** Where a new plan is paid from unless changed: the broker's cash the holding is kept with, when there is one. */
  defaultCashId?: string | null;
  title?: string;
  onClose: () => void;
}) {
  const accounts = useAccounts();
  const [open, setOpen] = useState<TradeTemplateRow | 'new' | null>(plans.length === 0 ? 'new' : plans.length === 1 ? plans[0]! : null);
  const cashName = (id: string) => (accounts.data ?? []).find((account) => account.id === id)?.name ?? 'an account';

  if (open !== null) {
    return (
      <PlanForm
        key={open === 'new' ? 'new' : open.id}
        holding={holding}
        plan={open === 'new' ? null : open}
        defaultCashId={defaultCashId}
        title={title}
        back={plans.length > 1 || (open === 'new' && plans.length > 0) ? () => setOpen(null) : undefined}
        onClose={onClose}
      />
    );
  }

  return (
    <Sheet grouped title="Monthly plans" onClose={onClose}>
      <InsetGroup>
        {plans.map((plan) => (
          <InsetRow
            key={plan.id}
            title={planFigure(plan, holding.currency)}
            subtitle={`${plan.active ? 'On' : 'Paused · on'} the ${ordinal(plan.dayOfMonth)} · from ${cashName(plan.cashAccountId)}`}
            onClick={() => setOpen(plan)}
          />
        ))}
        <InsetRow title="Add a plan" label="Add a plan" action onClick={() => setOpen('new')} />
      </InsetGroup>
    </Sheet>
  );
}

function PlanForm({
  holding,
  plan,
  defaultCashId,
  title,
  back,
  onClose,
}: {
  holding: Holding;
  plan: TradeTemplateRow | null;
  defaultCashId: string | null;
  title: string;
  back?: () => void;
  onClose: () => void;
}) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const accounts = useAccounts();
  const goals = useGoals();
  // The cash side, as the Buy sheet offers it: a buy is paid from money, a broker's cash included.
  const cashAccounts = moneyHolders(accounts.data ?? []).filter((account) => MONEY_SUBTYPES.includes(account.subtype));
  // An older plan kept by units goes on in units; every plan made now is an amount of money.
  const byUnits = plan !== null && plan.amountMinor === null;
  const [amount, setAmount] = useState(plan === null ? '' : byUnits ? formatUnits(plan.unitsMicro ?? 0) : typedAmount(plan.amountMinor!, holding.currency));
  const [day, setDay] = useState(String(plan?.dayOfMonth ?? 1));
  const [cashAccountId, setCashAccountId] = useState(
    plan?.cashAccountId ?? (defaultCashId && cashAccounts.some((account) => account.id === defaultCashId) ? defaultCashId : (cashAccounts[0]?.id ?? '')),
  );
  const [goalId, setGoalId] = useState(plan?.goalId ?? '');
  const [paused, setPaused] = useState(plan !== null && !plan.active);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await saveTradeTemplate(database, ws, {
        ...(plan ? { id: plan.id } : {}),
        accountId: holding.accountId,
        cashAccountId,
        amountMinor: byUnits ? null : parseGroupedMajor(amount, holding.currency),
        unitsMicro: byUnits ? parseUnits(amount) : null,
        dayOfMonth: Number(day),
        active: !paused,
        goalId: goalId || null,
        kind: plan?.kind ?? 'buy',
      });
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!plan || !window.confirm('Remove this monthly plan? Buys already recorded from it stay.')) return;
    setError(null);
    try {
      await deleteTradeTemplate(database, ws, plan.id);
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Sheet
      grouped
      title={title}
      onClose={onClose}
      back={back ? { label: 'Monthly plans', run: back } : undefined}
      confirm={{ label: 'Save plan', disabled: busy || amount.trim() === '' || cashAccountId === '', run: () => void save() }}
    >
      <InsetGroup footer="Nothing is bought automatically: on the day, Recurring shows it as due, with the amount filled in.">
        {/* Fixed: the plan is set from the holding it buys, or the account a move goes into. */}
        <ReadOnlyRow label={plan?.kind === 'move' ? 'Moves into' : 'Buys'} value={holding.name} />
        <TextRow
          label={byUnits ? 'Units' : 'Amount'}
          prefix={byUnits ? undefined : holding.currency}
          value={amount}
          onChange={(e) => setAmount(byUnits ? e.target.value : groupTypedAmount(e.target.value, holding.currency))}
          inputMode="decimal"
          placeholder={byUnits ? 'Units' : 'Amount'}
        />
        <SelectRow label="Every month on" value={day} onChange={(e) => setDay(e.target.value)}>
          {DAYS.map((n) => (
            <option key={n} value={n}>
              {ordinal(n)}
            </option>
          ))}
        </SelectRow>
        <SelectRow label="Paid from" value={cashAccountId} onChange={(e) => setCashAccountId(e.target.value)}>
          <option value="">Choose an account</option>
          {cashAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectRow>
        {(goals.data?.length ?? 0) > 0 && (
          <SelectRow label="For goal" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">No goal</option>
            {(goals.data ?? []).map((goal) => (
              <option key={goal.id} value={goal.id}>
                {goal.name}
              </option>
            ))}
          </SelectRow>
        )}
        {plan && <SwitchRow label="Paused" checked={paused} onChange={setPaused} />}
      </InsetGroup>
      <ErrorBox error={error} />
      {plan && (
        <InsetGroup>
          <DestructiveRow label="Remove plan" onClick={() => void remove()} />
        </InsetGroup>
      )}
    </Sheet>
  );
}
