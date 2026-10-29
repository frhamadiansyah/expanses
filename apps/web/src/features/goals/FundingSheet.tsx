import { formatMinor, formatUnits } from '@expanses/core';
import type { TradeRow } from '@expanses/db';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts } from '../../lib/queries';
import { type GroupChild, InsetGroup, InsetRow } from '../../ui/native';
import { useAssetProfiles, useTrades } from '../networth/queries';
import { longDay } from './goal-cards';
import { useGoals } from './queries';
import { SetAsideGroup, type SetAsideState } from './SetAside';

/** What the Funding sheet keeps while the goal form is open: the buys tagged to the goal, changed only when ✓ saves the goal. */
export interface TagState {
  /** Every buy tagged to this goal now, in the order the sheet shows them. */
  ids: readonly string[];
  add: (tradeId: string) => void;
  remove: (tradeId: string) => void;
}

/** The buys a goal can be tagged with: bought, not given back, and not one side of a switch. */
export const taggable = (trades: readonly TradeRow[]) => trades.filter((trade) => trade.kind === 'buy' && trade.status === 'active' && !trade.switchedWith);

/** What the sheet says about a holding's names and sizes, read once for its rows. */
function useHoldingWords() {
  const { ws } = useApp();
  const accounts = useAccounts().data ?? [];
  const profiles = useAssetProfiles().data ?? [];
  const nameOf = (accountId: string) => accounts.find((row) => row.id === accountId)?.name ?? 'Holding';
  const sizeOf = (trade: TradeRow) => {
    if (trade.unitsMicro > 0) {
      const kind = profiles.find((row) => row.accountId === trade.accountId)?.unitKind;
      return `${formatUnits(trade.unitsMicro)} ${kind === 'grams' ? 'g' : kind === 'shares' ? 'shares' : 'units'}`;
    }
    const currency = accounts.find((row) => row.id === trade.accountId)?.currency ?? ws.baseCurrency;
    return formatMinor(trade.grossMinor + trade.feeMinor + trade.taxMinor, currency);
  };
  return { nameOf, sizeOf };
}

/** One tagged buy: its holding and size, and a ✕ that lets it go. */
function TaggedRow({ trade, onRemove, position }: GroupChild & { trade: TradeRow; onRemove: () => void }) {
  const { nameOf, sizeOf } = useHoldingWords();
  return (
    <div className="relative pr-[30px]" data-testid="tagged-row">
      <InsetRow position={position} title={nameOf(trade.accountId)} subtitle={`Bought ${longDay(trade.occurredOn)}`} value={sizeOf(trade)} chevron={false} plain />
      <button
        type="button"
        aria-label={`Remove ${nameOf(trade.accountId)}`}
        onClick={onRemove}
        className="ph-focus-inset absolute top-[10px] right-[4px] flex h-[34px] w-[30px] items-center justify-center text-[var(--ph-ink-3)]"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/**
 * Tag a purchase: the earlier buys of bonds, shares, funds and gold, each with when and how much it was and which goal
 * it already serves. A tap tags it to this goal; one that serves another goal asks before it moves.
 */
function TagPurchaseSheet({ goalId, tagged, onPick, onClose }: { goalId: string | undefined; tagged: readonly string[]; onPick: (tradeId: string) => void; onClose: () => void }) {
  const trades = taggable(useTrades().data ?? []).filter((trade) => !tagged.includes(trade.id));
  const goals = useGoals().data ?? [];
  const { nameOf, sizeOf } = useHoldingWords();
  const [asking, setAsking] = useState<TradeRow | null>(null);
  const serves = (trade: TradeRow) => (trade.goalParts?.length ? 'Several goals' : (goals.find((goal) => goal.id === trade.goalId)?.name ?? 'No goal'));
  const elsewhere = (trade: TradeRow) => Boolean(trade.goalParts?.length) || (trade.goalId !== null && trade.goalId !== goalId);
  return (
    <>
      <Sheet title="Tag a purchase" onClose={onClose} grouped>
        {trades.length === 0 ? (
          <InsetGroup>
            <InsetRow title="No purchases to tag" subtitle="Bonds, shares, funds and gold bought are listed here." chevron={false} />
          </InsetGroup>
        ) : (
          <InsetGroup>
            {trades.map((trade) => (
              <InsetRow
                key={trade.id}
                testId="taggable-row"
                title={nameOf(trade.accountId)}
                subtitle={`Bought ${longDay(trade.occurredOn)} · ${sizeOf(trade)}`}
                value={serves(trade)}
                plain
                chevron={false}
                onClick={() => {
                  if (elsewhere(trade)) setAsking(trade);
                  else {
                    onPick(trade.id);
                    onClose();
                  }
                }}
              />
            ))}
          </InsetGroup>
        )}
      </Sheet>
      {asking && (
        <Sheet title="Move this purchase?" onClose={() => setAsking(null)} grouped>
          <p className="px-[4px] pb-[10px] text-[15px] leading-[20px] text-[var(--ph-ink-2)]">
            {nameOf(asking.accountId)} bought {longDay(asking.occurredOn)} serves {serves(asking)}. It moves to this goal when the goal is saved.
          </p>
          <InsetGroup>
            <InsetRow
              title="Move to this goal"
              label="Move to this goal"
              action
              onClick={() => {
                onPick(asking.id);
                setAsking(null);
                onClose();
              }}
            />
          </InsetGroup>
          <InsetGroup>
            <InsetRow title="Keep where it is" label="Keep where it is" action onClick={() => setAsking(null)} />
          </InsetGroup>
        </Sheet>
      )}
    </>
  );
}

/**
 * Funding: everything that counts toward the goal, in one sheet. Cash and cash equivalents are the accounts money is set
 * aside in; Bonds, shares and funds are the purchases tagged to the goal. Nothing is written until the goal itself is
 * saved with ✓, so the sheet's own ✓ only puts the sheet away.
 */
export function FundingSheet({ goalId, setAside, tags, onClose }: { goalId: string | undefined; setAside: SetAsideState; tags: TagState; onClose: () => void }) {
  const trades = useTrades().data ?? [];
  const [tagging, setTagging] = useState(false);
  const rows = tags.ids.map((id) => trades.find((trade) => trade.id === id)).filter((trade): trade is TradeRow => !!trade);
  return (
    <>
      <Sheet title="Funding" onClose={onClose} grouped confirm={{ label: 'Done', run: onClose }}>
        <SetAsideGroup state={setAside} header="Cash and cash equivalents" />
        <InsetGroup header="Bonds, shares and funds">
          {[
            ...rows.map((trade) => <TaggedRow key={trade.id} trade={trade} onRemove={() => tags.remove(trade.id)} />),
            <InsetRow key="tag" label="Tag a purchase" title="＋ Tag a purchase" action onClick={() => setTagging(true)} />,
          ]}
        </InsetGroup>
      </Sheet>
      {tagging && <TagPurchaseSheet goalId={goalId} tagged={tags.ids} onPick={tags.add} onClose={() => setTagging(false)} />}
    </>
  );
}
