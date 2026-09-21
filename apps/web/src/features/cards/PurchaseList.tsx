import { explainTransaction, formatMinor, monthOf, type Suggestion } from '@expanses/core';
import { clearTransactionPointActual, recordTransactionPointActual, saveMerchantMcc, setProgramCrediting, setProgramExpiry, setTransactionMcc } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { cx } from '../../ui';
import { InsetGroup, SegmentedControl, SelectRow, TextRow } from '../../ui/native';
import { Capsule, Line, SUBTITLE, TITLE } from './rows';
import { suggestPattern } from '../merchants/mcc-search';
import { WorkspaceBadge } from '../workspaces/WorkspaceBadge';
import { useWorkspaceBadges } from '../workspaces/queries';
import { checkedTotals, describeSuggestion, purchasesOf } from './hint-text';
import { type CardPoints, formatPoints, shortDate } from './useCardPoints';

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;

const SOURCE_LABELS = { typed: 'typed', memory: 'yours', bundled: 'typical', category: 'category guess' } as const;
const sameTenths = (a: number, b: number) => Math.round(a * 10) === Math.round(b * 10);

/**
 * Fixes for an MCC suggestion: remember the merchant for every purchase, set the MCC on this purchase only, or go
 * and change the purchase's category. Capsules inside the hint that proposes them — never dark rectangles.
 */
export function SuggestionFixes({ suggestion, description, occurredOn, run }: { suggestion: Suggestion; description: string; occurredOn?: string; run: Run }) {
  const { database, ws } = useApp();
  if (suggestion.kind !== 'mcc') return null;
  const pattern = suggestPattern(description);
  return (
    <div className="mt-[8px] flex flex-wrap gap-[8px]">
      {pattern && (
        <Capsule onClick={() => void run(() => saveMerchantMcc(database, ws, { pattern, mcc: suggestion.mcc }))}>
          Remember “{pattern}” as {suggestion.mcc}
        </Capsule>
      )}
      <Capsule onClick={() => void run(() => setTransactionMcc(database, ws, suggestion.transactionId, suggestion.mcc))}>This purchase only</Capsule>
      {occurredOn && (
        <Link
          to="/transactions"
          search={{ month: monthOf(occurredOn) }}
          className="ph-focus rounded-full bg-[var(--ph-fill)] px-[10px] py-[4px] text-[13px] leading-[18px] font-medium text-[var(--ph-tint)]"
        >
          Change category
        </Link>
      )}
    </div>
  );
}

/** A hint on a purchase or a statement: a warning panel, the kit's own tone, with its fixes under it. */
export function Hint({ children }: { children: ReactNode }) {
  return <div className="mt-[8px] rounded-[9px] bg-[var(--ph-warn-panel)] px-[10px] py-[8px] text-[13px] leading-[18px] text-[var(--ph-warn-ink)]">{children}</div>;
}

function ActualCell({ programId, transactionId, description, actual, unit, run }: { programId: string; transactionId: string; description: string; actual: number | undefined; unit: string; run: Run }) {
  const { database, ws } = useApp();
  const [value, setValue] = useState(actual === undefined ? '' : String(actual));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = value.trim().replace(',', '.');
    void run(() =>
      text === '' ? clearTransactionPointActual(database, ws, programId, transactionId) : recordTransactionPointActual(database, ws, { programId, transactionId, actualPoints: Number(text) }),
    );
  };
  return (
    <form onSubmit={submit} className="flex shrink-0 items-center gap-[4px]">
      <input
        aria-label={`Actual ${unit} for ${description}`}
        placeholder="Bank"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        inputMode="decimal"
        className="ph-focus tabular h-[32px] w-[64px] rounded-[8px] bg-[var(--ph-fill)] px-[8px] text-right text-[16px] text-[var(--ph-ink)] placeholder:text-[var(--ph-ink-3)] md:text-[14px]"
      />
      <button
        type="submit"
        aria-label={`Save actual for ${description}`}
        className="ph-focus flex h-[44px] shrink-0 items-center px-[6px] text-[15px] font-medium text-[var(--ph-tint)]"
      >
        Save
      </button>
    </form>
  );
}

