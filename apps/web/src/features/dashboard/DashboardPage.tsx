import { addMonths, displayAmount, isoDate, lastNMonths, monthOf, monthRange } from '@expanses/core';
import { categoryTotalsBetween, expiringSoonAcross, nativeBalances, netWorthAt, ownerScope } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { isMoneyAccount, useAccounts, useResolveRates } from '../../lib/queries';
import { Empty, Money } from '../../ui';
import { Hero, InsetGroup, InsetRow, LargeTitle } from '../../ui/native';
import { Panel, SCREEN } from '../networth/Panel';

const sum = (rows: { amountBaseMinor: number }[]) => rows.reduce((s, r) => s + r.amountBaseMinor, 0);

export function DashboardPage() {
  const { database, ws } = useApp();
  const resolveRates = useResolveRates();
  const accounts = useAccounts();
  const money = (accounts.data ?? []).filter(isMoneyAccount);
  const today = isoDate();
  const thisMonth = monthOf(today);

  const current = useQuery({
    queryKey: ['net-worth', ws.workspaceId, today, money.length],
    enabled: accounts.isSuccess,
    queryFn: async () => {
      const balances = await nativeBalances(database, ws);
      const rates = await resolveRates(money.map((a) => a.currency!), today);
      const worth = await netWorthAt(database, ws, today, rates.rates);
      const missingRates = [...new Set(money.map((a) => a.currency!).filter((currency) => currency !== ws.baseCurrency && rates.rates[currency] === undefined))];
      return {
        balances,
        rates,
        result: { netWorthBaseMinor: worth.netWorthMinor, assetsBaseMinor: worth.assetsMinor, liabilitiesBaseMinor: worth.liabilitiesMinor, missingRates },
      };
    },
  });

  const months = lastNMonths(thisMonth, 6);
  const trend = useQuery({
    queryKey: ['net-worth-trend', ws.workspaceId, thisMonth, money.length],
    enabled: accounts.isSuccess,
    queryFn: () =>
      Promise.all(
        months.map(async (month) => {
          const asOf = month === thisMonth ? today : monthRange(month).to;
          const rates = await resolveRates(money.map((a) => a.currency!), asOf);
          return { month, value: (await netWorthAt(database, ws, asOf, rates.rates)).netWorthMinor };
        }),
      ),
  });

  const flows = useQuery({
    queryKey: ['flows', ws.workspaceId, thisMonth],
    queryFn: async () => {
      const cur = monthRange(thisMonth);
      const prev = monthRange(addMonths(thisMonth, -1));
      // The dashboard speaks for the owner: every book's spending and income together.
      const owner = ownerScope(ws);
      return {
        spending: sum(await categoryTotalsBetween(database, owner, 'expense', cur.from, cur.to, { billMonths: true })),
        income: sum(await categoryTotalsBetween(database, owner, 'income', cur.from, cur.to)),
        lastSpending: sum(await categoryTotalsBetween(database, owner, 'expense', prev.from, prev.to, { billMonths: true })),
      };
    },
  });

  // Reporting only: dead points are written off when a card is opened, never by looking at a summary.
  const expiring = useQuery({
    queryKey: ['points-expiring', ws.workspaceId, today],
    queryFn: () => expiringSoonAcross(database, ws, today),
  });

  if (accounts.isSuccess && money.length === 0) {
    return (
      <div className={SCREEN}>
        <LargeTitle title="Dashboard" />
        <Panel wide>
          <Empty>
            Start by adding your bank accounts and credit cards on the{' '}
            <Link to="/accounts" className="font-medium underline">
              Accounts
            </Link>{' '}
            page.
          </Empty>
        </Panel>
      </div>
    );
  }

  const nw = current.data?.result;
  const warnings = [
    ...(current.data?.rates.stale ?? []).map((c) => `${c} rate is out of date`),
    ...(nw?.missingRates ?? []).map((c) => `No ${c} rate — ${c} accounts excluded`),
    ...(expiring.data ?? []).map((row) => `${row.expiringSoon.toLocaleString('id-ID')} ${row.unit} on ${row.cardName} expire on ${row.nextExpiryOn}`),
  ];
  const maxAbs = Math.max(1, ...(trend.data ?? []).map((p) => Math.abs(p.value)));
  const cards = money.filter((a) => a.subtype === 'credit_card');

  return (
    <div className={SCREEN}>
      <LargeTitle title="Dashboard" />

      {/*
       * This and `/net-worth` are the only two screens in the app that lay out a real desktop grid, so the two
       * columns are the point rather than a convenience: the figure and the year that led to it on the left,
       * what the month has done and what the cards owe on the right. A phone stacks them in the same order.
       */}
      <div className="grid gap-4 md:grid-cols-[1.7fr_1fr]">
        <div>
          <Panel wide header="Net worth">
            <div data-testid="net-worth">
              {nw ? (
                <Hero minor={nw.netWorthBaseMinor} currency={ws.baseCurrency} />
              ) : (
                <p className="py-6 text-center text-[34px] leading-[40px] font-extrabold tracking-[-0.03em] text-[var(--ph-ink-3)]">…</p>
              )}
            </div>
          </Panel>

          {nw && (
            <InsetGroup wide>
              <InsetRow title="Assets" value={<Money minor={nw.assetsBaseMinor} currency={ws.baseCurrency} />} valueTone="ink" chevron={false} />
              <InsetRow title="Debts" value={<Money minor={nw.liabilitiesBaseMinor} currency={ws.baseCurrency} />} valueTone="alarm" chevron={false} />
              {/* The underlined text link becomes the row it always meant: the whole line is the way through. */}
              <InsetRow title="See the full picture" to="/net-worth" />
            </InsetGroup>
          )}

          {warnings.length > 0 && (
            <div className="mb-[18px]">
              {warnings.map((w) => (
                <p key={w} className="px-[4px] pb-[4px] text-[12.5px] leading-[16px] text-[var(--ph-warn)]">
                  {w}
                </p>
              ))}
            </div>
          )}

          <Panel wide header="Net worth, last 6 months">
            <ul className="space-y-[10px]">
              {(trend.data ?? []).map((point) => (
                <li key={point.month} className="grid grid-cols-[4.5rem_1fr_9rem] items-center gap-3 text-[13px] leading-[17px]">
                  <span className="text-[var(--ph-ink-3)]">
                    {new Date(`${point.month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}
                  </span>
                  <span className="block h-[7px] overflow-hidden bg-[var(--ph-track)]" style={{ borderRadius: 99 }}>
                    <span
                      className="block h-full"
                      style={{
                        width: `${Math.round((Math.abs(point.value) / maxAbs) * 100)}%`,
                        borderRadius: 99,
                        background: point.value < 0 ? 'var(--ph-alarm)' : 'var(--ph-tint)',
                      }}
                    />
                  </span>
                  <Money minor={point.value} currency={ws.baseCurrency} className="text-right text-[var(--ph-ink)]" />
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div>
          <InsetGroup wide header="This month">
            <InsetRow
              title="Spent"
              subtitle={flows.data ? <>Last month <Money minor={flows.data.lastSpending} currency={ws.baseCurrency} /></> : undefined}
              value={flows.data ? <Money minor={flows.data.spending} currency={ws.baseCurrency} /> : '…'}
              valueTone="alarm"
              chevron={false}
            />
            <InsetRow
              title="Income"
              value={flows.data ? <Money minor={flows.data.income} currency={ws.baseCurrency} /> : '…'}
              valueTone="ink"
              chevron={false}
            />
          </InsetGroup>

          {cards.length > 0 && (
            <InsetGroup wide header="Credit cards owed">
              {cards.map((card) => (
                /* The card's name was a link inside the line; now the line is the link, and it still lands on its transactions. */
                <InsetRow
                  key={card.id}
                  to="/transactions"
                  search={{ account: card.id }}
                  title={card.name}
                  value={<Money minor={displayAmount('liability', current.data?.balances[card.id] ?? 0)} currency={card.currency!} />}
                  valueTone="ink"
                />
              ))}
            </InsetGroup>
          )}
        </div>
      </div>
    </div>
  );
}
