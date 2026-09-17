import { addMonths, displayAmount, isoDate, lastNMonths, monthOf, monthRange } from '@expanses/core';
import { categoryTotalsBetween, expiringSoonAcross, nativeBalances, netWorthAt, ownerScope } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useApp } from '../../app/context';
import { isMoneyAccount, useAccounts, useResolveRates } from '../../lib/queries';
import { Card, cx, Empty, Money, PageHeader } from '../../ui';

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
      <div className="space-y-4">
        <PageHeader title="Dashboard" />
        <Card>
          <Empty>
            Start by adding your bank accounts and credit cards on the{' '}
            <Link to="/accounts" className="font-medium underline">
              Accounts
            </Link>{' '}
            page.
          </Empty>
        </Card>
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
    <div className="space-y-4">
      <PageHeader title="Dashboard" />
      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-xs text-slate-500">Net worth</span>
          <Link to="/net-worth" className="text-xs text-slate-600 underline">
            See the full picture
          </Link>
        </div>
        <div data-testid="net-worth" className="text-3xl font-semibold">
          {nw ? <Money minor={nw.netWorthBaseMinor} currency={ws.baseCurrency} /> : '…'}
        </div>
        {nw && (
          <div className="mt-2 flex gap-6 text-sm text-slate-600">
            <span>
              Assets <Money minor={nw.assetsBaseMinor} currency={ws.baseCurrency} />
            </span>
            <span>
              Debts <Money minor={nw.liabilitiesBaseMinor} currency={ws.baseCurrency} />
            </span>
          </div>
        )}
        {warnings.map((w) => (
          <p key={w} className="mt-2 text-xs text-amber-700">
            {w}
          </p>
        ))}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="text-xs text-slate-500">Spent this month</div>
          <div className="text-xl font-semibold">{flows.data ? <Money minor={flows.data.spending} currency={ws.baseCurrency} /> : '…'}</div>
          {flows.data && (
            <div className="text-xs text-slate-500">
              Last month <Money minor={flows.data.lastSpending} currency={ws.baseCurrency} />
            </div>
          )}
        </Card>
        <Card>
          <div className="text-xs text-slate-500">Income this month</div>
          <div className="text-xl font-semibold">{flows.data ? <Money minor={flows.data.income} currency={ws.baseCurrency} /> : '…'}</div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-600">Net worth, last 6 months</h2>
        <ul className="space-y-1">
          {(trend.data ?? []).map((point) => (
            <li key={point.month} className="grid grid-cols-[4.5rem_1fr_9rem] items-center gap-3 text-sm">
              <span className="text-slate-500">{new Date(`${point.month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })}</span>
              <div className="h-2 rounded bg-slate-100">
                <div className={cx('h-2 rounded', point.value < 0 ? 'bg-red-500' : 'bg-slate-800')} style={{ width: `${Math.round((Math.abs(point.value) / maxAbs) * 100)}%` }} />
              </div>
              <Money minor={point.value} currency={ws.baseCurrency} className="text-right" />
            </li>
          ))}
        </ul>
      </Card>

      {cards.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-600">Credit cards owed</h2>
          <ul className="divide-y divide-slate-100">
            {cards.map((card) => (
              <li key={card.id} className="flex justify-between py-2 text-sm">
                <Link to="/transactions" search={{ account: card.id }} className="hover:underline">
                  {card.name}
                </Link>
                <Money minor={displayAmount('liability', current.data?.balances[card.id] ?? 0)} currency={card.currency!} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
