import { groupTypedAmount, type PayoffMethod } from '@expanses/core';
import type { DebtPlanSettings } from '@expanses/db';
import { useState } from 'react';
import { Money } from '../../ui';
import { InsetGroup, InsetRow, SegmentedControl, TextRow } from '../../ui/native';
import { monthYearLabel } from '../loans/loan-view';
import { extraFromTyped, typedFromExtra } from './extra-field';
import { longMonth, rollsWords, suggestionWords } from './plan-view';
import type { DebtPlanModel } from './queries';

/**
 * The plan's controls, shared by Pay first on a phone and the wide Plan's left column: the order (Snowball, Avalanche,
 * By hand) with its lines and the suggestion, and Extra a month with the debt-free month and the interest it saves.
 */

export const METHODS = [
  { key: 'snowball', label: 'Snowball' },
  { key: 'avalanche', label: 'Avalanche' },
  { key: 'byHand', label: 'By hand' },
] as const;

export const LINES: { method: PayoffMethod; name: string; text: string }[] = [
  { method: 'avalanche', name: 'Avalanche', text: 'highest interest first. Costs the least in total.' },
  { method: 'snowball', name: 'Snowball', text: 'smallest first, so debts close sooner and the list gets shorter.' },
  { method: 'byHand', name: 'By hand', text: 'the order set below.' },
];

/** What is saved now, whole, so a save of one part keeps the rest as it is. */
export function settingsOf(saved: DebtPlanSettings | null | undefined): DebtPlanSettings {
  return { method: saved?.method ?? null, order: saved?.order ?? [], extraMinor: saved?.extraMinor ?? 0, extraCurrency: saved?.extraCurrency ?? null };
}

/** The debts in line now, late ones left out: what By hand starts from when nothing was moved yet. */
export const handOrderOf = (model: DebtPlanModel) => model.effect.plan.order.filter((key) => !model.debts.find((d) => d.key === key)?.late);

/** The settings with another order chosen: By hand, chosen first, starts from the order the debts are in now. */
export const withMethod = (model: DebtPlanModel, saved: DebtPlanSettings, method: PayoffMethod): DebtPlanSettings => ({
  ...saved,
  method,
  order: method === 'byHand' && saved.order.length === 0 ? handOrderOf(model) : saved.order,
});

export function MethodControl({ model, saved, save, width }: { model: DebtPlanModel; saved: DebtPlanSettings; save: (next: DebtPlanSettings) => void; width?: number }) {
  const suggestion = suggestionWords(model.suggestion, model.debts);
  return (
    <>
      <SegmentedControl
        label="Order"
        width={width}
        segments={METHODS}
        value={model.method}
        onChange={(key) => save(withMethod(model, saved, key as PayoffMethod))}
      />
      <div className="mt-[10px] mb-[12px] px-[4px] text-[13px] leading-[18px]" data-testid="plan-method-lines">
        {LINES.map((line) => (
          <p key={line.method} className={line.method === model.method ? 'text-[var(--ph-ink)]' : 'text-[var(--ph-ink-3)]'}>
            <span className={line.method === model.method ? 'font-bold' : 'font-semibold'}>{line.name}:</span> {line.text}
          </p>
        ))}
      </div>
      {suggestion && (
        <p data-testid="plan-suggestion" className="mb-[18px] rounded-[12px] bg-[var(--ph-info-panel)] px-[14px] py-[10px] text-[13px] leading-[18px] text-[var(--ph-info-ink)]">
          {suggestion}
        </p>
      )}
    </>
  );
}

/**
 * Extra a month as typed: the field shows what was saved until typed in, and a commit (Return, or leaving the field)
 * saves the figure in the base currency — refused, with words, when it is not a number. Shared by the phone's Pay first
 * and the Mac plan's Pay first box, so both save the same way.
 */
export function useExtraField(model: DebtPlanModel, saved: DebtPlanSettings, save: (next: DebtPlanSettings) => void, baseCurrency: string) {
  // Untouched, the field shows what was saved; once typed in, what was typed.
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = typed ?? typedFromExtra(saved.extraCurrency && saved.extraCurrency !== baseCurrency ? model.extraMinor : saved.extraMinor, baseCurrency);

  const commit = () => {
    if (typed === null) return;
    try {
      const minor = extraFromTyped(typed, baseCurrency);
      setError(null);
      if (minor === saved.extraMinor && (saved.extraCurrency ?? baseCurrency) === baseCurrency) return;
      save({ ...saved, extraMinor: minor, extraCurrency: baseCurrency });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The amount must be a number');
    }
  };

  return { shown, type: (text: string) => setTyped(groupTypedAmount(text, baseCurrency)), commit, error, reset: () => setTyped(null) };
}

export function ExtraControls({ model, saved, save, baseCurrency }: { model: DebtPlanModel; saved: DebtPlanSettings; save: (next: DebtPlanSettings) => void; baseCurrency: string }) {
  const { shown, type, commit, error } = useExtraField(model, saved, save, baseCurrency);

  const { plan, baseline, interestSavedMinor } = model.effect;
  const differs = plan.debtFreeMonth !== null && baseline.debtFreeMonth !== null && plan.debtFreeMonth !== baseline.debtFreeMonth;
  const rolls = rollsWords(plan.order, model.debts);
  return (
    <InsetGroup>
      <TextRow
        label="Extra a month"
        prefix={baseCurrency}
        placeholder="Amount"
        inputMode="decimal"
        value={shown}
        onChange={(event) => type(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
        }}
        hint={error ? <span className="text-[var(--ph-alarm)]">{error}</span> : model.extraMissing ? `No ${model.extraMissing} rate yet, so the extra is left out` : (rolls ?? undefined)}
      />
      <InsetRow
        title="Debt-free"
        testId="plan-extra-debt-free"
        value={
          <span>
            <span className="font-semibold text-[var(--ph-ink)]">{plan.debtFreeMonth ? longMonth(plan.debtFreeMonth) : 'Unknown'}</span>
            {differs && <span className="ml-[6px] text-[13px] text-[var(--ph-ink-3)]">not {monthYearLabel(baseline.debtFreeMonth!)}</span>}
          </span>
        }
      />
      {model.extraMinor > 0 && interestSavedMinor !== null && interestSavedMinor > 0 && (
        <InsetRow title="Interest saved" testId="plan-interest-saved" value={<Money minor={interestSavedMinor} currency={baseCurrency} className="font-semibold text-[var(--ph-up)]" />} />
      )}
    </InsetGroup>
  );
}
