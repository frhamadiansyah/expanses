import { monthRange } from '@expanses/core';
import { categoryTotalsIn } from '@expanses/db';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../app/context';
import { useAccounts } from '../../lib/queries';
import { Card, Money } from '../../ui';
import { categoryColour } from './category-colours';

const share = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * Where the month's income went: one band per category, drawn in proportion, with what was kept at the end.
 *
 * This is the question a ring cannot answer — a ring shows how spending divides, not how much of what
 * came in it took. It needs width to read, so it is shown from md up and left off a phone.
 */
export function IncomeFlow({ month }: { month: string }) {
  const { database, ws } = useApp();
  const accounts = useAccounts().data ?? [];
  const { from, to } = monthRange(month);
  const spending = useQuery({
    queryKey: ['category-totals', ws.workspaceId, ws.bookId ?? null, 'expense', month],
    queryFn: () => categoryTotalsIn(database, ws, 'expense', from, to, { billMonths: true }),
  });
  const income = useQuery({
    queryKey: ['category-totals', ws.workspaceId, ws.bookId ?? null, 'income', month],
    queryFn: () => categoryTotalsIn(database, ws, 'income', from, to),
  });

  const nameOf = (id: string) => accounts.find((a) => a.id === id)?.name ?? 'Uncategorised';
  // Both sides read in the workspace's own currency, so the bands and what was kept are the same money.
  const currency = spending.data?.currency ?? ws.baseCurrency;
  const bands = [...(spending.data?.rows ?? [])]
    .map((row) => ({ id: row.accountId, name: nameOf(row.accountId), minor: row.amountBaseMinor }))
    .sort((a, b) => b.minor - a.minor)
    .slice(0, 10);
  const spent = (spending.data?.rows ?? []).reduce((sum, row) => sum + row.amountBaseMinor, 0);
  const earned = (income.data?.rows ?? []).reduce((sum, row) => sum + row.amountBaseMinor, 0);
  if (spent === 0 && earned === 0) return null;

  // The drawing is sized by what came in, so a month that overspends visibly runs past its income.
  const scale = Math.max(earned, spent);
  const height = Math.max(180, bands.length * 34);
  const width = 640;
  const leftX = 128;
  const rightX = 360;
  const inHeight = (earned / scale) * (height - 24);
  let y = 12;

  return (
    <Card>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Income → where it went</h2>
        <p className="text-xs text-slate-500">
          Kept <b className={spent <= earned ? 'font-semibold text-emerald-700' : 'font-semibold text-red-700'}>{share(earned - spent, earned)}%</b> of{' '}
          <Money minor={earned} currency={currency} />
        </p>
      </div>
      <svg viewBox={`0 0 ${width} ${height + 24}`} className="w-full" role="img" aria-label={`Of ${earned / 100} earned, ${spent / 100} was spent across ${bands.length} categories`}>
        <rect x={leftX - 11} y={12} width={11} height={Math.max(4, inHeight)} rx={3} className="fill-slate-900" />
        <text x={4} y={12 + inHeight / 2} className="fill-slate-700 text-[11px] font-semibold">
          Income
        </text>
        <text x={4} y={12 + inHeight / 2 + 13} className="fill-slate-500 text-[10px]">
          {new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(earned / 100)}
        </text>
        {bands.map((band) => {
          const thickness = Math.max(3, (band.minor / scale) * (height - 24));
          const top = y;
          y += thickness + 4;
          const fromY = 12 + (top / height) * inHeight + thickness / 2;
          const toY = top + thickness / 2;
          const colour = categoryColour(band.id);
          return (
            <g key={band.id}>
              <path
                d={`M ${leftX} ${fromY} C ${(leftX + rightX) / 2} ${fromY}, ${(leftX + rightX) / 2} ${toY}, ${rightX} ${toY}`}
                stroke={colour}
                strokeWidth={thickness}
                fill="none"
                opacity={0.5}
              />
              <rect x={rightX} y={top} width={9} height={thickness} rx={2} fill={colour} />
              <text x={rightX + 16} y={toY + 4} className="fill-slate-700 text-[11px]">
                {band.name}
                <tspan className="fill-slate-500"> · {share(band.minor, spent)}%</tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </Card>
  );
}
