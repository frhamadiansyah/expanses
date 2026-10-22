import { averagePriceMicro, formatMinor, formatPriceMicro, formatUnits, holdingPositionAfter, isoDate } from '@expanses/core';
import { declareReinvestment, deleteTrade, retagTrade, type TradeRow } from '@expanses/db';
import { useNavigate } from '@tanstack/react-router';
import { ArrowDownLeft, CalendarClock, Minus, Plus, Shuffle } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { Sheet } from '../../app/Sheet';
import { useAccounts } from '../../lib/queries';
import { useInvalidateAll } from '../../lib/queries';
import { cx, Empty, ErrorBox, Money } from '../../ui';
import {
  ActionButtons,
  Figure,
  InsetGroup,
  InsetRow,
  Panel,
  PushedTitle,
  ReadOnlyRow,
  type RecordColumn,
  RecordTable,
  type RoundAction,
  SCREEN,
  SelectRow,
} from '../../ui/native';
import { DayHeader } from '../transactions/DayHeader';
import { useGoals } from '../goals/queries';
import { TradeSheet } from './AssetSheets';
import { ReinvestCell } from './ReinvestCell';
import { useAssetProfiles, useAssetValues, useDueTemplates, usePositions, useTradeTemplates, useTrades } from './queries';
import { draftFromTrade } from './trade-form';

type Doing = 'buy' | 'sell' | 'income' | 'units';

const ASKS: Record<Doing, string> = { buy: 'Buy which?', sell: 'Sell which?', income: 'Income from which?', units: 'Units of which?' };

/**
 * Buy & sell: four buttons, the year's figures, the monthly plans, and every holding's history by day.
 *
 * A trade is recorded on the holding's own page — Buy, Sell, Income or Units here asks which holding, then opens that
 * holding with the sheet already up, so there is one buy form to keep right rather than one here and one there. A
 * line of the history opens what it was, with the two things only this page sets on a recorded trade: the goal a buy
 * funds, and how much of a payment was put back in. A wide screen keeps the holdings table with every column.
 */
