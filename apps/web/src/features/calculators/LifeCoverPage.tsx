import { groupedMajorString, groupTypedAmount, isoDate } from '@expanses/core';
import { getLifeCoverDraft, saveLifeCoverDraft } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useApp } from '../../app/context';
import { useGoalPlans } from '../goals/queries';
import { ratioTotals } from '../networth/health-cards';
import { useSheet } from '../networth/queries';
import { InsetGroup, InsetRow, Panel, TextRow } from '../../ui/native';
import { LIFE_COVER } from './catalogue';
import { LIFE_COVER_DEFAULTS, type LifeCoverDraft, type LifeCoverPrefill, lifeCoverPrefill, lifeCoverWorking } from './life-cover-form';
import { refusal, Figure, CalculatorPage, Waiting } from './parts';

const MONEY_BOXES = ['annualNeed', 'debts', 'education', 'finalExpenses', 'liquidAssets', 'inForce'] as const;

/** Figures kept before the boxes grouped as they were typed are plain digits; they open grouped like the rest. */
function groupedMoneyBoxes(draft: LifeCoverDraft, currency: string): LifeCoverDraft {
  const next = { ...draft };
  for (const key of MONEY_BOXES) {
    const kept = next[key];
    if (kept !== undefined && /^\d+$/.test(kept)) next[key] = groupTypedAmount(kept, currency);
  }
  return next;
}

/**
 * What your family would need, minus what is already there.
 *
 * The form waits for the figures kept last, so it opens on them rather than on the defaults and then jumps. The
 * prefills follow the balance sheet and the education goals while they load and change.
 */
export function LifeCoverPage() {
  const { database, ws } = useApp();
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const sheetInputs = useSheet();
  const goalPlans = useGoalPlans(isoDate());
  const remembered = useQuery({ queryKey: ['life-cover', ws.workspaceId], queryFn: () => getLifeCoverDraft(database, ws) });
  // The net-worth page's own reader: no totals, and the currencies named, while a row on the sheet has no rate.
  const { totals, missing } = ratioTotals(sheetInputs.data);
  const prefill = lifeCoverPrefill(totals, goalPlans.data?.plans ?? [], missing, ws.baseCurrency);
  return (
    <CalculatorPage entry={LIFE_COVER} error={error} saved={saved}>
      {remembered.isSuccess && (
        <LifeCoverForm
          key={ws.workspaceId}
          initial={remembered.data ? groupedMoneyBoxes({ ...LIFE_COVER_DEFAULTS, ...remembered.data }, ws.baseCurrency) : LIFE_COVER_DEFAULTS}
          prefill={prefill}
          keep={async (draft) => {
            try {
              await saveLifeCoverDraft(database, ws, draft);
              setSaved('Kept the life cover figures.');
            } catch (e) {
              setError(e);
            }
          }}
        />
      )}
    </CalculatorPage>
  );
}

function LifeCoverForm({ initial, prefill, keep }: { initial: LifeCoverDraft; prefill: LifeCoverPrefill; keep: (draft: LifeCoverDraft) => Promise<void> }) {
  const { ws } = useApp();
  const [cover, setCover] = useState<LifeCoverDraft>(initial);
  const working = lifeCoverWorking(cover, prefill, ws.baseCurrency);
  const result = working.result;
  const hint = (key: keyof LifeCoverDraft, otherwise?: ReactNode) => refusal(working.problems[key], otherwise);
  // A box never typed in shows its prefill; one with no figure to show (no rate yet) stays empty and says why.
  const shown = (typed: string | undefined, prefilled: number | null) => typed ?? (prefilled === null ? '' : groupedMajorString(prefilled, ws.baseCurrency));
  const moneyBox = (key: keyof LifeCoverDraft) => (event: { target: { value: string } }) =>
    setCover((draft) => ({ ...draft, [key]: groupTypedAmount(event.target.value, ws.baseCurrency) }));
  const box = (key: keyof LifeCoverDraft) => (event: { target: { value: string } }) => setCover((draft) => ({ ...draft, [key]: event.target.value }));
  return (
    <>
      <InsetGroup footer="Capital needs analysis: what the family would need, minus what is already there. CFP Board lists it first among the methods; the Insurance Information Institute recommends it and rejects income multiples for assuming no inflation. No figure here is rounded, and no lowest-of-several is taken.">
        <TextRow
          label="Yearly amount the family needs"
          prefix={ws.baseCurrency}
          hint={hint('annualNeed', "At today's prices.")}
          value={cover.annualNeed}
          onChange={moneyBox('annualNeed')}
          inputMode="decimal"
          placeholder="Amount"
        />
        <TextRow label="Years of support" hint={hint('years')} value={cover.years} onChange={box('years')} inputMode="numeric" />
        <TextRow label="Inflation during support (%)" hint={hint('inflation')} value={cover.inflation} onChange={box('inflation')} inputMode="decimal" />
        <TextRow
          label="Return on the payout (%)"
          hint={hint('returnPercent', 'The money is spent down, so a cautious figure.')}
          value={cover.returnPercent}
          onChange={box('returnPercent')}
          inputMode="decimal"
        />
        <TextRow
          label="Debts to clear"
          prefix={ws.baseCurrency}
          hint={hint('debts', 'From the balance sheet.')}
          value={shown(cover.debts, prefill.debtsMinor)}
          onChange={moneyBox('debts')}
          inputMode="decimal"
          placeholder="Amount"
        />
        <TextRow
          label="Education still to fund"
          prefix={ws.baseCurrency}
          hint={hint('education', "From the education goals, at today's prices.")}
          value={shown(cover.education, prefill.educationMinor)}
          onChange={moneyBox('education')}
          inputMode="decimal"
          placeholder="Amount"
        />
        <TextRow
          label="Final expenses"
          prefix={ws.baseCurrency}
          hint={hint('finalExpenses')}
          value={cover.finalExpenses}
          onChange={moneyBox('finalExpenses')}
          inputMode="decimal"
          placeholder="Amount"
        />
        <TextRow
          label="Liquid assets"
          prefix={ws.baseCurrency}
          hint={hint('liquidAssets', 'From the balance sheet.')}
          value={shown(cover.liquidAssets, prefill.liquidAssetsMinor)}
          onChange={moneyBox('liquidAssets')}
          inputMode="decimal"
          placeholder="Amount"
        />
        <TextRow
          label="Cover already in force"
          prefix={ws.baseCurrency}
          hint={hint('inForce', 'Policies held, employer group cover included.')}
          value={cover.inForce}
          onChange={moneyBox('inForce')}
          inputMode="decimal"
          placeholder="Amount"
        />
      </InsetGroup>
      {result ? (
        <Panel wide testId="answer-life-cover">
          <div className="grid gap-3 sm:grid-cols-2">
            <Figure caption="Income replacement, today" minor={result.incomeNeedMinor} />
            <Figure caption="Everything needed" minor={result.needsMinor} />
            <Figure caption="Already there" minor={result.resourcesMinor} />
            {result.coverMinor > 0 ? (
              <Figure caption="Cover to hold" minor={result.coverMinor} />
            ) : (
              <Figure caption="No further cover needed · to spare" minor={result.surplusMinor} />
            )}
          </div>
        </Panel>
      ) : (
        <Waiting />
      )}
      <InsetGroup footer="Kept on this device for this workspace. A box not typed in keeps following the balance sheet and goals.">
        <InsetRow title="Keep these figures" action onClick={() => void keep(cover)} />
      </InsetGroup>
    </>
  );
}
