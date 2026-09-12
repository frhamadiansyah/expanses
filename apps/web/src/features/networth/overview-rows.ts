import { formatMinor } from '@expanses/core';
import type { AssetValueRow, GoalPlanRow, IdleCashRow, NetWorthPoint, TradeTemplateRow } from '@expanses/db';

export interface AttentionItem {
  key: string;
  tone: 'warn' | 'info';
  text: string;
  action: string;
  to: '/net-worth/assets' | '/net-worth/trades' | '/net-worth/goals';
}

const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** What the owner should deal with: stale prices, monthly buys waiting, goals behind, and cash parked to be invested. */
export function attentionItems(
  values: AssetValueRow[],
  dueTemplates: TradeTemplateRow[],
  goalPlans: GoalPlanRow[] = [],
  idleCash: IdleCashRow[] = [],
): AttentionItem[] {
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
  for (const plan of goalPlans) {
    if (plan.status === 'behind') {
      items.push({ key: `goal-${plan.goalId}`, tone: 'warn', text: `${plan.goal.name} needs more each month than you have set up`, action: 'Review', to: '/net-worth/goals' });
    }
    if (plan.earmarkWarning) {
      items.push({ key: `earmark-${plan.goalId}`, tone: 'warn', text: `${plan.goal.name}: ${plan.earmarkWarning}`, action: 'Review', to: '/net-worth/goals' });
    }
  }
  for (const row of idleCash) {
    // Money put at a broker was meant to be invested; while it sits as cash it earns nothing.
    if (row.planGroup !== 'invest' || row.amountMinor <= 0) continue;
    items.push({
      key: `idle-${row.accountId}`,
      tone: 'info',
      text: `${formatMinor(row.amountMinor, row.currency)} has been waiting in ${row.name} since ${shortDate(row.since)}`,
      action: 'Buy',
      to: '/net-worth/trades',
    });
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
