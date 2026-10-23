import { declareReinvestment, resplitTrade, retagTrade, type TradeRow } from '@expanses/db';
import { useState } from 'react';
import { Sheet } from '../../app/Sheet';
import { useApp } from '../../app/context';
import { useInvalidateAll } from '../../lib/queries';
import { ErrorBox } from '../../ui';
import { InsetGroup, InsetRow, SelectRow } from '../../ui/native';
import { useGoals } from '../goals/queries';
import { GoalParts } from './GoalParts';
import { type PartDraft, partsFromTyped, partsToTyped, SPLIT } from './goal-parts-form';
import { ReinvestCell } from './ReinvestCell';
import { useAssetValues } from './queries';
import { draftFromTrade } from './trade-form';

/** The holding a recorded trade belongs to, as the two sheets need it: what it is called and counted in. */
interface Holding {
  currency: string;
  byMoney: boolean;
  unitLabel: string;
}

/**
 * Goals… on a buy's or a sell's ⋮: which goal the units of a buy belong to (or several, each with its share), or which
 * goal a sell took from. These were Buy & sell's, set on a line of its history; that page is folded away, so they are
 * set from the line on the holding's own page.
 *
 * One goal is kept the moment it is picked, as before, and the sheet closes on it; a split is typed under the choice
 * and kept with Save goals. `onDone` says what was kept, for the page's notice.
 */
export function TradeGoalsSheet({ trade, holding, onDone, onClose }: { trade: TradeRow; holding: Holding; onDone: (said: string) => void; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const goals = useGoals();
  const goalOptions = (goals.data ?? []).map((goal) => ({ id: goal.id, name: goal.name }));
  // The split being typed, before Save goals; null while the trade is not being split.
  const [splitting, setSplitting] = useState<PartDraft[] | null>(trade.goalParts?.length ? partsToTyped(trade.goalParts, holding.currency) : null);
  const [error, setError] = useState<unknown>(null);
  const buy = trade.kind === 'buy';
  const typed = draftFromTrade(trade, holding.currency);
  const whole = (holding.byMoney ? typed.gross : typed.units) ?? '';

  async function keep(work: () => Promise<unknown>, said: string) {
    setError(null);
    try {
      await work();
      await invalidate();
      onDone(said);
    } catch (e) {
      setError(e);
    }
  }

  return (
    <Sheet grouped title="Goals" onClose={onClose}>
      {/* Said in the sheet, where the change was asked for: the page's own error box is behind it. */}
      <ErrorBox error={error} />
      <InsetGroup footer={buy ? 'Which goal the units of this buy belong to — or several, each with its share.' : 'Which goal this sell took from.'}>
        <SelectRow
          label={buy ? 'For goal' : 'Sell from goal'}
          aria-label={buy ? 'Goal for this buy' : 'Goal for this sell'}
          value={splitting !== null ? SPLIT : (trade.goalId ?? '')}
          onChange={(e) => {
            const goalId = e.target.value;
            if (goalId === SPLIT) {
              setSplitting([{ goalId: trade.goalId ?? goalOptions[0]!.id, amount: '' }]);
              return;
            }
            setSplitting(null);
            const what = buy ? 'purchase' : 'sale';
            void keep(
              () => retagTrade(database, ws, trade.id, goalId || null),
              goalId ? `This ${what} is now ${goalOptions.find((goal) => goal.id === goalId)?.name ?? 'that goal'}'s.` : `This ${what} no longer has a goal.`,
            );
          }}
        >
          <option value="">No goal</option>
          {goalOptions.map((goal) => (
            <option key={goal.id} value={goal.id}>
              {goal.name}
            </option>
          ))}
          {goalOptions.length > 1 && <option value={SPLIT}>Split between goals…</option>}
        </SelectRow>
      </InsetGroup>
      {splitting !== null && (
        <div className="mb-[18px] space-y-2">
          <GoalParts parts={splitting} onChange={setSplitting} goals={goalOptions} whole={whole} byMoney={holding.byMoney} currency={holding.currency} unitLabel={holding.unitLabel} />
          <InsetGroup>
            <InsetRow
              title={<span className="text-[var(--ph-tint)]">Save goals</span>}
              label="Save goals"
              chevron={false}
              onClick={() => {
                try {
                  const parts = partsFromTyped(splitting, whole, holding.byMoney, holding.currency);
                  void keep(() => resplitTrade(database, ws, trade.id, parts), 'Split between goals.');
                } catch (e) {
                  setError(e);
                }
              }}
            />
          </InsetGroup>
        </div>
      )}
    </Sheet>
  );
}

/**
 * Reinvested… on a dividend's or a coupon's ⋮: how much of the payment was put back into a holding, which is what
 * puts it outside the objects of tax. Buy & sell's, as Goals… was, and kept the same way: Save keeps it, and nothing
 * typed takes the marker off.
 */
export function ReinvestedSheet({ trade, currency, onDone, onClose }: { trade: TradeRow; currency: string; onDone: (said: string) => void; onClose: () => void }) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const values = useAssetValues();
  const [error, setError] = useState<unknown>(null);
  // Any holding bought by the unit or by money can be what the payment went back into.
  const holdings = (values.data ?? []).filter((row) => row.mode === 'market' || row.mode === 'amount').map((row) => ({ accountId: row.accountId, name: row.name }));

  return (
    <Sheet grouped title="Reinvested" onClose={onClose}>
      <ErrorBox error={error} />
      <InsetGroup footer="Put back into a holding, so it is not an object of tax.">
        <div className="px-4 py-3">
          <ReinvestCell
            trade={trade}
            holdings={holdings}
            currency={currency}
            onSave={(amountMinor, intoAccountId) =>
              void (async () => {
                setError(null);
                try {
                  await declareReinvestment(database, ws, trade.id, { amountMinor, intoAccountId });
                  await invalidate();
                  onDone(amountMinor > 0 ? 'Recorded as reinvested, so it is not an object of tax.' : 'No longer marked as reinvested.');
                } catch (e) {
                  setError(e);
                }
              })()
            }
          />
        </div>
      </InsetGroup>
    </Sheet>
  );
}
