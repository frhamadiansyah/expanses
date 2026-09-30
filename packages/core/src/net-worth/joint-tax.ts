import type { CoretaxInputs } from '../coretax/rows';
import type { ItemSummary } from './summary';

/*
 * The joint tax report (joint-net-worth spec §5.2 `tax`, §8.4). With one tax ID, each item's summary carries its slice of
 * the owner's `coretaxInputsFor` for the latest finished tax year; a phone's joint report is its own inputs plus every
 * received slice for the year it shows. An item whose year-end has not reached this phone is named as waiting.
 */

/**
 * One item's rows of the harta and utang lists, in the shape `CoretaxInputs` has. Once sent, each row's `accountId` is
 * the item's id (`itemIdOf`), never the owner's local account id, and a foreign holding carries no `purchases` (each
 * buy is a private line's amount).
 */
export type CoretaxRowPart = CoretaxInputs;

/** What an item's summary carries for the tax report: its slice for one tax year. Null outside `joint`. */
export type ItemTax = { taxYear: number; part: CoretaxRowPart } | null;

export interface JointWaiting {
  /** The owner's member id. */
  owner: string;
  name: string;
}

/** Whether a received item's summary holds its row for `taxYear` and its value on 31 December of it. */
export function yearEndReached(item: Pick<ItemSummary, 'tax' | 'monthEnds'>, taxYear: number): boolean {
  // A received summary is another phone's JSON: a malformed one waits rather than breaking the report.
  if (item.tax?.taxYear !== taxYear || !item.tax.part || typeof item.tax.part !== 'object') return false;
  return Array.isArray(item.monthEnds) && item.monthEnds.some((m) => m?.month === `${taxYear}-12`);
}

const rowsOf = <T>(rows: T[] | undefined): T[] => (Array.isArray(rows) ? rows : []);

/**
 * This phone's own inputs plus every received item's slice for `taxYear`. An item with no slice for that year, or whose
 * chart has no December of it yet (its owner's phone has not been online since), goes in `waiting` instead — the report
 * is then incomplete, never quietly short.
 */
export function jointCoretaxInputs(
  own: CoretaxInputs,
  received: readonly ItemSummary[],
  taxYear: number,
): { inputs: CoretaxInputs; waiting: JointWaiting[] } {
  const inputs: CoretaxInputs = {
    cash: [...own.cash],
    holdings: [...own.holdings],
    estimated: [...own.estimated],
    receivables: [...own.receivables],
    debts: [...own.debts],
  };
  const waiting: JointWaiting[] = [];
  for (const item of received) {
    if (!yearEndReached(item, taxYear)) {
      waiting.push({ owner: item.owner, name: item.name });
      continue;
    }
    const part = item.tax!.part;
    inputs.cash.push(...rowsOf(part.cash));
    inputs.holdings.push(...rowsOf(part.holdings));
    inputs.estimated.push(...rowsOf(part.estimated));
    inputs.receivables.push(...rowsOf(part.receivables));
    inputs.debts.push(...rowsOf(part.debts));
  }
  return { inputs, waiting };
}
