import type { AssetValueRow, NetWorthPoint, TradeTemplateRow } from '@expanses/db';

export interface AttentionItem {
  key: string;
  tone: 'warn' | 'info';
  text: string;
  action: string;
  to: '/net-worth/assets' | '/net-worth/trades';
}

const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** What the owner should deal with: prices that have gone stale and monthly buys waiting to be recorded. */
export function attentionItems(values: AssetValueRow[], dueTemplates: TradeTemplateRow[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const value of values) {
    if (!value.stale) continue;
    if (value.mode === 'market' && value.unitsMicro === 0) continue;
    const what = value.mode === 'market' ? 'price' : 'estimate';
    const text = value.asOf ? `${value.name}: ${what} last updated ${shortDate(value.asOf)}` : `${value.name}: no ${what} yet, showing what you paid`;
    items.push({ key: `stale-${value.accountId}`, tone: 'warn', text, action: 'Update', to: '/net-worth/assets' });
  }
  for (const template of dueTemplates) {
    const name = values.find((value) => value.accountId === template.accountId)?.name ?? 'a holding';
    items.push({ key: `due-${template.id}`, tone: 'warn', text: `Monthly buy of ${name} is due`, action: 'Record', to: '/net-worth/trades' });
  }
  return items;
}

/** Change in net worth against the point this many months before the last one. */
export function deltaSince(points: NetWorthPoint[], monthsBack: number): number | null {
  if (points.length === 0) return null;
  const index = points.length - 1 - monthsBack;
  if (index < 0) return null;
  return points[points.length - 1]!.netWorthMinor - points[index]!.netWorthMinor;
}

/** Months from January of the last point's year, for the "since January" figure. */
export function monthsSinceJanuary(points: NetWorthPoint[]): number | null {
  const last = points[points.length - 1];
  if (!last) return null;
  const january = `${last.month.slice(0, 4)}-01`;
  const index = points.findIndex((point) => point.month === january);
  return index === -1 ? null : points.length - 1 - index;
}
