import { averagePriceMicro, formatMinor, formatPriceMicro, formatUnits, isoDate, minorToMajorString, positionAfter, presetFor } from '@expanses/core';
import { declareReinvestment, deleteTrade, retagTrade, type TradeRow } from '@expanses/db';
import { useMemo, useState } from 'react';
import { useApp } from '../../app/context';
import { SPENDABLE_SUBTYPES } from '../../lib/account-types';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { Button, Empty, ErrorBox, Money } from '../../ui';
import { Figure, InsetGroup, InsetRow, LargeTitle, type RecordColumn, RecordTable, SelectRow } from '../../ui/native';
import { Panel, SCREEN } from './Panel';
import { NetWorthTabs } from './NetWorthTabs';
import { ReinvestCell } from './ReinvestCell';
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
  const cashAccounts = (accounts.data ?? []).filter((account) => SPENDABLE_SUBTYPES.includes(account.subtype) && account.archivedAt === null);
  const nameOf = (accountId: string) => (values.data ?? []).find((row) => row.accountId === accountId)?.name ?? 'Holding';
  const currencyOf = (accountId: string) => (values.data ?? []).find((row) => row.accountId === accountId)?.currency ?? ws.baseCurrency;
  const unitLabelOf = (accountId: string) => {
    const profile = (profiles.data ?? []).find((row) => row.accountId === accountId);
    return profile?.unitKind === 'grams' ? 'g' : profile?.unitKind === 'shares' ? 'shares' : 'units';
  };
  const EMPTY_VALUE = { costMinor: 0, valueMinor: 0 };
  const valueOf = (accountId: string) => (values.data ?? []).find((row) => row.accountId === accountId) ?? EMPTY_VALUE;
  const heldText = (accountId: string) => {
    const position = positions.data?.[accountId];
    return position && position.unitsMicro > 0 ? `${formatUnits(position.unitsMicro)} ${unitLabelOf(accountId)}` : 'Sold';
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

  /** Only a payment can be reinvested; the repo refuses proceeds from a sale. */
  async function declare(trade: TradeRow, amountMinor: number, intoAccountId: string | null) {
    setError(null);
    try {
      await declareReinvestment(database, ws, trade.id, { amountMinor, intoAccountId });
      await invalidate();
      setNotice(amountMinor > 0 ? 'Recorded as reinvested, so it is not an object of tax.' : 'No longer marked as reinvested.');
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

  /*
   * The holdings table, column for column, handed to the kit.
   *
   * At 390 px this was eight columns in a `w-full` table: they collided and the figures ran into each other.
   * `RecordTable` keeps every one of them on a wide screen and draws a row per holding on a phone.
   */
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

  return (
    <div className={SCREEN}>
      <LargeTitle title="Buy & sell" />
      <NetWorthTabs />
      <ErrorBox error={values.error ?? trades.error ?? error} />
      {notice && (
        <Panel className="text-[13px] leading-[17px] text-[var(--ph-tint)]" testId="trade-notice">
          {notice}
        </Panel>
      )}

      {holdings.length === 0 && !values.isPending && <Empty>Add a fund, stock, bond or gold on the Assets tab first.</Empty>}

      {holdings.length > 0 && (
        <RecordTable
          header="Holdings"
          records={holdings}
          columns={holdingColumns}
          shape={{
            key: (holding) => holding.accountId,
            title: (holding) => holding.name,
            subtitle: (holding) => `${heldText(holding.accountId)} · cost ${formatMinor(valueOf(holding.accountId).costMinor, holding.currency)}`,
            value: (holding) => <Money minor={valueOf(holding.accountId).valueMinor} currency={holding.currency} />,
            valueTone: () => 'ink',
          }}
        />
      )}

      {(due.data?.length ?? 0) > 0 && (
        <InsetGroup header="Monthly buys due" footer="Confirm the units and amount from the fund or broker confirmation before saving.">
          {(due.data ?? []).map((template) => (
            <InsetRow
              key={template.id}
              title={nameOf(template.accountId)}
              subtitle={`${template.amountMinor === null ? '' : `${formatMinor(template.amountMinor, currencyOf(template.accountId))} · `}due on the ${template.dayOfMonth}`}
              // The row is the "Record it" it used to hold: a row never carries a button, it *is* the button.
              label={`Record it · ${nameOf(template.accountId)}`}
              onClick={() => recordFromTemplate(template.accountId, template.amountMinor, template.cashAccountId, template.id, template.goalId)}
            />
          ))}
        </InsetGroup>
      )}

      {holdings.length > 0 && (
        <Panel header={editing ? 'Edit this trade' : 'Record a buy, sell or income'}>
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
        </Panel>
      )}

      {(trades.data?.length ?? 0) > 0 && (
        <Panel header="History" pad={false}>
          <div className="border-b-[0.5px] border-[var(--ph-hair)]">
            <SelectRow label="Show" value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="all">All holdings</option>
              {holdings.map((holding) => (
                <option key={holding.accountId} value={holding.accountId}>
                  {holding.name}
                </option>
              ))}
            </SelectRow>
          </div>
          <div className="text-[13px]">
            {[...shown].reverse().map((trade) => (
              <div
                key={trade.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t-[0.5px] border-[var(--ph-hair)] px-[13px] py-[11px] first:border-t-0"
              >
                <span className="min-w-0">
                  <span className="text-[var(--ph-ink-3)]">{trade.occurredOn}</span>{' '}
                  <span className="font-medium text-[var(--ph-ink)]">{KIND_LABELS[trade.kind]}</span> {nameOf(trade.accountId)}
                  {trade.kind !== 'income' && ` · ${formatUnits(trade.unitsMicro)} ${unitLabelOf(trade.accountId)}`}
                  {trade.cashAccountId === null && trade.kind === 'buy' && ' · opening position'}
                </span>
                <span className="flex items-center gap-2">
                  {trade.kind === 'buy' && goalOptions.length > 0 && (
                    <select
                      aria-label="Goal for this buy"
                      className="ph-focus rounded bg-transparent px-1 py-1 text-xs text-[var(--ph-tint)]"
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
                  {trade.kind === 'income' && (
                    <ReinvestCell
                      trade={trade}
                      holdings={holdings}
                      currency={currencyOf(trade.accountId)}
                      onSave={(amountMinor, intoAccountId) => void declare(trade, amountMinor, intoAccountId)}
                    />
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
        </Panel>
      )}

      {holdings.length > 0 && <TemplateList templates={templates.data ?? []} holdings={holdings} cashAccounts={cashAccounts} goals={goalOptions} />}
      <p className="px-[4px] text-[12.5px] leading-[16px] text-[var(--ph-ink-3)]">
        Presets in use: {(profiles.data ?? []).filter((profile) => presetFor(profile.assetKind).valuationMode === 'market').length} holdings measured in units.
      </p>
    </div>
  );
}
