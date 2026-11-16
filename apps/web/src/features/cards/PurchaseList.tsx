import { explainTransaction, formatMinor, periodMonthOf, type Suggestion } from '@expanses/core';
import { useMonthStart } from '../workspaces/queries';
import { clearTransactionPointActual, recordTransactionPointActual, saveMerchantMcc, setTransactionMcc } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { cx } from '../../ui';
import { Sheet } from '../../app/Sheet';
import { useAccounts, useCategoryColours } from '../../lib/queries';
import { InsetGroup, InsetRow, SegmentedControl } from '../../ui/native';
import { categoryMark } from '../categories/CategoryIcon';
import { Capsule, Line, SUBTITLE } from './rows';
import { suggestPattern } from '../merchants/mcc-search';
import { WorkspaceBadge } from '../workspaces/WorkspaceBadge';
import { useWorkspaceBadges } from '../workspaces/queries';
import { checkedTotals, describeSuggestion, earnedNothing, purchasesOf } from './hint-text';
import { type CardPoints, formatPoints, shortDate } from './useCardPoints';

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;

const SOURCE_LABELS = { typed: 'typed', memory: 'remembered', bundled: 'typical', category: 'category guess' } as const;
const sameTenths = (a: number, b: number) => Math.round(a * 10) === Math.round(b * 10);

/**
 * Fixes for an MCC suggestion: remember the merchant for every purchase, set the MCC on this purchase only, or go
 * and change the purchase's category. Capsules inside the hint that proposes them — never dark rectangles.
 */
