import { averagePriceMicro, formatMinor, formatPriceMicro, formatUnits, isoDate } from '@expanses/core';
import type { TradeRow } from '@expanses/db';
import { Link } from '@tanstack/react-router';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Coins, Layers } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { brokerNameOf } from '../../lib/account-name';
import { cx, Money } from '../../ui';
import { Figure, InsetGroup, InsetRow, type RecordColumn, RecordTable } from '../../ui/native';
import { useGoals } from '../goals/queries';
import { useHoldingLinks } from './queries';
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
  const links = useHoldingLinks();

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
    // Where a holding is kept (its broker), for a trade that moved no cash of its own: an opening position.
    brokerName: (accountId: string) => {
      const broker = (links.data ?? []).find((link) => link.accountId === accountId)?.brokerAccountId;
      const account = broker ? (accounts.data ?? []).find((row) => row.id === broker) : undefined;
      return account ? brokerNameOf(account) : null;
    },
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
export function TradesSection({ book, query = '' }: { book: TradeBook; query?: string }) {
  const all = book.trades.data ?? [];
  if (book.holdings.length === 0) return null;

  // The line says what it is by its round icon; the verb stays in the text for a screen reader and a search.
  const verbOf = (trade: TradeRow) => (trade.switchedWith ? (trade.kind === 'buy' ? 'Switched into ' : 'Switched out of ') : trade.kind === 'buy' ? 'Bought ' : trade.kind === 'sell' ? 'Sold ' : '');
  // A holding is named "TICKER · broker" when it is kept at one; the second line says where, so the title is the ticker alone.
  const nameOnly = (accountId: string) => book.nameOf(accountId).split(' · ')[0] ?? '';
  const titleOf = (trade: TradeRow) => {
    const name = nameOnly(trade.accountId);
    if (trade.kind === 'income') return `${book.incomeWordOf(trade.accountId)} ${name}`;
    if (trade.kind === 'unit_change') return `Units of ${name}`;
    return name;
  };
  const iconOf = (trade: TradeRow) =>
    trade.switchedWith ? <ArrowLeftRight size={17} aria-hidden /> : trade.kind === 'buy' ? <ArrowDownLeft size={17} aria-hidden /> : trade.kind === 'sell' ? <ArrowUpRight size={17} aria-hidden /> : trade.kind === 'income' ? <Coins size={17} aria-hidden /> : <Layers size={17} aria-hidden />;
  const unitsLine = (trade: TradeRow) =>
    trade.kind === 'income' ? null : `${trade.kind === 'unit_change' && trade.unitsMicro > 0 ? '+' : ''}${formatUnits(trade.unitsMicro)} ${book.unitLabelOf(trade.accountId)}`;

  // The search narrows by what the line says: the holding, the broker or account it went through, and the other fund of a switch.
  const needle = query.trim().toLowerCase();
  const matches = (trade: TradeRow) =>
    needle === '' ||
    [verbOf(trade), titleOf(trade), book.cashName(trade.cashAccountId), book.brokerName(trade.accountId), trade.switchedWith ? book.nameOf(trade.switchedWith.accountId) : '']
      .join(' ')
      .toLowerCase()
      .includes(needle);
  const shown = [...all].filter(matches).reverse();
  const days = new Map<string, TradeRow[]>();
  for (const trade of shown) days.set(trade.occurredOn, [...(days.get(trade.occurredOn) ?? []), trade]);

  return (
    <section aria-label="Trades" data-testid="trade-history">
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
              const other = trade.switchedWith ? `${trade.kind === 'buy' ? 'from' : 'into'} ${nameOnly(trade.switchedWith.accountId)}` : null;
              // The second line is the broker or account alone (an opening buy moved no cash, so it names where the holding is kept); the units ride under the amount.
              const sub = other ?? book.cashName(trade.cashAccountId) ?? book.brokerName(trade.accountId) ?? '';
              return (
                <li key={trade.id} data-testid="trade-row">
                  <Link
                    to="/net-worth/assets/$accountId"
                    params={{ accountId: trade.accountId }}
                    className="ph-focus-inset flex min-h-11 w-full items-center gap-3 py-2 text-left"
                  >
                    <span aria-hidden className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[var(--ph-fill)] text-[var(--ph-ink)]">
                      {iconOf(trade)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[var(--ph-ink)]">
                        <span className="sr-only">{verbOf(trade)}</span>
                        {titleOf(trade)}
                        {goal && <span className="ml-1.5 rounded bg-[var(--ph-fill)] px-1.5 text-[11px] font-normal text-[var(--ph-ink-2)]">{goal}</span>}
                        {parts.map((label) => (
                          <span key={label} className="ml-1.5 rounded bg-[var(--ph-fill)] px-1.5 text-[11px] font-normal text-[var(--ph-ink-2)]">
                            {label}
                          </span>
                        ))}
                        {reinvested && <span className="ml-1.5 rounded bg-[var(--ph-up-panel)] px-1.5 text-[11px] font-semibold text-[var(--ph-up)]">Reinvested</span>}
                      </span>
                      {sub && <span className="block truncate text-xs text-[var(--ph-ink-3)]">{sub}</span>}
                    </span>
                    {trade.kind === 'unit_change' ? (
                      <span className="tabular shrink-0 text-right text-sm font-semibold whitespace-nowrap text-[var(--ph-ink)]">{unitsLine(trade)}</span>
                    ) : (
                      <span className="shrink-0 text-right whitespace-nowrap">
                        <span className={cx('tabular block text-sm font-semibold', other ? 'text-[var(--ph-ink)]' : out ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-up)]')}>
                          {other ? (out ? '+' : '−') : out ? '−' : '+'}
                          {formatMinor(trade.grossMinor, currency)}
                        </span>
                        {unitsLine(trade) && <span className="tabular block text-xs text-[var(--ph-ink-3)]">{unitsLine(trade)}</span>}
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