export function TradesPage() {
  const { ws, database } = useApp();
  const invalidate = useInvalidateAll();
  const navigate = useNavigate();
  const values = useAssetValues();
  const profiles = useAssetProfiles();
  const positions = usePositions();
  const trades = useTrades();
  const templates = useTradeTemplates();
  const due = useDueTemplates();
  const accounts = useAccounts();
  const goals = useGoals();
  const goalOptions = (goals.data ?? []).map((goal) => ({ id: goal.id, name: goal.name }));
  const [notice, setNotice] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [asking, setAsking] = useState<Doing | null>(null);
  const [open, setOpen] = useState<TradeRow | null>(null);
  const [editing, setEditing] = useState<TradeRow | null>(null);
  const [filter, setFilter] = useState('all');

  const holdings = (values.data ?? [])
    .filter((row) => row.mode === 'market' || row.mode === 'amount')
    .map((row) => ({ accountId: row.accountId, name: row.name, currency: row.currency, byMoney: row.mode === 'amount' }));
  const nameOf = (accountId: string) => (values.data ?? []).find((row) => row.accountId === accountId)?.name ?? 'Holding';
  const currencyOf = (accountId: string) => (values.data ?? []).find((row) => row.accountId === accountId)?.currency ?? ws.baseCurrency;
  const profileOf = (accountId: string) => (profiles.data ?? []).find((row) => row.accountId === accountId);
  const unitLabelOf = (accountId: string) => {
    const unitKind = profileOf(accountId)?.unitKind;
    return unitKind === 'grams' ? 'g' : unitKind === 'shares' ? 'shares' : 'units';
  };
  const incomeWordOf = (accountId: string) => {
    const kind = profileOf(accountId)?.assetKind;
    return kind === 'stock' ? 'Dividend' : kind === 'bond' ? 'Coupon' : 'Income';
  };
  const cashName = (accountId: string | null) => (accountId ? ((accounts.data ?? []).find((row) => row.id === accountId)?.name ?? null) : null);
  const EMPTY_VALUE = { costMinor: 0, valueMinor: 0 };
  const valueOf = (accountId: string) => (values.data ?? []).find((row) => row.accountId === accountId) ?? EMPTY_VALUE;
  const unitsHeld = (accountId: string) => positions.data?.[accountId]?.unitsMicro ?? 0;
  const heldText = (accountId: string) => (unitsHeld(accountId) > 0 ? `${formatUnits(unitsHeld(accountId))} ${unitLabelOf(accountId)}` : 'Sold');

  // What each holding realized and earned since 1 January: the position now, less the position on 31 December.
  const thisYear = useMemo(() => {
    const lastYearEnd = `${Number(isoDate().slice(0, 4)) - 1}-12-31`;
    const out: Record<string, { realizedMinor: number; incomeMinor: number }> = {};
    for (const holding of holdings) {
      const list = (trades.data ?? []).filter((trade) => trade.accountId === holding.accountId);
      const all = holdingPositionAfter(list);
      const before = holdingPositionAfter(list, lastYearEnd);
      out[holding.accountId] = { realizedMinor: all.realizedMinor - before.realizedMinor, incomeMinor: all.incomeMinor - before.incomeMinor };
    }
    return out;
  }, [holdings, trades.data]);
  // The year's two figures, added up per currency: a holding in dollars is never summed into rupiah unconverted.
  const yearBy = (pick: 'realizedMinor' | 'incomeMinor') => {
    const sums = new Map<string, number>();
    for (const holding of holdings) sums.set(holding.currency, (sums.get(holding.currency) ?? 0) + (thisYear[holding.accountId]?.[pick] ?? 0));
    const base = sums.get(ws.baseCurrency) ?? 0;
    const others = [...sums].filter(([currency, minor]) => currency !== ws.baseCurrency && minor !== 0);
    return { base, others: others.map(([currency, minor]) => formatMinor(minor, currency)).join(' · ') };
  };
  const realized = yearBy('realizedMinor');
  const income = yearBy('incomeMinor');

  // Which holdings each button can act on: a sell, an income or a unit change needs something there to act on.
  const eligible = (doing: Doing) =>
    holdings.filter((holding) => {
      const kind = profileOf(holding.accountId)?.assetKind;
      if (doing === 'buy') return true;
      if (doing === 'sell') return holding.byMoney ? valueOf(holding.accountId).valueMinor > 0 : unitsHeld(holding.accountId) > 0;
      if (doing === 'income') return kind !== 'gold';
      return !holding.byMoney && unitsHeld(holding.accountId) > 0;
    });
  const go = (doing: Doing, accountId: string) => {
    setAsking(null);
    void navigate({ to: '/net-worth/assets/$accountId', params: { accountId }, search: { do: doing } });
  };
  const ask = (doing: Doing) => () => {
    const choices = eligible(doing);
    if (choices.length === 1) go(doing, choices[0]!.accountId);
    else setAsking(doing);
  };
  const round: RoundAction[] = [
    { key: 'buy', label: 'Buy', glyph: <Plus size={20} aria-hidden />, run: ask('buy') },
    { key: 'sell', label: 'Sell', glyph: <Minus size={20} aria-hidden />, run: ask('sell') },
    { key: 'income', label: 'Income', glyph: <ArrowDownLeft size={20} aria-hidden />, run: ask('income') },
    { key: 'units', label: 'Units', glyph: <Shuffle size={19} aria-hidden />, run: ask('units') },
  ];

  async function run(work: () => Promise<unknown>, said: string) {
    setError(null);
    try {
      await work();
      await invalidate();
      setNotice(said);
    } catch (e) {
      setError(e);
    }
  }

  const titleOf = (trade: TradeRow) => {
    const name = nameOf(trade.accountId);
    if (trade.kind === 'buy') return `Bought ${name}`;
    if (trade.kind === 'sell') return `Sold ${name}`;
    if (trade.kind === 'income') return `${incomeWordOf(trade.accountId)} ${name}`;
    return `Units of ${name}`;
  };
  const unitsLine = (trade: TradeRow) =>
    trade.kind === 'income' ? null : `${trade.kind === 'unit_change' && trade.unitsMicro > 0 ? '+' : ''}${formatUnits(trade.unitsMicro)} ${unitLabelOf(trade.accountId)}`;
  const goalName = (goalId: string | null | undefined) => (goalId ? (goalOptions.find((goal) => goal.id === goalId)?.name ?? null) : null);

  // Holdings that have a history, for the chips over it: All, then one each.
  const traded = holdings.filter((holding) => (trades.data ?? []).some((trade) => trade.accountId === holding.accountId));
  const shown = [...(trades.data ?? [])].filter((trade) => filter === 'all' || trade.accountId === filter).reverse();
  const days = new Map<string, TradeRow[]>();
  for (const trade of shown) days.set(trade.occurredOn, [...(days.get(trade.occurredOn) ?? []), trade]);

  const holdingColumns: RecordColumn<(typeof holdings)[number]>[] = [
    { key: 'name', heading: 'Holding', cell: (holding) => holding.name },
    { key: 'held', heading: 'Held', numeric: true, cell: (holding) => heldText(holding.accountId) },
    {
      key: 'average',
      heading: 'Average cost',
      numeric: true,
      cell: (holding) => {
        const position = positions.data?.[holding.accountId];
        const average = position ? averagePriceMicro(position) : null;
        return average === null ? '—' : formatPriceMicro(average, holding.currency);
      },
    },
    { key: 'cost', heading: 'Cost basis', numeric: true, cell: (holding) => <Money minor={valueOf(holding.accountId).costMinor} currency={holding.currency} /> },
    { key: 'value', heading: 'Value', numeric: true, cell: (holding) => <Money minor={valueOf(holding.accountId).valueMinor} currency={holding.currency} /> },
    {
      key: 'unrealized',
      heading: 'Unrealized',
      numeric: true,
      cell: (holding) => {
        const value = valueOf(holding.accountId);
        return <Money minor={value.valueMinor - value.costMinor} currency={holding.currency} tone="auto" />;
      },
    },
    {
      key: 'realized',
      heading: 'Realized this year',
      numeric: true,
      cell: (holding) => {
        const year = thisYear[holding.accountId] ?? { realizedMinor: 0, incomeMinor: 0 };
        return year.realizedMinor === 0 ? <Figure tone="ink-3">—</Figure> : <Money minor={year.realizedMinor} currency={holding.currency} tone="auto" />;
      },
    },
    {
      key: 'income',
      heading: 'Income this year',
      numeric: true,
      cell: (holding) => {
        const year = thisYear[holding.accountId] ?? { realizedMinor: 0, incomeMinor: 0 };
        return year.incomeMinor === 0 ? <Figure tone="ink-3">—</Figure> : <Money minor={year.incomeMinor} currency={holding.currency} />;
      },
    },
  ];

  const dueCount = due.data?.length ?? 0;
  const planCount = templates.data?.length ?? 0;
  const plansLine =
    dueCount > 0
      ? `${dueCount} due · ${(due.data ?? []).map((template) => nameOf(template.accountId)).join(', ')}`
      : planCount > 0
        ? `${planCount} ${planCount === 1 ? 'plan' : 'plans'}`
        : 'A buy or a move that comes every month';

  return (
    <div className={SCREEN}>
      <PushedTitle title="Buy & sell" back="Net worth" backTo="/net-worth" />
      <ErrorBox error={values.error ?? trades.error ?? error} />
      {notice && (
        <Panel className="text-[13px] leading-[17px] text-[var(--ph-tint)]" testId="trade-notice">
          {notice}
        </Panel>
      )}

      {holdings.length === 0 && !values.isPending && <Empty>Add a fund, stock, bond or gold on the Assets tab first.</Empty>}

      {holdings.length > 0 && (
        <>
          <ActionButtons actions={round} />

          <div data-testid="trades-year" className="mb-3 flex overflow-hidden rounded-[11px] bg-[var(--ph-surface)]">
            <YearFigure label="Realized this year" minor={realized.base} currency={ws.baseCurrency} others={realized.others} signed />
            <YearFigure label="Income this year" minor={income.base} currency={ws.baseCurrency} others={income.others} />
          </div>

          <InsetGroup>
            <InsetRow
              icon={<CalendarClock size={16} aria-hidden />}
              title="Monthly plans"
              subtitle={plansLine}
              to="/net-worth/trades/plans"
              testId="monthly-plans"
            />
          </InsetGroup>

          {/* A wide screen has room for the table the phone gave up: every holding with all eight columns. */}
          <div className="hidden md:block">
            <RecordTable
              header="Holdings"
              records={holdings}
              columns={holdingColumns}
              detail={{ kind: 'none' }}
              shape={{
                key: (holding) => holding.accountId,
                title: (holding) => holding.name,
                subtitle: (holding) => `${heldText(holding.accountId)} · cost ${formatMinor(valueOf(holding.accountId).costMinor, holding.currency)}`,
                value: (holding) => <Money minor={valueOf(holding.accountId).valueMinor} currency={holding.currency} />,
                valueTone: () => 'ink',
              }}
            />
          </div>
        </>
      )}

      {(trades.data?.length ?? 0) > 0 && (
        <section aria-label="History" data-testid="trade-history">
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
              <DayHeader date={date} net={0} currency={ws.baseCurrency} />
              <ul className="[&>*+*]:border-t-[0.5px] [&>*+*]:border-[var(--ph-hair)]">
                {list.map((trade) => {
                  const goal = trade.kind === 'buy' ? goalName(trade.goalId) : null;
                  const reinvested = trade.kind === 'income' && (trade.reinvestedMinor ?? 0) > 0;
                  const out = trade.kind === 'buy';
                  const sub = [unitsLine(trade), trade.cashAccountId === null && trade.kind === 'buy' ? 'opening position' : cashName(trade.cashAccountId)].filter(Boolean).join(' · ');
                  return (
                    <li key={trade.id} data-testid="trade-row">
                      <button type="button" onClick={() => setOpen(trade)} className="ph-focus-inset flex min-h-11 w-full items-center gap-3 py-2 text-left">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-[var(--ph-ink)]">
                            {titleOf(trade)}
                            {goal && <span className="ml-1.5 rounded bg-[var(--ph-fill)] px-1.5 text-[11px] font-normal text-[var(--ph-ink-2)]">{goal}</span>}
                            {reinvested && <span className="ml-1.5 rounded bg-[var(--ph-tint-panel)] px-1.5 text-[11px] font-semibold text-[var(--ph-tint)]">Reinvested</span>}
                          </span>
                          {sub && <span className="block truncate text-xs text-[var(--ph-ink-3)]">{sub}</span>}
                        </span>
                        {trade.kind === 'unit_change' ? null : (
                          <span className={cx('tabular shrink-0 text-sm font-semibold whitespace-nowrap', out ? 'text-[var(--ph-alarm)]' : 'text-[var(--ph-tint)]')}>
                            {out ? '−' : '+'}
                            {formatMinor(trade.grossMinor, currencyOf(trade.accountId))}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      )}

      {asking && (
        <Sheet grouped title={ASKS[asking]} onClose={() => setAsking(null)}>
          {eligible(asking).length === 0 ? (
            <Empty>Nothing held to do that with.</Empty>
          ) : (
            <InsetGroup>
              {eligible(asking).map((holding) => (
                <InsetRow
                  key={holding.accountId}
                  title={holding.name}
                  subtitle={holding.byMoney ? formatMinor(valueOf(holding.accountId).valueMinor, holding.currency) : heldText(holding.accountId)}
                  onClick={() => go(asking, holding.accountId)}
                />
              ))}
            </InsetGroup>
          )}
        </Sheet>
      )}

      {open && (
        <Sheet grouped title={titleOf(open)} onClose={() => setOpen(null)}>
          <InsetGroup>
            <ReadOnlyRow label={open.kind === 'income' ? 'Amount' : open.kind === 'sell' ? 'Proceeds' : 'Cost'} value={formatMinor(open.grossMinor, currencyOf(open.accountId))} />
            {open.kind !== 'income' && <ReadOnlyRow label="Units" value={unitsLine(open)} />}
            {open.feeMinor > 0 && <ReadOnlyRow label="Fee" value={formatMinor(open.feeMinor, currencyOf(open.accountId))} />}
            {open.taxMinor > 0 && <ReadOnlyRow label="Tax" value={formatMinor(open.taxMinor, currencyOf(open.accountId))} />}
            {open.kind !== 'unit_change' && (
              <ReadOnlyRow
                label={open.kind === 'buy' ? 'Paid from' : 'Paid into'}
                value={open.cashAccountId === null ? 'Opening position' : (cashName(open.cashAccountId) ?? '—')}
              />
            )}
            <ReadOnlyRow label="Date" value={open.occurredOn} />
          </InsetGroup>
          {open.kind === 'buy' && goalOptions.length > 0 && (
            <InsetGroup footer="Which goal the units of this buy belong to.">
              <SelectRow
                label="For goal"
                aria-label="Goal for this buy"
                value={open.goalId ?? ''}
                onChange={(e) => {
                  const goalId = e.target.value;
                  setOpen({ ...open, goalId: goalId || null });
                  void run(
                    () => retagTrade(database, ws, open.id, goalId || null),
                    goalId ? `This purchase now funds ${goalOptions.find((goal) => goal.id === goalId)?.name ?? 'that goal'}.` : 'This purchase no longer funds a goal.',
                  );
                }}
              >
                <option value="">No goal</option>
                {goalOptions.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.name}
                  </option>
                ))}
              </SelectRow>
            </InsetGroup>
          )}
          {open.kind === 'income' && (
            <InsetGroup header="Reinvested" footer="Put back into a holding, so it is not an object of tax.">
              <div className="px-4 py-3">
                <ReinvestCell
                  trade={open}
                  holdings={holdings}
                  currency={currencyOf(open.accountId)}
                  onSave={(amountMinor, intoAccountId) =>
                    void run(
                      () => declareReinvestment(database, ws, open.id, { amountMinor, intoAccountId }),
                      amountMinor > 0 ? 'Recorded as reinvested, so it is not an object of tax.' : 'No longer marked as reinvested.',
                    ).then(() => setOpen(null))
                  }
                />
              </div>
            </InsetGroup>
          )}
          <InsetGroup>
            <InsetRow
              title="Edit"
              chevron={false}
              onClick={() => {
                setEditing(open);
                setOpen(null);
              }}
            />
            <InsetRow
              title={<span className="text-[var(--ph-alarm)]">Delete</span>}
              label="Delete"
              chevron={false}
              onClick={() => {
                const trade = open;
                if (!window.confirm('Delete this trade? Later sells are worked out again at the new average cost.')) return;
                setOpen(null);
                setError(null);
                void deleteTrade(database, ws, trade.id)
                  .then(async (result) => {
                    await invalidate();
                    setNotice(result.recalculatedSells.length ? `Removed. ${result.recalculatedSells.length} later sells were worked out again.` : 'Removed.');
                  })
                  .catch(setError);
              }}
            />
          </InsetGroup>
        </Sheet>
      )}

      {editing && (
        <TradeSheet
          title="Edit"
          holding={{ accountId: editing.accountId, name: nameOf(editing.accountId), currency: currencyOf(editing.accountId) }}
          initial={draftFromTrade(editing, currencyOf(editing.accountId))}
          editing={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

/** One of the year's two figures: the base currency's sum, and any other currency's under it. */
function YearFigure({ label, minor, currency, others, signed = false }: { label: string; minor: number; currency: string; others: string; signed?: boolean }) {
  return (
    <div className="min-w-0 flex-1 px-[14px] py-2.5 [&+&]:border-l-[0.5px] [&+&]:border-[var(--ph-hair)]">
      <span className="block text-[11.5px] leading-[14px] text-[var(--ph-ink-3)]">{label}</span>
      <span
        className={cx(
          'tabular block text-base leading-6 font-bold',
          signed && minor > 0 && 'text-[var(--ph-tint)]',
          signed && minor < 0 && 'text-[var(--ph-alarm)]',
          !signed && 'text-[var(--ph-ink)]',
        )}
      >
        {signed && minor > 0 ? '+' : ''}
        {formatMinor(minor, currency)}
      </span>
      {others && <span className="block truncate text-[11.5px] leading-[14px] text-[var(--ph-ink-3)]">{others}</span>}
    </div>
  );
}
