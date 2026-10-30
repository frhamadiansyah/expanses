import { groupedMajorString, groupTypedAmount, isoDate } from '@expanses/core';
import { getLifeCoverDraft, saveLifeCoverDraft } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../../app/context';
import { useGoalPlans } from '../goals/queries';
import { ratioTotals } from '../networth/health-cards';
import { useSheet } from '../networth/queries';
import { Money } from '../../ui';
import { InsetGroup, Panel, TextRow } from '../../ui/native';
import { LIFE_COVER } from './catalogue';
import { LIFE_COVER_DEFAULTS, type LifeCoverDraft, type LifeCoverPrefill, lifeCoverPrefill, lifeCoverWorking } from './life-cover-form';
import { refusal, CalculatorPage } from './parts';
import { SpendBar, useSpendSuggestions } from './SpendBar';

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
 * What the family would need, minus what is already there.
 *
 * The form waits for the figures kept last, so it opens on them rather than on the defaults and then jumps. The
 * prefills follow the balance sheet and the education goals while they load and change.
 */
export function LifeCoverPage() {
  const { database, ws } = useApp();
  const [error, setError] = useState<unknown>(null);
  const sheetInputs = useSheet();
  const goalPlans = useGoalPlans(isoDate());
  const remembered = useQuery({ queryKey: ['life-cover', ws.workspaceId], queryFn: () => getLifeCoverDraft(database, ws) });
  // The net-worth page's own reader: no totals, and the currencies named, while a row on the sheet has no rate.
  const { totals, missing } = ratioTotals(sheetInputs.data);
  const prefill = lifeCoverPrefill(totals, goalPlans.data?.plans ?? [], missing, ws.baseCurrency);
  return (
    <CalculatorPage entry={LIFE_COVER} error={error} quiet>
      {remembered.isSuccess && (
        <LifeCoverForm
          key={ws.workspaceId}
          initial={remembered.data ? groupedMoneyBoxes({ ...LIFE_COVER_DEFAULTS, ...remembered.data }, ws.baseCurrency) : LIFE_COVER_DEFAULTS}
          prefill={prefill}
          keep={async (draft) => {
            try {
              await saveLifeCoverDraft(database, ws, draft);
            } catch (e) {
              setError(e);
            }
          }}
        />
      )}
    </CalculatorPage>
  );
}

/** How long typing pauses before the figures are kept on the device. */
const KEEP_AFTER_MS = 600;

function LifeCoverForm({ initial, prefill, keep }: { initial: LifeCoverDraft; prefill: LifeCoverPrefill; keep: (draft: LifeCoverDraft) => Promise<void> }) {
  const { ws } = useApp();
  const [cover, setCover] = useState<LifeCoverDraft>(initial);
  const [needFocused, setNeedFocused] = useState(false);
  const spend = useSpendSuggestions('retirement');
  const working = lifeCoverWorking(cover, prefill, ws.baseCurrency);
  const result = working.result;
  const hint = (key: keyof LifeCoverDraft) => refusal(working.problems[key]);

  // The figures are kept as they change, once typing pauses, and once more on the way out: no row to tap.
  const latest = useRef(cover);
  const pending = useRef(false);
  const keepRef = useRef(keep);
  keepRef.current = keep;
  useEffect(() => {
    if (cover === initial) return;
    latest.current = cover;
    pending.current = true;
    const timer = setTimeout(() => {
      pending.current = false;
      void keepRef.current(cover);
    }, KEEP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [cover, initial]);
  useEffect(
    () => () => {
      if (pending.current) void keepRef.current(latest.current);
    },
    [],
  );

  // A box never typed in shows its prefill; one with no figure to show (no rate yet) stays empty and says why.
  const shown = (typed: string | undefined, prefilled: number | null) => typed ?? (prefilled === null ? '' : groupedMajorString(prefilled, ws.baseCurrency));
  const moneyBox = (key: keyof LifeCoverDraft) => (event: { target: { value: string } }) =>
    setCover((draft) => ({ ...draft, [key]: groupTypedAmount(event.target.value, ws.baseCurrency) }));
  const box = (key: keyof LifeCoverDraft) => (event: { target: { value: string } }) => setCover((draft) => ({ ...draft, [key]: event.target.value }));
  return (
    <>
      <InsetGroup>
        <TextRow
          label="Yearly amount the family needs"
          wrapLabel
          prefix={ws.baseCurrency}
          hint={hint('annualNeed')}
          value={cover.annualNeed}
          onChange={moneyBox('annualNeed')}
          onFocus={() => setNeedFocused(true)}
          onBlur={() => setNeedFocused(false)}
          inputMode="decimal"
          placeholder="Amount"
        />
        <TextRow label="Years of support" hint={hint('years')} value={cover.years} onChange={box('years')} inputMode="numeric" />
      </InsetGroup>
      <SpendBar open={needFocused} suggestions={spend} onPick={(typed) => setCover((draft) => ({ ...draft, annualNeed: typed }))} />

      <InsetGroup header="The plan">
        <TextRow label="Inflation during support (%)" hint={hint('inflation')} value={cover.inflation} onChange={box('inflation')} inputMode="decimal" />
        <TextRow
          label="Return on the payout (%)"
          info="The money is spent down, so a cautious figure."
          hint={hint('returnPercent')}
          value={cover.returnPercent}
          onChange={box('returnPercent')}
          inputMode="decimal"
        />
      </InsetGroup>

      <InsetGroup header="Already there">
        <TextRow
          label="Debts to clear"
          info="From the balance sheet."
          prefix={ws.baseCurrency}
          hint={hint('debts')}
          value={shown(cover.debts, prefill.debtsMinor)}
          onChange={moneyBox('debts')}
          inputMode="decimal"
          placeholder="Amount"
        />
        <TextRow
          label="Education still to fund"
          info="From the education goals, at today's prices."
          prefix={ws.baseCurrency}
          hint={hint('education')}
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
          info="From the balance sheet."
          prefix={ws.baseCurrency}
          hint={hint('liquidAssets')}
          value={shown(cover.liquidAssets, prefill.liquidAssetsMinor)}
          onChange={moneyBox('liquidAssets')}
          inputMode="decimal"
          placeholder="Amount"
        />
        <TextRow
          label="Cover already in force"
          info="Policies held, employer group cover included."
          prefix={ws.baseCurrency}
          hint={hint('inForce')}
          value={cover.inForce}
          onChange={moneyBox('inForce')}
          inputMode="decimal"
          placeholder="Amount"
        />
      </InsetGroup>
      {result && (
        <Panel wide testId="answer-life-cover">
          <p className="text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{result.coverMinor > 0 ? 'Cover to hold' : 'No further cover needed · to spare'}</p>
          <p className="tabular text-[30px] leading-[36px] font-bold tracking-[-0.02em] text-[var(--ph-ink)]">
            <Money minor={result.coverMinor > 0 ? result.coverMinor : result.surplusMinor} currency={ws.baseCurrency} />
          </p>
          <dl className="mt-[8px] border-t-[0.5px] border-[var(--ph-hair)] pt-[6px] text-[14px] leading-[22px]">
            {[
              ['Income replacement, today', result.incomeNeedMinor],
              ['Everything needed', result.needsMinor],
              ['Already there', result.resourcesMinor],
            ].map(([caption, minor]) => (
              <div key={caption} className="flex justify-between gap-3">
                <dt className="text-[var(--ph-ink-3)]">{caption}</dt>
                <dd className="tabular text-[var(--ph-ink-2)]">
                  <Money minor={minor as number} currency={ws.baseCurrency} />
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
      )}
    </>
  );
}
