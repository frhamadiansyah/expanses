import { formatMinor, type EarnRule } from '@expanses/core';
import type { StatementLine } from '@expanses/db';
import { formatPoints } from './format-points';
import { isCharge, type LineCover, showsPaid } from './statement-cover';

/*
 * The Mac card page in the v1 look (owner 2026-11-23) as words: the note on its statement table's heading, and the
 * points card's earn rate. Each is read from the phone's own rules (`showsPaid`, the card's earning rules), so the two
 * pages never say different things.
 */

/**
 * The statement table's note: "8 rows · 4 paid" — every row drawn, and how many of its charges show paid (the green ✓).
 * All statements together have no one cover to read, so they say the rows alone.
 */
export function statementRowsNote(lines: readonly StatementLine[], cover: ReadonlyMap<string, LineCover>, all: boolean): string {
  const rows = `${lines.length} ${lines.length === 1 ? 'row' : 'rows'}`;
  if (all) return rows;
  const charges = lines.filter((line) => isCharge(line) || line.feeSettled);
  if (charges.length === 0) return rows;
  const paid = charges.filter((line) => showsPaid(line, cover) || line.feeSettled).length;
  return `${rows} · ${paid} paid`;
}

type RateRule = Pick<EarnRule, 'priority' | 'stackable' | 'match' | 'rateNum' | 'rateDen'>;

/** A rule that earns on every purchase: no category, merchant, code, currency, origin or day picked out. */
const earnsOnAll = (rule: RateRule) => {
  const m = rule.match;
  return !rule.stackable && !m.categoryIds?.length && !m.merchantPatterns?.length && !m.mccs?.length && !m.currencies?.length && !m.origin && !m.daysOfWeek?.length;
};

/**
 * The card's base earn rate, as v1 prints it: "Rp 4.000 = 1 mile", or "2 points per Rp 5.000" when a step earns more
 * than one. The base is the rule that earns on every purchase, the last to run (lowest priority) when there are several;
 * null when no rule earns on everything (a card whose rules all pick categories out) or for cashback, which earns money.
 */
export function earnRateText(rules: readonly RateRule[], unit: string, currency: string): string | null {
  if (unit === 'cashback') return null;
  const base = rules.filter(earnsOnAll).sort((a, b) => a.priority - b.priority)[0];
  if (!base || base.rateNum <= 0 || base.rateDen <= 0) return null;
  const one = unit === 'miles' ? 'mile' : unit === 'points' ? 'point' : unit;
  if (base.rateNum === 1) return `${formatMinor(base.rateDen, currency)} = 1 ${one}`;
  return `${formatPoints(base.rateNum)} ${unit} per ${formatMinor(base.rateDen, currency)}`;
}
