import { averagePriceMicro, formatMinor, formatPriceMicro, formatUnits, isoDate } from '@expanses/core';
import type { TradeRow } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { cx, Money } from '../../ui';
import { Figure, InsetGroup, InsetRow, type RecordColumn, RecordTable } from '../../ui/native';
import { useGoals } from '../goals/queries';
import { useAssetProfiles, useAssetValues, usePositions, useTrades } from '../networth/queries';
import { DayHeader } from '../transactions/DayHeader';
import { yearByHolding, yearSum } from './income-year';

/**
 * Every holding bought and sold by the unit or by money, and what All trades reads of them: what the year's sells
 * realized, the wide screen's holdings table, and the trades of every holding by day. These were Buy & sell's, folded
 * into Income and then on into All trades (owner, 23 Oct): a trade is recorded and changed on its holding's page, so
 * here it is read, and a line opens that page. What each holding recorded as paid this year stays in `year` for Income,
 * which sets it against what the dividend history estimates.
 */
export function useTradeBook() {
  const { ws } = useApp();
  const values = useAssetValues();
  const profiles = useAssetProfiles();
  const positions = usePositions();
  const trades = useTrades();
  const accounts = useAccounts();
  const goals = useGoals();

  const holdings = useMemo(
    () =>
      (values.data ?? [])
        .filter((row) => row.mode === 'market' || row.mode === 'amount')
        .map((row) => ({ accountId: row.accountId, name: row.name, currency: row.currency, byMoney: row.mode === 'amount', costMinor: row.costMinor, valueMinor: row.valueMinor })),
    [values.data],
  );
  const year = useMemo(() => yearByHolding(holdings, trades.data ?? [], isoDate()), [holdings, trades.data]);
  const profileOf = (accountId: string) => (profiles.data ?? []).find((row) => row.accountId === accountId);
  const unitLabelOf = (accountId: string) => {
    const unitKind = profileOf(accountId)?.unitKind;
    return unitKind === 'grams' ? 'g' : unitKind === 'shares' ? 'shares' : 'units';
  };
  const unitsHeld = (accountId: string) => positions.data?.[accountId]?.unitsMicro ?? 0;

  return {
    ws,
    values,
    trades,
    holdings,
    year,
    realized: yearSum(holdings, year, 'realizedMinor', ws.baseCurrency),
    positions: positions.data ?? {},
    nameOf: (accountId: string) => (values.data ?? []).find((row) => row.accountId === accountId)?.name ?? 'Holding',
    currencyOf: (accountId: string) => (values.data ?? []).find((row) => row.accountId === accountId)?.currency ?? ws.baseCurrency,
    incomeWordOf: (accountId: string) => {
      const kind = profileOf(accountId)?.assetKind;
      return kind === 'stock' ? 'Dividend' : kind === 'bond' ? 'Coupon' : 'Income';
    },
    unitLabelOf,
    heldText: (accountId: string) => (unitsHeld(accountId) > 0 ? `${formatUnits(unitsHeld(accountId))} ${unitLabelOf(accountId)}` : 'Sold'),
    cashName: (accountId: string | null) => (accountId ? ((accounts.data ?? []).find((row) => row.id === accountId)?.name ?? null) : null),
    goalName: (goalId: string | null | undefined) => (goalId ? ((goals.data ?? []).find((goal) => goal.id === goalId)?.name ?? null) : null),
  };
}

export type TradeBook = ReturnType<typeof useTradeBook>;

/** A wide screen has room for the table the phone gave up: every holding with all eight columns. */
export function HoldingsTable({ book }: { book: TradeBook }) {
  type Holding = TradeBook['holdings'][number];
  const empty = { realizedMinor: 0, incomeMinor: 0 };
  const columns: RecordColumn<Holding>[] = [
    { key: 'name', heading: 'Holding', cell: (holding) => holding.name },
    { key: 'held', heading: 'Held', numeric: true, cell: (holding) => book.heldText(holding.accountId) },
    {
      key: 'average',
      heading: 'Average cost',
      numeric: true,
      cell: (holding) => {
        const position = book.positions[holding.accountId];
        const average = position ? averagePriceMicro(position) : null;
        return average === null ? '—' : formatPriceMicro(average, holding.currency);
      },
    },
    { key: 'cost', heading: 'Cost basis', numeric: true, cell: (holding) => <Money minor={holding.costMinor} currency={holding.currency} /> },
    { key: 'value', heading: 'Value', numeric: true, cell: (holding) => <Money minor={holding.valueMinor} currency={holding.currency} /> },
    { key: 'unrealized', heading: 'Unrealized', numeric: true, cell: (holding) => <Money minor={holding.valueMinor - holding.costMinor} currency={holding.currency} tone="auto" /> },
    {
      key: 'realized',
      heading: 'Realized this year',
      numeric: true,
      cell: (holding) => {
        const year = book.year[holding.accountId] ?? empty;
        return year.realizedMinor === 0 ? <Figure tone="ink-3">—</Figure> : <Money minor={year.realizedMinor} currency={holding.currency} tone="auto" />;
      },
    },
    {
      key: 'income',
      heading: 'Income this year',
      numeric: true,
      cell: (holding) => {
        const year = book.year[holding.accountId] ?? empty;
        return year.incomeMinor === 0 ? <Figure tone="ink-3">—</Figure> : <Money minor={year.incomeMinor} currency={holding.currency} />;
      },
    },
  ];
  if (book.holdings.length === 0) return null;
  return (
    <div className="hidden md:block">
      <RecordTable
        header="Holdings"
        records={book.holdings}
        columns={columns}
        detail={{ kind: 'none' }}
        shape={{
          key: (holding) => holding.accountId,
          title: (holding) => holding.name,
          subtitle: (holding) => `${book.heldText(holding.accountId)} · cost ${formatMinor(holding.costMinor, holding.currency)}`,
          value: (holding) => <Money minor={holding.valueMinor} currency={holding.currency} />,
          valueTone: () => 'ink',
        }}
      />
    </div>
  );
}

