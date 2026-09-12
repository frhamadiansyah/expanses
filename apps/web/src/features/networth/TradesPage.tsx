import { averagePriceMicro, formatPriceMicro, formatUnits, isoDate, minorToMajorString, positionAfter, presetFor } from '@expanses/core';
import { deleteTrade, retagTrade, type TradeRow } from '@expanses/db';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Card, Empty, ErrorBox, Money, PageHeader } from '../../ui';
import { NetWorthTabs } from './NetWorthTabs';
import { useAssetProfiles, useAssetValues, usePositions, useTradeTemplates, useTrades, useDueTemplates } from './queries';
import { useGoals } from '../goals/queries';
import { TemplateList } from './TemplateList';
import { TradeForm } from './TradeForm';
import type { TradeDraft } from './trade-form';

const KIND_LABELS: Record<string, string> = { buy: 'Buy', sell: 'Sell', income: 'Income', unit_change: 'Unit change' };

export function TradesPage() {
  const { ws, database } = useApp();
  const invalidate = useInvalidateAll();
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
  const [editing, setEditing] = useState<TradeRow | null>(null);
  const [initial, setInitial] = useState<Partial<TradeDraft> | undefined>(undefined);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');

  const holdings = (values.data ?? [])
    .filter((row) => row.mode === 'market')
    .map((row) => ({ accountId: row.accountId, name: row.name, currency: row.currency }));
  const cashAccounts = (accounts.data ?? []).filter((account) => ['bank', 'cash', 'savings'].includes(account.subtype) && account.archivedAt === null);
  const nameOf = (accountId: string) => (values.data ?? []).find((row) => row.accountId === accountId)?.name ?? 'Holding';
  const currencyOf = (accountId: string) => (values.data ?? []).find((row) => row.accountId === accountId)?.currency ?? ws.baseCurrency;
  const unitLabelOf = (accountId: string) => {
    const profile = (profiles.data ?? []).find((row) => row.accountId === accountId);
    return profile?.unitKind === 'grams' ? 'g' : profile?.unitKind === 'shares' ? 'shares' : 'units';
  };

  /** Realized gains and income for the calendar year, from the difference between two walks. */
  const thisYear = useMemo(() => {
    const startOfYear = `${isoDate().slice(0, 4)}-01-01`;
    const out: Record<string, { realizedMinor: number; incomeMinor: number }> = {};
    for (const holding of holdings) {
      const list = (trades.data ?? []).filter((trade) => trade.accountId === holding.accountId);
      const all = positionAfter(list);
      const before = positionAfter(list, startOfYear === isoDate() ? startOfYear : `${Number(startOfYear.slice(0, 4)) - 1}-12-31`);
      out[holding.accountId] = { realizedMinor: all.realizedMinor - before.realizedMinor, incomeMinor: all.incomeMinor - before.incomeMinor };
    }
    return out;
  }, [holdings, trades.data]);

  const shown = (trades.data ?? []).filter((trade) => filter === 'all' || trade.accountId === filter);

  async function remove(trade: TradeRow) {
    setError(null);
    try {
      const result = await deleteTrade(database, ws, trade.id);
      await invalidate();
      setNotice(result.recalculatedSells.length ? `Removed. ${result.recalculatedSells.length} later sells were worked out again.` : 'Removed.');
    } catch (e) {
      setError(e);
    }
  }

  async function retag(trade: TradeRow, goalId: string) {
    setError(null);
    try {
      await retagTrade(database, ws, trade.id, goalId || null);
      await invalidate();
      setNotice(goalId ? `This purchase now funds ${goalOptions.find((goal) => goal.id === goalId)?.name ?? 'that goal'}.` : 'This purchase no longer funds a goal.');
    } catch (e) {
      setError(e);
    }
  }

  function recordFromTemplate(accountId: string, amountMinor: number | null, cashAccountId: string, id: string, goalId: string | null) {
    setEditing(null);
    setTemplateId(id);
    setInitial({
      kind: 'buy',
      accountId,
      cashAccountId,
      gross: amountMinor === null ? '' : minorToMajorString(amountMinor, currencyOf(accountId)),
      goalId: goalId ?? '',
      occurredOn: isoDate(),
    });
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Buy & sell" />
      <NetWorthTabs />
      <ErrorBox error={values.error ?? trades.error ?? error} />
      {notice && <Card className="bg-emerald-50 text-sm text-emerald-900 ring-emerald-200">{notice}</Card>}

      {holdings.length === 0 && !values.isPending && <Empty>Add a fund, stock, bond or gold on the Assets tab first.</Empty>}

      {holdings.length > 0 && (
        <Card className="overflow-x-auto">
          <h2 className="mb-2 text-sm font-semibold">Holdings</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1">Holding</th>
                <th className="py-1 text-right">Held</th>
                <th className="py-1 text-right">Average cost</th>
                <th className="py-1 text-right">Cost basis</th>
                <th className="py-1 text-right">Value</th>
                <th className="py-1 text-right">Unrealized</th>
                <th className="py-1 text-right">Realized this year</th>
                <th className="py-1 text-right">Income this year</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {holdings.map((holding) => {
                const value = (values.data ?? []).find((row) => row.accountId === holding.accountId)!;
                const position = positions.data?.[holding.accountId];
                const average = position ? averagePriceMicro(position) : null;
                const year = thisYear[holding.accountId] ?? { realizedMinor: 0, incomeMinor: 0 };
                return (
                  <tr key={holding.accountId}>
                    <td className="py-2">{holding.name}</td>
                    <td className="tabular py-2 text-right">
                      {position && position.unitsMicro > 0 ? `${formatUnits(position.unitsMicro)} ${unitLabelOf(holding.accountId)}` : 'Sold'}
                    </td>
                    <td className="tabular py-2 text-right">{average === null ? '—' : formatPriceMicro(average, holding.currency)}</td>
                    <td className="py-2 text-right">
                      <Money minor={value.costMinor} currency={holding.currency} />
                    </td>
                    <td className="py-2 text-right">
                      <Money minor={value.valueMinor} currency={holding.currency} />
                    </td>
                    <td className="py-2 text-right">
                      <Money minor={value.valueMinor - value.costMinor} currency={holding.currency} tone="auto" />
                    </td>
                    <td className="py-2 text-right">
                      {year.realizedMinor === 0 ? '—' : <Money minor={year.realizedMinor} currency={holding.currency} tone="auto" />}
                    </td>
                    <td className="py-2 text-right">{year.incomeMinor === 0 ? '—' : <Money minor={year.incomeMinor} currency={holding.currency} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {(due.data?.length ?? 0) > 0 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Monthly buys due</h2>
          {(due.data ?? []).map((template) => (
            <div key={template.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                {nameOf(template.accountId)}
                {template.amountMinor !== null && (
                  <>
                    {' · '}
                    <Money minor={template.amountMinor} currency={currencyOf(template.accountId)} />
                  </>
                )}
                {` · due on the ${template.dayOfMonth}`}
              </span>
              <Button variant="secondary" onClick={() => recordFromTemplate(template.accountId, template.amountMinor, template.cashAccountId, template.id, template.goalId)}>
                Record it
              </Button>
            </div>
          ))}
          <p className="text-xs text-slate-500">Confirm the units and amount from the fund or broker confirmation before saving.</p>
        </Card>
      )}

      {holdings.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold">{editing ? 'Edit this trade' : 'Record a buy, sell or income'}</h2>
          <TradeForm
            key={`${editing?.id ?? 'new'}-${initial?.accountId ?? ''}-${templateId ?? ''}`}
            holdings={holdings}
            goals={goalOptions}
            cashAccounts={cashAccounts}
            positions={positions.data ?? {}}
            editing={editing}
            initial={initial}
            templateId={templateId}
            onSaved={(message) => {
              setNotice(message);
              setEditing(null);
              setInitial(undefined);
              setTemplateId(null);
            }}
            onCancel={editing || initial ? () => { setEditing(null); setInitial(undefined); setTemplateId(null); } : undefined}
          />
        </Card>
      )}

      {(trades.data?.length ?? 0) > 0 && (
        <Card className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">History</h2>
            <select className="rounded-lg border border-slate-300 px-2 py-1 text-sm" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All holdings</option>
              {holdings.map((holding) => (
                <option key={holding.accountId} value={holding.accountId}>
                  {holding.name}
                </option>
              ))}
            </select>
          </div>
          <div className="divide-y divide-slate-100 text-sm">
            {[...shown].reverse().map((trade) => (
              <div key={trade.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="text-slate-500">{trade.occurredOn}</span>{' '}
                  <span className="font-medium">{KIND_LABELS[trade.kind]}</span> {nameOf(trade.accountId)}
                  {trade.kind !== 'income' && ` · ${formatUnits(trade.unitsMicro)} ${unitLabelOf(trade.accountId)}`}
                  {trade.cashAccountId === null && trade.kind === 'buy' && ' · opening position'}
                </span>
                <span className="flex items-center gap-2">
                  {trade.kind === 'buy' && goalOptions.length > 0 && (
                    <select
                      aria-label="Goal for this buy"
                      className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                      value={trade.goalId ?? ''}
                      onChange={(e) => retag(trade, e.target.value)}
                    >
                      <option value="">No goal</option>
                      {goalOptions.map((goal) => (
                        <option key={goal.id} value={goal.id}>
                          {goal.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <Money minor={trade.grossMinor} currency={currencyOf(trade.accountId)} />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setTemplateId(null);
                      setEditing(trade);
                      setInitial({
                        kind: trade.kind,
                        accountId: trade.accountId,
                        occurredOn: trade.occurredOn,
                        units: trade.unitsMicro === 0 ? '' : formatUnits(trade.unitsMicro),
                        gross: minorToMajorString(trade.grossMinor, currencyOf(trade.accountId)),
                        fee: minorToMajorString(trade.feeMinor, currencyOf(trade.accountId)),
                        tax: minorToMajorString(trade.taxMinor, currencyOf(trade.accountId)),
                        cashAccountId: trade.cashAccountId ?? '',
                        goalId: trade.goalId ?? '',
                      });
                    }}
                  >
                    Edit
                  </Button>
                  <Button variant="danger" onClick={() => remove(trade)}>
                    Delete
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {holdings.length > 0 && <TemplateList templates={templates.data ?? []} holdings={holdings} cashAccounts={cashAccounts} goals={goalOptions} />}
      <p className="text-xs text-slate-500">
        Presets in use: {(profiles.data ?? []).filter((profile) => presetFor(profile.assetKind).valuationMode === 'market').length} holdings measured in units.
      </p>
    </div>
  );
}
