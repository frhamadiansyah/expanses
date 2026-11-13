import { formatMinor, formatUnits } from '@expanses/core';
import type { TradeRow } from '@expanses/db';
import { X } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts } from '../../lib/queries';
import { type GroupChild, InsetGroup, InsetRow, SearchPill, SelectCircle } from '../../ui/native';
import { useAssetProfiles, useTrades } from '../networth/queries';
import { longDay } from './goal-cards';
import { useGoals } from './queries';
import { SetAsideGroup, type SetAsideState } from './SetAside';
import { allTicked, askAboutMoves, toggleAll, toggleOne } from './tag-selection';

/** What the Funding sheet keeps while the goal form is open: the buys tagged to the goal, changed only when ✓ saves the goal. */
export interface TagState {
  /** Every buy tagged to this goal now, in the order the sheet shows them. */
  ids: readonly string[];
  add: (tradeId: string) => void;
  remove: (tradeId: string) => void;
}

/** The buys a goal can be tagged with: bought, not given back, and not one side of a switch. */
export const taggable = (trades: readonly TradeRow[]) => trades.filter((trade) => trade.kind === 'buy' && trade.status === 'active' && !trade.switchedWith);

/** The kinds Tag a purchase files holdings under, in the order its tabs and groups run. */
type HoldingKind = 'stock' | 'fund' | 'bond' | 'gold' | 'other';
const KIND_ORDER: readonly HoldingKind[] = ['stock', 'fund', 'bond', 'gold', 'other'];
const KIND_TITLES: Record<HoldingKind, string> = { stock: 'Stocks', fund: 'Funds', bond: 'Bonds', gold: 'Gold', other: 'Other' };

