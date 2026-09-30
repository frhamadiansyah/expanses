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

/*
 * A received slice is another phone's JSON. Each row is checked for what the row builders read, so a malformed one sends
 * its item to `waiting` rather than throwing in `coretaxRows` or drawing NaN on a row of the return.
 */
type Row = Record<string, unknown>;
const isObject = (v: unknown): v is Row => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isFields = (v: unknown) => isObject(v) && Object.values(v).every(isString);
const isBase = (r: Row) => isString(r.accountId) && isString(r.name) && isString(r.code) && isString(r.currency);
const isBucket = (v: unknown) => isObject(v) && isNumber(v.unitsMicro) && isNumber(v.costMinor);

const ROW_CHECKS: Record<keyof CoretaxInputs, (r: Row) => boolean> = {
  cash: (r) => isBase(r) && isNumber(r.balanceMinor) && isFields(r.fields),
  receivables: (r) => isBase(r) && isNumber(r.balanceMinor) && isFields(r.fields),
  holdings: (r) =>
    isBase(r) &&
    isNumber(r.priceMicro) &&
    isFields(r.fields) &&
    isObject(r.byYear) &&
    Object.values(r.byYear).every(isBucket) &&
    // A sent slice never carries purchases; a note built from one would be another phone's private lines.
    r.purchases === undefined,
  estimated: (r) => isBase(r) && isNumber(r.costMinor) && isNumber(r.valueMinor) && isFields(r.fields),
  debts: (r) => isBase(r) && isNumber(r.balanceMinor) && (r.note === null || isString(r.note)),
};

const SECTIONS = Object.keys(ROW_CHECKS) as (keyof CoretaxInputs)[];

/** Whether a received slice is well formed: every section an array (or absent) of rows the builders can read. */
function wellFormed(part: unknown): part is CoretaxRowPart {
  if (!isObject(part)) return false;
  return SECTIONS.every((section) => {
    const rows = part[section];
    return rows === undefined || (Array.isArray(rows) && rows.every((row) => isObject(row) && ROW_CHECKS[section](row)));
  });
}

/** Whether a received item's summary holds its row for `taxYear` and its value on 31 December of it. */
export function yearEndReached(item: Pick<ItemSummary, 'tax' | 'monthEnds'>, taxYear: number): boolean {
  if (!isObject(item.tax) || item.tax.taxYear !== taxYear || !wellFormed(item.tax.part)) return false;
  return Array.isArray(item.monthEnds) && item.monthEnds.some((m) => isObject(m) && m.month === `${taxYear}-12`);
}

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
    inputs.cash.push(...(part.cash ?? []));
    inputs.holdings.push(...(part.holdings ?? []));
    inputs.estimated.push(...(part.estimated ?? []));
    inputs.receivables.push(...(part.receivables ?? []));
    inputs.debts.push(...(part.debts ?? []));
  }
  return { inputs, waiting };
}
