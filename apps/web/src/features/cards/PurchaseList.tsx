import { explainTransaction, formatMinor, type Suggestion } from '@expanses/core';
import { clearTransactionPointActual, recordTransactionPointActual, saveMerchantMcc, setProgramCrediting, setTransactionMcc } from '@expanses/db';
import { type FormEvent, useState } from 'react';
import { useApp } from '../../app/context';
import { Button, Card, cx, Field, Input, Select } from '../../ui';
import { suggestPattern } from '../merchants/mcc-search';
import { checkedTotals, describeSuggestion, purchasesOf } from './hint-text';
import { type CardPoints, formatPoints, shortDate } from './useCardPoints';

type Run = (fn: () => Promise<unknown>) => Promise<boolean>;

const SOURCE_LABELS = { typed: 'typed', memory: 'yours', bundled: 'typical', category: 'category guess' } as const;
const sameTenths = (a: number, b: number) => Math.round(a * 10) === Math.round(b * 10);

/** Fixes for an MCC suggestion: remember the merchant for every purchase, or set the MCC on this purchase only. */
export function SuggestionFixes({ suggestion, description, run }: { suggestion: Suggestion; description: string; run: Run }) {
  const { database, ws } = useApp();
  if (suggestion.kind !== 'mcc') return null;
  const pattern = suggestPattern(description);
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {pattern && (
        <Button variant="secondary" onClick={() => void run(() => saveMerchantMcc(database, ws, { pattern, mcc: suggestion.mcc }))}>
          Remember “{pattern}” as {suggestion.mcc}
        </Button>
      )}
      <Button variant="ghost" onClick={() => void run(() => setTransactionMcc(database, ws, suggestion.transactionId, suggestion.mcc))}>
        This purchase only
      </Button>
    </div>
  );
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
    <form onSubmit={submit} className="flex items-center gap-1">
      <Input aria-label={`Actual ${unit} for ${description}`} value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" className="w-20" />
      <Button type="submit" variant="ghost" aria-label={`Save actual for ${description}`}>
        Save
      </Button>
    </form>
  );
}

/** Card purchases in this or the last cycle with estimated points, MCC and source, and per-purchase checking. */
export function PurchaseList({ cp, run, currency }: { cp: CardPoints; run: Run; currency: string }) {
  const { database, ws } = useApp();
  const [lastCycle, setLastCycle] = useState(false);
  const result = lastCycle ? cp.previous : cp.current;
  const program = cp.program;
  if (!result || !program) return null;
  const unit = program.unit;
  const perPurchase = cp.crediting === 'per_transaction';
  const actuals = new Map(cp.transactionActuals.map((actual) => [actual.transactionId, actual]));
  const approximate = new Set(result.earn.approximateTransactionIds);
  const purchases = purchasesOf(result.lines);
  const totals = checkedTotals(result, cp.transactionActuals);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-600">
            Purchases {lastCycle ? 'last' : 'this'} cycle: {shortDate(result.cycle.start)} – {shortDate(result.cycle.end)}
          </h2>
          {perPurchase && (
            <div className="text-xs text-slate-500">
              Checked {totals.checked} of {totals.purchases} · running total {formatPoints(totals.total)} {unit}
            </div>
          )}
        </div>
        <div className="flex items-end gap-2">
          <Button variant="ghost" onClick={() => setLastCycle(!lastCycle)}>
            {lastCycle ? 'This cycle' : 'Last cycle'}
          </Button>
          <Field label="Bank credits points">
            <Select value={cp.crediting} onChange={(e) => void run(() => setProgramCrediting(database, ws, program.id, e.target.value as 'per_transaction' | 'per_statement'))}>
              <option value="per_statement">Per statement</option>
              <option value="per_transaction">Per purchase</option>
            </Select>
          </Field>
        </div>
      </div>
      {purchases.length === 0 && <p className="text-sm text-slate-500">No card purchases in this cycle.</p>}
      <ul className="divide-y divide-slate-100">
        {purchases.map((purchase) => {
          const estimate = result.earn.pointsByTransaction[purchase.transactionId] ?? 0;
          const actual = actuals.get(purchase.transactionId);
          const differs = perPurchase && actual !== undefined && !sameTenths(actual.actualPoints, estimate);
          const hints = differs ? explainTransaction(result.context, purchase.transactionId, actual.actualPoints) : [];
          return (
            <li key={purchase.transactionId} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{purchase.description}</div>
                  <div className="text-xs text-slate-500">
                    {shortDate(purchase.occurredOn)} · {formatMinor(purchase.amountMinor, currency)} ·{' '}
                    <span className={cx('rounded px-1 py-0.5', purchase.mccSource === 'category' || purchase.mccSource === null ? 'bg-slate-100' : 'bg-emerald-50 text-emerald-800')}>
                      {purchase.cardFee ? 'Card fee · never earns' : purchase.mcc && purchase.mccSource ? `MCC ${purchase.mcc} · ${SOURCE_LABELS[purchase.mccSource]}` : 'No MCC'}
                    </span>
                  </div>
                </div>
                <div className="tabular text-right" data-testid={`estimate-${purchase.transactionId}`}>
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
                <div className="mt-1 text-xs">
                  {actual.editedAfterCheck ? (
                    <span className="text-amber-700">Edited after checking. Check it again.</span>
                  ) : differs ? (
                    <span className="text-amber-700">
                      Bank credited {formatPoints(actual.actualPoints)} {unit}, estimate {formatPoints(estimate)}.
                    </span>
                  ) : (
                    <span className="text-emerald-700">Matches the bank</span>
                  )}
                </div>
              )}
              {hints.map((hint, i) => (
                <div key={i} className="mt-1 rounded bg-amber-50 p-2 text-xs">
                  <p>{describeSuggestion(hint, unit, currency, { [purchase.transactionId]: purchase.description })}</p>
                  <SuggestionFixes suggestion={hint} description={purchase.description} run={run} />
                </div>
              ))}
              {differs && hints.length === 0 && <p className="mt-1 text-xs text-slate-500">No MCC in this card's rules explains the difference. Check the purchase's category or the card's rules.</p>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