/** What the sheet says about a holding's names and sizes, read once for its rows. */
function useHoldingWords() {
  const { ws } = useApp();
  const accounts = useAccounts().data ?? [];
  const profiles = useAssetProfiles().data ?? [];
  const nameOf = (accountId: string) => accounts.find((row) => row.id === accountId)?.name ?? 'Holding';
  /** The size of one or several buys of the same holding: their units added up, or — with no units — what was paid. */
  const sizeOfAll = (buys: readonly TradeRow[]) => {
    const accountId = buys[0]!.accountId;
    const units = buys.reduce((total, trade) => total + trade.unitsMicro, 0);
    if (units > 0) {
      const kind = profiles.find((row) => row.accountId === accountId)?.unitKind;
      return `${formatUnits(units)} ${kind === 'grams' ? 'g' : kind === 'shares' ? 'shares' : 'units'}`;
    }
    const currency = accounts.find((row) => row.id === accountId)?.currency ?? ws.baseCurrency;
    return formatMinor(buys.reduce((total, trade) => total + trade.grossMinor + trade.feeMinor + trade.taxMinor, 0), currency);
  };
  const sizeOf = (trade: TradeRow) => sizeOfAll([trade]);
  /** What a buy cost, in its holding's money. */
  const paidOf = (trade: TradeRow) => {
    const currency = accounts.find((row) => row.id === trade.accountId)?.currency ?? ws.baseCurrency;
    return formatMinor(trade.grossMinor + trade.feeMinor + trade.taxMinor, currency);
  };
  /** The kind a holding is filed under, from its profile; a holding with none is "other". */
  const kindOf = (accountId: string): HoldingKind => {
    const kind = profiles.find((row) => row.accountId === accountId)?.assetKind;
    return kind === 'stock' || kind === 'fund' || kind === 'bond' || kind === 'gold' ? kind : 'other';
  };
  return { nameOf, sizeOf, sizeOfAll, paidOf, kindOf };
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

/** A holding's buys, each with a tick (all ticked when it opens), a "Select all" row, and "Tag N" for the ticked ones. */
function BuysSheet({
  name,
  buys,
  sizeOf,
  paidOf,
  serves,
  onTag,
  onClose,
}: {
  name: string;
  buys: readonly TradeRow[];
  sizeOf: (trade: TradeRow) => string;
  paidOf: (trade: TradeRow) => string;
  serves: (trade: TradeRow) => string;
  onTag: (tradeIds: string[]) => void;
  onClose: () => void;
}) {
  const all = buys.map((trade) => trade.id);
  const [ticked, setTicked] = useState<string[]>(all);
  const every = allTicked(all, ticked);
  const count = ticked.length;
  return (
    <Sheet title={name} onClose={onClose} grouped confirm={{ label: `Tag ${count}`, disabled: count === 0, run: () => onTag(all.filter((id) => ticked.includes(id))) }}>
      <div className="overflow-hidden rounded-[11px] bg-[var(--ph-surface)] [&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
        <button
          type="button"
          role="checkbox"
          aria-checked={every}
          aria-label="Select all"
          data-testid="taggable-all"
          onClick={() => setTicked(toggleAll(all, ticked))}
          className="ph-focus-inset flex min-h-[46px] w-full items-center gap-[10px] px-[13px] text-left active:bg-[var(--ph-fill)]"
        >
          <SelectCircle picked={every} className="h-[22px] w-[22px]" />
          <span className="text-[16px] text-[var(--ph-ink)]">Select all</span>
        </button>
        {buys.map((trade) => {
          const on = ticked.includes(trade.id);
          return (
            <button
              key={trade.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              aria-label={`Bought ${longDay(trade.occurredOn)}, ${sizeOf(trade)}`}
              data-testid="taggable-row"
              onClick={() => setTicked(toggleOne(ticked, trade.id))}
              className="ph-focus-inset flex min-h-[46px] w-full items-center gap-[10px] px-[13px] text-left active:bg-[var(--ph-fill)]"
            >
              <SelectCircle picked={on} className="h-[22px] w-[22px]" />
              <span className="min-w-0 flex-1 py-[6px]">
                <span className="block truncate text-[16px] text-[var(--ph-ink)]">{`Bought ${longDay(trade.occurredOn)} · ${sizeOf(trade)}`}</span>
                {trade.unitsMicro > 0 && <span className="block truncate text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">{`Paid ${paidOf(trade)}`}</span>}
              </span>
              <span className="shrink-0 whitespace-nowrap text-[12.5px] text-[var(--ph-ink-3)]">{serves(trade)}</span>
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

/**
 * Tag a purchase: a search and tabs by kind on top, then the holdings that have earlier buys left to tag. A holding
 * opens its own sheet of buys, each with when and how much it was and which goal it already serves, all ticked. Unticking
 * leaves a buy out; "Tag N" tags the ticked ones together, and asks once, naming the goals, when some serve another goal.
 */
export function TagPurchaseSheet({ goalId, tagged, onPickMany, savedLater = false, onClose }: { goalId: string | undefined; tagged: readonly string[]; onPickMany: (tradeIds: string[]) => void; /** True on the goal form, where the tags are written when the goal is saved. */ savedLater?: boolean; onClose: () => void }) {
  const trades = taggable(useTrades().data ?? []).filter((trade) => !tagged.includes(trade.id));
  const goals = useGoals().data ?? [];
  const { nameOf, sizeOf, sizeOfAll, paidOf, kindOf } = useHoldingWords();
  const [asking, setAsking] = useState<{ ids: string[]; count: number; goals: string[] } | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [tab, setTab] = useState<HoldingKind | 'all'>('all');
  const serves = (trade: TradeRow) => (trade.goalParts?.length ? 'Several goals' : (goals.find((goal) => goal.id === trade.goalId)?.name ?? 'No goal'));

  // One entry per holding, with its buys left to tag, oldest first as the ledger has them.
  const byAccount = new Map<string, TradeRow[]>();
  for (const trade of trades) byAccount.set(trade.accountId, [...(byAccount.get(trade.accountId) ?? []), trade]);
  const holdings = [...byAccount].map(([accountId, buys]) => ({ accountId, buys, kind: kindOf(accountId), name: nameOf(accountId) }));
  const kinds = KIND_ORDER.filter((kind) => holdings.some((holding) => holding.kind === kind));
  const wanted = typed.trim().toLowerCase();
  const shown = holdings.filter((holding) => holding.name.toLowerCase().includes(wanted) && (tab === 'all' || holding.kind === tab));
  const groups = (tab === 'all' ? kinds : [tab]).map((kind) => ({ kind, items: shown.filter((holding) => holding.kind === kind) })).filter((group) => group.items.length > 0);
  const holding = holdings.find((row) => row.accountId === opened);

  const holdingRow = (item: (typeof holdings)[number]) => (
    <InsetRow
      key={item.accountId}
      testId="taggable-holding"
      title={item.name}
      subtitle={`${item.buys.length} ${item.buys.length === 1 ? 'buy' : 'buys'} · ${sizeOfAll(item.buys)}`}
      plain
      onClick={() => setOpened(item.accountId)}
    />
  );

  return (
    <>
      <Sheet title="Tag a purchase" onClose={onClose} grouped tall expanded>
        {trades.length === 0 ? (
          <InsetGroup>
            <InsetRow title="No purchases to tag" subtitle="Bonds, shares, funds and gold bought are listed here." chevron={false} />
          </InsetGroup>
        ) : (
          <>
            <div className="mb-3">
              <SearchPill value={typed} onChange={setTyped} onClose={() => setTyped('')} placeholder="Search holdings" label="Find a holding" />
            </div>
            <div role="tablist" aria-label="Kind" className="mb-3 flex gap-5 border-b border-[var(--ph-track)] px-[4px]">
              {(['all', ...kinds] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={
                    '-mb-px min-h-11 border-b-2 text-[15px] leading-[20px] font-medium ' +
                    (tab === key ? 'border-[var(--ph-tint)] text-[var(--ph-tint)]' : 'border-transparent text-[var(--ph-ink-3)]')
                  }
                >
                  {key === 'all' ? 'All' : KIND_TITLES[key]}
                </button>
              ))}
            </div>
            {groups.map((group) => (
              <InsetGroup key={group.kind} header={tab === 'all' ? KIND_TITLES[group.kind] : undefined}>
                {group.items.map(holdingRow)}
              </InsetGroup>
            ))}
            {groups.length === 0 && <p className="px-4 py-3 text-sm text-[var(--ph-ink-3)]">Nothing matches.</p>}
          </>
        )}
      </Sheet>
      {holding && (
        <BuysSheet
          key={holding.accountId}
          name={holding.name}
          buys={holding.buys}
          sizeOf={sizeOf}
          paidOf={paidOf}
          serves={serves}
          onClose={() => setOpened(null)}
          onTag={(ids) => {
            const moves = askAboutMoves(holding.buys, ids, goalId, (id) => goals.find((goal) => goal.id === id)?.name ?? 'No goal');
            if (moves.count === 0) {
              onPickMany(ids);
              onClose();
            } else setAsking({ ids, ...moves });
          }}
        />
      )}
      {asking && (
        <Sheet title={asking.count === 1 ? 'Move this purchase?' : 'Move these purchases?'} onClose={() => setAsking(null)} grouped>
          <p className="px-[4px] pb-[10px] text-[15px] leading-[20px] text-[var(--ph-ink-2)]">
            {asking.count === 1 ? '1 of the ticked purchases serves' : `${asking.count} of the ticked purchases serve`} {asking.goals.join(', ')}. {asking.count === 1 ? 'It moves' : 'They move'} to this goal{savedLater ? ' when the goal is saved' : ''}.
          </p>
          <InsetGroup>
            <InsetRow
              title="Move to this goal"
              label="Move to this goal"
              action
              onClick={() => {
                onPickMany(asking.ids);
                setAsking(null);
                onClose();
              }}
            />
          </InsetGroup>
          <InsetGroup>
            <InsetRow title="Keep where they are" label="Keep where they are" action onClick={() => setAsking(null)} />
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
      {tagging && <TagPurchaseSheet goalId={goalId} tagged={tags.ids} onPickMany={(ids) => ids.forEach(tags.add)} savedLater onClose={() => setTagging(false)} />}
    </>
  );
}
