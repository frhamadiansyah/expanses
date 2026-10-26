import { formatMinor, groupTypedAmount, isoDate } from '@expanses/core';
import { sellAsset, SPENDABLE_SUBTYPES } from '@expanses/db';
import { Target } from 'lucide-react';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { moneyHolders, useAccounts, useInvalidateAll, useResolveRates } from '../../lib/queries';
import { openingRateFor } from '../../lib/rates';
import { ErrorBox } from '../../ui';
import { InsetGroup, PickerRow, SelectRow, TextRow } from '../../ui/native';
import { ChoiceSheet } from '../transactions/ChoiceSheet';
import { useGoals } from '../goals/queries';
import { AmountRow, FeeRow, FigureRow, ReadRow, RecordRow } from './listed-trade-parts';
import { type SellDraft, sellFigures, signedGain } from './sell-model';

/**
 * Sell, for an asset valued by an estimate (a car, a house, land), from its Settings. The first box: the asset, what it
 * sold for, the day and the account the money went into. A second for the costs (agent commission, notary and tax,
 * taken off what is received), which fold open in place as the listed share's fee does, and a goal when there are goals.
 * Then the totals — sold for, costs, the total received and the gain against the original cost — and one centred row
 * that records, by `sellAsset`. The money account is one holding the asset's own currency, so no rate between two
 * accounts is ever guessed.
 */
export function SellSheet({
  asset,
  acquiredOn,
  onClose,
  onSold,
}: {
  asset: { accountId: string; name: string; currency: string; costMinor: number };
  /** The day it was acquired, as far as known: nothing sells before it. */
  acquiredOn: string | null;
  onClose: () => void;
  onSold: () => void;
}) {
  const { database, ws } = useApp();
  const accounts = useAccounts();
  const goals = useGoals();
  const resolveRates = useResolveRates();
  const invalidate = useInvalidateAll();
  const today = isoDate();
  const [draft, setDraft] = useState<SellDraft>({ soldFor: '', date: today, cashId: '', costs: '', goalId: '' });
  const [rate, setRate] = useState('');
  const [costsOpen, setCostsOpen] = useState(false);
  const [choosingGoal, setChoosingGoal] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<SellDraft>) => setDraft((was) => ({ ...was, ...patch }));

  const { currency } = asset;
  const holders = moneyHolders(accounts.data ?? []).filter(
    (account) => account.kind === 'asset' && SPENDABLE_SUBTYPES.includes(account.subtype) && (account.currency ?? ws.baseCurrency) === currency,
  );
  const figures = sellFigures(draft, { currency, costMinor: asset.costMinor, today, acquiredOn });
  const money = (minor: number) => formatMinor(minor, currency);
  const goalName = (goals.data ?? []).find((goal) => goal.id === draft.goalId)?.name ?? 'None';
  const costsText = figures.costsMinor > 0 ? `${money(figures.costsMinor)} ›` : 'None ›';
  const foreign = currency !== ws.baseCurrency;

  const save = async () => {
    if (!figures.ready || figures.soldForMinor === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const rateToBase = foreign
        ? await openingRateFor({ database, ws, currency, openedOn: draft.date > today ? today : draft.date, openingBalanceMinor: figures.soldForMinor, typed: rate, resolveRates })
        : undefined;
      await sellAsset(database, ws, {
        accountId: asset.accountId,
        soldOn: draft.date,
        soldForMinor: figures.soldForMinor,
        costsMinor: figures.costsMinor,
        cashAccountId: draft.cashId,
        goalId: draft.goalId || null,
        rateToBase,
      });
      await invalidate();
      onSold();
    } catch (e) {
      setError(e);
      setSaving(false);
    }
  };

  const gainTone = figures.gainMinor === null || figures.gainMinor === 0 ? 'text-[var(--ph-ink)]' : figures.gainMinor > 0 ? 'text-[var(--ph-up)]' : 'text-[var(--ph-alarm)]';

  return (
    <Sheet grouped tall closeOnly expanded={costsOpen} title="Sell" onClose={onClose}>
      <InsetGroup>
        <ReadRow label="Asset" value={asset.name} />
        <TextRow
          label="Sold for"
          value={draft.soldFor}
          onChange={(e) => set({ soldFor: groupTypedAmount(e.target.value, currency) })}
          inputMode="numeric"
          placeholder="Amount"
        />
        <TextRow label="Date" type="date" value={draft.date} max={today} min={acquiredOn ?? undefined} onChange={(e) => set({ date: e.target.value })} />
        <SelectRow label="Paid into" value={draft.cashId} onChange={(e) => set({ cashId: e.target.value })}>
          <option value="">Choose</option>
          {holders.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </SelectRow>
        {foreign && (
          <TextRow label="Rate that day" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="Rate" hint={`${ws.baseCurrency} per 1 ${currency}`} />
        )}
      </InsetGroup>

      <InsetGroup>
        <FeeRow
          label="Costs"
          value={costsText}
          open={costsOpen}
          onToggle={() => setCostsOpen((was) => !was)}
          info="Agent commission, notary and tax, taken off what is received"
        />
        {costsOpen ? (
          <AmountRow label="Costs" value={draft.costs} onChange={(e) => set({ costs: groupTypedAmount(e.target.value, currency) })} inputMode="numeric" placeholder="None" />
        ) : null}
        {(goals.data ?? []).length > 0 ? <PickerRow label="Goal" value={goalName} onOpen={() => setChoosingGoal(true)} /> : null}
      </InsetGroup>

      <InsetGroup footer={figures.problem ?? undefined}>
        <FigureRow label="Sold for" testId="sell-sold-for" value={money(figures.soldForMinor ?? 0)} />
        <FigureRow label="Costs" testId="sell-costs" value={money(figures.costsMinor)} />
        <FigureRow label="Total" bold testId="sell-total" value={money(figures.totalMinor ?? 0)} />
        <FigureRow
          label="Gain"
          testId="sell-gain"
          info="Against the original cost, not against the last estimate"
          value={figures.gainMinor === null ? '—' : signedGain(figures.gainMinor, money)}
          valueClass={gainTone}
        />
      </InsetGroup>

      <ErrorBox error={error} />
      <RecordRow label="Record sale" disabled={!figures.ready || saving} onRecord={() => void save()} />

      {choosingGoal && (
        <ChoiceSheet
          title="Goal"
          value={draft.goalId}
          groups={[{ choices: [{ value: '', label: 'None', glyph: <Target size={15} /> }, ...(goals.data ?? []).map((goal) => ({ value: goal.id, label: goal.name, glyph: <Target size={15} /> }))] }]}
          onPick={(goalId) => set({ goalId })}
          onClose={() => setChoosingGoal(false)}
        />
      )}
    </Sheet>
  );
}