export function SuggestionFixes({ suggestion, description, occurredOn, run }: { suggestion: Suggestion; description: string; occurredOn?: string; run: Run }) {
  const { database, ws } = useApp();
  // Cashflow's month that holds the purchase ("Month starts on").
  const monthStart = useMonthStart();
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
          search={{ month: periodMonthOf(occurredOn, monthStart) }}
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
export function PurchaseList({ cp, run, currency, onlyNothing = false, onShowAll }: { cp: CardPoints; run: Run; currency: string; onlyNothing?: boolean; onShowAll?: () => void }) {
  const [lastCycle, setLastCycle] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const accounts = useAccounts().data ?? [];
  const chosen = useCategoryColours().data;
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
  const all = result ? purchasesOf(result.lines) : [];
  const purchases = result && onlyNothing ? earnedNothing(all, result.earn.pointsByTransaction) : all;
  // A card is yours, so its cycle holds every workspace's purchases; each says which it was filed in.
  const badgeOf = useWorkspaceBadges(purchases.map((purchase) => purchase.transactionId)).mark;
  if (!result || !program) return null;
  const unit = program.unit;
  const perPurchase = cp.crediting === 'per_transaction';
  const actuals = new Map(cp.transactionActuals.map((actual) => [actual.transactionId, actual]));
  const approximate = new Set(result.earn.approximateTransactionIds);
  const totals = checkedTotals(result, cp.transactionActuals);

  /**
   * What a purchase shows under its amount: the points the bank credited once recorded, else the estimate. A ✓ marks a
   * figure the bank confirmed, a ! one that differs from the estimate or was edited after checking.
   */
  const pointsLine = (purchase: (typeof purchases)[number]) => {
    const estimate = result.earn.pointsByTransaction[purchase.transactionId] ?? 0;
    const actual = actuals.get(purchase.transactionId);
    const differs = perPurchase && actual !== undefined && !sameTenths(actual.actualPoints, estimate);
    const shown = actual ? actual.actualPoints : estimate;
    const text = purchase.cardFee
      ? 'Never earns'
      : shown === 0
        ? 'No points'
        : `${approximate.has(purchase.transactionId) && !actual ? '≈ ' : ''}${shown < 0 ? '−' : '+'}${formatPoints(Math.abs(shown))} ${unit}`;
    const checked = perPurchase && actual !== undefined;
    const warn = checked && (differs || actual.editedAfterCheck);
    return (
      <span className={cx(warn ? 'text-[var(--ph-warn)]' : checked ? 'text-[var(--ph-tint)]' : 'text-[var(--ph-ink-3)]')} data-testid={`estimate-${purchase.transactionId}`}>
        {checked ? (warn ? '! ' : '✓ ') : ''}
        {text}
      </span>
    );
  };

  const purchaseRow = (purchase: (typeof purchases)[number]) => {
    const mark = categoryMark(purchase.categoryId, accounts, chosen);
    return (
      <InsetRow
        key={purchase.transactionId}
        testId="purchase"
        icon={<mark.Glyph size={16} strokeWidth={2.2} />}
        iconColour={mark.colour}
        title={
          <>
            {mark.name || purchase.description || 'Purchase'}
            <WorkspaceBadge book={badgeOf(purchase.transactionId)} />
          </>
        }
        subtitle={[purchase.description, shortDate(purchase.occurredOn)].filter(Boolean).join(' · ')}
        value={
          <span className="flex flex-col items-end">
            <span>{formatMinor(purchase.amountMinor, currency)}</span>
            <span className="text-[12.5px] leading-[16px] font-normal">{pointsLine(purchase)}</span>
          </span>
        }
        valueTone="ink"
        chevron={false}
        onClick={() => setOpenId(purchase.transactionId)}
      />
    );
  };

  /** The sheet a tap on a purchase opens: its category, MCC and estimate, and where the bank credits per purchase, the bank's own figure. */
  const sheet = () => {
    const purchase = all.find((row) => row.transactionId === openId);
    if (!purchase) return null;
    const estimate = result.earn.pointsByTransaction[purchase.transactionId] ?? 0;
    const actual = actuals.get(purchase.transactionId);
    const differs = perPurchase && actual !== undefined && !sameTenths(actual.actualPoints, estimate);
    const hints = differs ? (hintsById.get(purchase.transactionId) ?? []) : [];
    const mark = categoryMark(purchase.categoryId, accounts, chosen);
    const mccText = purchase.cardFee ? 'Card fee · never earns' : purchase.mcc && purchase.mccSource ? `${purchase.mcc} · ${SOURCE_LABELS[purchase.mccSource]}` : 'No MCC';
    return (
      <Sheet title={purchase.description || mark.name || 'Purchase'} onClose={() => setOpenId(null)} grouped>
        <InsetGroup>
          {[
            <InsetRow key="category" title="Category" value={mark.name ?? 'None'} valueTone="ink" chevron={false} plain />,
            <InsetRow key="amount" title="Amount" value={formatMinor(purchase.amountMinor, currency)} valueTone="ink" chevron={false} plain />,
            <InsetRow key="mcc" testId="purchase-mcc" title="MCC" value={mccText} valueTone="ink" chevron={false} plain />,
            <InsetRow
              key="estimate"
              title="Estimated"
              value={`${approximate.has(purchase.transactionId) ? '≈ ' : ''}${estimate < 0 ? '−' : ''}${formatPoints(Math.abs(estimate))} ${unit}`}
              valueTone="ink"
              chevron={false}
              plain
            />,
            ...(perPurchase
              ? [
                  <Line key="credited" testId="purchase-check">
                    <div className="flex items-center gap-[10px]">
                      <span className="min-w-0 flex-1 text-[17px] leading-[22px] text-[var(--ph-ink)]">Bank credited</span>
                      <ActualCell
                        key={`${purchase.transactionId}:${actual?.actualPoints ?? ''}`}
                        programId={program.id}
                        transactionId={purchase.transactionId}
                        description={purchase.description}
                        actual={actual?.actualPoints}
                        unit={unit}
                        run={run}
                      />
                    </div>
                    {actual && (
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
                    {differs && hints.length === 0 && <p className={cx('mt-[4px]', SUBTITLE)}>Saved. The bank's figure differs from the estimate. No rule explains the gap. Check the purchase's category or MCC.</p>}
                  </Line>,
                ]
              : []),
          ]}
        </InsetGroup>
      </Sheet>
    );
  };

  return (
    <>
      {onlyNothing && onShowAll && (
        <div className="mb-[12px] flex items-center gap-[10px] px-[4px]" data-testid="purchases-filter">
          <p className="min-w-0 flex-1 text-[13px] leading-[18px] text-[var(--ph-ink-2)]">Showing purchases that earned nothing</p>
          <Capsule onClick={onShowAll}>✕ Show all</Capsule>
        </div>
      )}
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
        {purchases.length === 0 ? <Line>{<span className="text-[15px] text-[var(--ph-ink-3)]">{onlyNothing ? 'No purchases earned nothing in this cycle.' : 'No card purchases in this cycle.'}</span>}</Line> : purchases.map(purchaseRow)}
      </InsetGroup>
      {sheet()}
    </>
  );
}
