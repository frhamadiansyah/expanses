import { dayMonth, formatMinor, formatUnits, ordinal } from '@expanses/core';
import type { TemplateBuy, TradeTemplateRow } from '@expanses/db';
import type { Tone } from '../../ui/native/row';

/**
 * Where a monthly plan stands this month: due (its day has come and nothing is recorded from it), bought, not yet
 * (its day is still ahead, or it is a move, which nothing records), or paused.
 */
export type PlanState = 'due' | 'bought' | 'later' | 'paused';

export interface PlanLine {
  template: TradeTemplateRow;
  state: PlanState;
  title: string;
  subtitle: string;
  tone: Tone;
  /** The plan's figure, or what was bought this month once it was. */
  figure: string;
}

/** What a plan puts in each month: its money, or the units of an older plan kept by units. */
export function planFigure(template: Pick<TradeTemplateRow, 'amountMinor' | 'unitsMicro'>, currency: string): string {
  return template.amountMinor !== null ? formatMinor(template.amountMinor, currency) : `${formatUnits(template.unitsMicro ?? 0)} units`;
}

/**
 * The holding page's Monthly plan row: the one plan's money and day ("Rp 1.000.000 · 5th"), how many when there are
 * several, or None.
 */
export function planRowValue(plans: readonly Pick<TradeTemplateRow, 'amountMinor' | 'unitsMicro' | 'dayOfMonth' | 'active'>[], currency: string): string {
  if (plans.length === 0) return 'None';
  if (plans.length > 1) return `${plans.length} plans`;
  const plan = plans[0]!;
  return `${planFigure(plan, currency)} · ${ordinal(plan.dayOfMonth)}${plan.active ? '' : ' · paused'}`;
}

const ORDER: Record<PlanState, number> = { due: 0, later: 1, bought: 2, paused: 3 };

/**
 * Every plan as the Recurring page's Monthly buys lists it, the due ones first, then by day. The same rule as
 * `dueTemplates`: a buy plan is due once its day has come in the month and nothing is recorded against it.
 */
export function planLines(
  templates: readonly TradeTemplateRow[],
  bought: readonly TemplateBuy[],
  today: string,
  names: { holding: (accountId: string) => string; cash: (accountId: string) => string; currency: (accountId: string) => string },
): PlanLine[] {
  const day = Number(today.slice(8, 10));
  return templates
    .map((template): PlanLine => {
      const from = `from ${names.cash(template.cashAccountId)}`;
      const currency = names.currency(template.accountId);
      const title = template.kind === 'move' ? `Move to ${names.cash(template.accountId)}` : names.holding(template.accountId);
      const buy = bought.find((row) => row.templateId === template.id);
      if (buy) return { template, state: 'bought', title, subtitle: `Bought · ${dayMonth(buy.occurredOn)}`, tone: 'gain', figure: formatMinor(buy.grossMinor, currency) };
      const figure = planFigure(template, currency);
      if (!template.active) return { template, state: 'paused', title, subtitle: `Paused · ${from}`, tone: 'ink-3', figure };
      if (template.kind === 'buy' && template.dayOfMonth <= day) {
        return { template, state: 'due', title, subtitle: `Due on the ${ordinal(template.dayOfMonth)} · ${from}`, tone: 'warn', figure };
      }
      return { template, state: 'later', title, subtitle: `On the ${ordinal(template.dayOfMonth)} · ${from}`, tone: 'ink-3', figure };
    })
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || a.template.dayOfMonth - b.template.dayOfMonth);
}