/** Card purchases in this or the last cycle with estimated points, MCC and source, and per-purchase checking. */
export function PurchaseList({ cp, run, currency }: { cp: CardPoints; run: Run; currency: string }) {
  const { database, ws } = useApp();
  const [lastCycle, setLastCycle] = useState(false);
  const result = lastCycle ? cp.previous : cp.current;
  const program = cp.program;
  // Explaining a purchase recomputes the cycle, so do it once per saved result rather than on every render.
  const hintsById = useMemo(() => {
    const hints = new Map<string, Suggestion[]>();
    if (!result || cp.crediting !== 'per_transaction') return hints;
    for (const actual of cp.transactionActuals) {
      if (!result.lines.some((line) => line.transactionId === actual.transactionId)) continue;
      if (sameTenths(actual.actualPoints, result.earn.pointsByTransaction[actual.transactionId] ?? 0)) continue;
      hints.set(actual.transactionId, explainTransaction(result.context, actual.transactionId, actual.actualPoints));
    }
    return hints;
  }, [result, cp.crediting, cp.transactionActuals]);
  // Worked out before the early return, since the badges are asked for with a hook and hooks cannot be skipped.
  const purchases = result ? purchasesOf(result.lines) : [];
  // A card is yours, so its cycle holds every workspace's purchases; each says which it was filed in.
  const badgeOf = useWorkspaceBadges(purchases.map((purchase) => purchase.transactionId)).of;
  if (!result || !program) return null;
  const unit = program.unit;
  const perPurchase = cp.crediting === 'per_transaction';
  const actuals = new Map(cp.transactionActuals.map((actual) => [actual.transactionId, actual]));
  const approximate = new Set(result.earn.approximateTransactionIds);
  const totals = checkedTotals(result, cp.transactionActuals);

  /**
   * One purchase: a row whose figure is the estimate, and — where the bank credits per purchase — the field for what
   * it really gave and that field's Save, beside it. Two controls, so it is drawn from the kit's parts.
   */
  const purchaseRow = (purchase: (typeof purchases)[number]) => {
    const estimate = result.earn.pointsByTransaction[purchase.transactionId] ?? 0;
    const actual = actuals.get(purchase.transactionId);
    const differs = perPurchase && actual !== undefined && !sameTenths(actual.actualPoints, estimate);
    const hints = differs ? (hintsById.get(purchase.transactionId) ?? []) : [];
    return (
      <Line key={purchase.transactionId} testId="purchase">
        <div className="flex items-center gap-[10px]">
          <div className="min-w-0 flex-1">
            <div className={cx('truncate', TITLE)}>
              {purchase.description}
              <WorkspaceBadge book={badgeOf(purchase.transactionId)} />
            </div>
            <div className={cx('mt-[2px] truncate', SUBTITLE)}>
              {shortDate(purchase.occurredOn)} · {formatMinor(purchase.amountMinor, currency)} ·{' '}
              <span className={cx(purchase.mccSource === 'category' || purchase.mccSource === null ? '' : 'font-medium text-[var(--ph-tint)]')}>
                {purchase.cardFee ? 'Card fee · never earns' : purchase.mcc && purchase.mccSource ? `MCC ${purchase.mcc} · ${SOURCE_LABELS[purchase.mccSource]}` : 'No MCC'}
              </span>
            </div>
          </div>
          <div className="tabular shrink-0 text-right text-[15px] leading-[20px] text-[var(--ph-ink-2)]" data-testid={`estimate-${purchase.transactionId}`}>
            {approximate.has(purchase.transactionId) ? '≈ ' : ''}
            {formatPoints(estimate)} {unit}
          </div>
          {perPurchase && (
            <ActualCell
              key={`${purchase.transactionId}:${actual?.actualPoints ?? ''}`}
              programId={program.id}
              transactionId={purchase.transactionId}
              description={purchase.description}
              actual={actual?.actualPoints}
              unit={unit}
              run={run}
            />
          )}
        </div>
        {perPurchase && actual && (
          <div className="mt-[4px] text-[12.5px] leading-[16px]">
            {actual.editedAfterCheck ? (
              <span className="text-[var(--ph-warn)]">Edited after checking. Check it again.</span>
            ) : differs ? (
              <span className="text-[var(--ph-warn)]">
                Bank credited {formatPoints(actual.actualPoints)} {unit}, estimate {formatPoints(estimate)}.
              </span>
            ) : (
              <span className="text-[var(--ph-tint)]">Matches the bank</span>
            )}
          </div>
        )}
        {hints.map((hint, i) => (
          <Hint key={i}>
            <p>{describeSuggestion(hint, unit, currency, { [purchase.transactionId]: purchase.description })}</p>
            <SuggestionFixes suggestion={hint} description={purchase.description} occurredOn={purchase.occurredOn} run={run} />
          </Hint>
        ))}
        {differs && hints.length === 0 && <p className={cx('mt-[4px]', SUBTITLE)}>No MCC in this card's rules explains the difference. Check the purchase's category or the card's rules.</p>}
      </Line>
    );
  };

  return (
    <>
      {/* How this card's points behave: settings, so form rows, in a group of their own above the purchases. */}
      <InsetGroup header="How this card's points work">
        <SelectRow
          label="Points expire"
          value={program.expiryPolicy}
          onChange={(e) => {
            const policy = e.target.value as 'none' | 'months_from_earn' | 'fixed_annual';
            void run(() => setProgramExpiry(database, ws, program.id, policy, policy === 'months_from_earn' ? (program.expiryMonths ?? 24) : null));
          }}
        >
          <option value="none">Never</option>
          <option value="months_from_earn">After a number of months</option>
          <option value="fixed_annual">At the end of the year earned</option>
        </SelectRow>
        {program.expiryPolicy === 'months_from_earn' && (
          <TextRow
            label="Months they last"
            defaultValue={String(program.expiryMonths ?? 24)}
            inputMode="numeric"
            onBlur={(e) => {
              const months = Number(e.target.value.trim());
              if (Number.isInteger(months) && months > 0 && months !== program.expiryMonths) {
                void run(() => setProgramExpiry(database, ws, program.id, 'months_from_earn', months));
              }
            }}
          />
        )}
        <SelectRow label="Bank credits points" value={cp.crediting} onChange={(e) => void run(() => setProgramCrediting(database, ws, program.id, e.target.value as 'per_transaction' | 'per_statement'))}>
          <option value="per_statement">Per statement</option>
          <option value="per_transaction">Per purchase</option>
        </SelectRow>
      </InsetGroup>

      <SegmentedControl
        segments={[
          { key: 'this', label: 'This cycle' },
          { key: 'last', label: 'Last cycle' },
        ]}
        value={lastCycle ? 'last' : 'this'}
        onChange={(key) => setLastCycle(key === 'last')}
        label="Which cycle's purchases"
        className="mb-[12px]"
      />
      <InsetGroup
        header={`Purchases ${lastCycle ? 'last' : 'this'} cycle: ${shortDate(result.cycle.start)} – ${shortDate(result.cycle.end)}`}
        footer={perPurchase ? `Checked ${totals.checked} of ${totals.purchases} · running total ${formatPoints(totals.total)} ${unit}` : undefined}
      >
        {purchases.length === 0 ? <Line>{<span className="text-[15px] text-[var(--ph-ink-3)]">No card purchases in this cycle.</span>}</Line> : purchases.map(purchaseRow)}
      </InsetGroup>
    </>
  );
}