/**
 * Every holding's trades by day, newest first, with a chip per holding traded to show one alone. A line says what it
 * was, the goal it counts toward and whether a payment was put back in; it opens the holding's page, where its ⋮ edits
 * it, deletes it, and sets its goal or what was reinvested.
 */
export function TradesSection({ book }: { book: TradeBook }) {
  const [filter, setFilter] = useState('all');
  const all = book.trades.data ?? [];
  if (book.holdings.length === 0) return null;

  const titleOf = (trade: TradeRow) => {
    const name = book.nameOf(trade.accountId);
    if (trade.switchedWith) return trade.kind === 'buy' ? `Switched into ${name}` : `Switched out of ${name}`;
    if (trade.kind === 'buy') return `Bought ${name}`;
    if (trade.kind === 'sell') return `Sold ${name}`;
    if (trade.kind === 'income') return `${book.incomeWordOf(trade.accountId)} ${name}`;
    return `Units of ${name}`;
  };
  const unitsLine = (trade: TradeRow) =>
    trade.kind === 'income' ? null : `${trade.kind === 'unit_change' && trade.unitsMicro > 0 ? '+' : ''}${formatUnits(trade.unitsMicro)} ${book.unitLabelOf(trade.accountId)}`;

  // Holdings that have a history, for the chips over it: All, then one each.
  const traded = book.holdings.filter((holding) => all.some((trade) => trade.accountId === holding.accountId));
  const shown = [...all].filter((trade) => filter === 'all' || trade.accountId === filter).reverse();
  const days = new Map<string, TradeRow[]>();
  for (const trade of shown) days.set(trade.occurredOn, [...(days.get(trade.occurredOn) ?? []), trade]);

  return (
    <section aria-label="Trades" data-testid="trade-history">
      {traded.length > 1 && (
        <div className="mb-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Show">
          {[{ accountId: 'all', name: 'All' }, ...traded].map((holding) => (
            <button
              key={holding.accountId}
              type="button"
              aria-pressed={filter === holding.accountId}
              onClick={() => setFilter(holding.accountId)}
              className={cx(
                'ph-focus shrink-0 rounded-full px-3 py-1.5 text-xs whitespace-nowrap',
                filter === holding.accountId ? 'bg-[var(--ph-ink)] text-[var(--ph-surface)]' : 'bg-[var(--ph-surface)] text-[var(--ph-ink-2)]',
              )}
            >
              {holding.name}
            </button>
          ))}
        </div>
      )}
      {[...days].map(([date, list]) => (
        <div key={date} className="mb-3 rounded-[11px] bg-[var(--ph-surface)] px-[14px] pt-3 pb-1">
          <DayHeader date={date} net={0} currency={book.ws.baseCurrency} />
          <ul className="[&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
            {list.map((trade) => {
              const currency = book.currencyOf(trade.accountId);
              const goal = trade.kind === 'buy' && !trade.goalParts?.length ? book.goalName(trade.goalId) : null;
              const parts = (trade.goalParts ?? []).map((part) => `${book.goalName(part.goalId) ?? 'A goal'} ${part.moneyMinor > 0 ? formatMinor(part.moneyMinor, currency) : formatUnits(part.unitsMicro)}`);
              const reinvested = trade.kind === 'income' && (trade.reinvestedMinor ?? 0) > 0;
              const out = trade.kind === 'buy';
              // A switch moved no cash: it names the other fund instead, and its figure is the fund's own, + in and − out.
              const other = trade.switchedWith ? `${trade.kind === 'buy' ? 'from' : 'into'} ${book.nameOf(trade.switchedWith.accountId)}` : null;
              const sub = [unitsLine(trade), other ?? (trade.cashAccountId === null && trade.kind === 'buy' ? 'opening position' : book.cashName(trade.cashAccountId))].filter(Boolean).join(' · ');
              return (
                <li key={trade.id} data-testid="trade-row">
                  <Link
                    to="/net-worth/assets/$accountId"
                    params={{ accountId: trade.accountId }}
                    className="ph-focus-inset flex min-h-11 w-full items-center gap-3 py-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--ph-ink)]">
                        {titleOf(trade)}
                        {goal && <span className="ml-1.5 rounded bg-[var(--ph-fill)] px-1.5 text-[11px] font-normal text-[var(--ph-ink-2)]">{goal}</span>}
                        {parts.map((label) => (
                          <span key={label} className="ml-1.5 rounded bg-[var(--ph-fill)] px-1.5 text-[11px] font-normal text-[var(--ph-ink-2)]">
                            {label}
                          </span>
                        ))}
                        {reinvested && <span className="ml-1.5 rounded bg-[var(--ph-tint-panel)] px-1.5 text-[11px] font-semibold text-[var(--ph-tint)]">Reinvested</span>}
                      </span>
                      {sub && <span className="block truncate text-xs text-[var(--ph-ink-3)]">{sub}</span>}
                    </span>
                    {trade.kind === 'unit_change' ? null : (
                      <span className={cx('tabular shrink-0 text-sm font-semibold whitespace-nowrap', other ? 'text-[var(--ph-ink)]' : out ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-tint)]')}>
                        {other ? (out ? '+' : '−') : out ? '−' : '+'}
                        {formatMinor(trade.grossMinor, currency)}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
