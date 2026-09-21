import { type PlanGroup, sumToBase } from '@expanses/core';
import { type AccountRow, type AssetProfileRow, type AssetValueRow, pocketParentIds } from '@expanses/db';
import { CORETAX_SECTION_LABELS, METHOD_LABELS, PLAN_GROUP_LABELS, PLAN_GROUP_ORDER } from './labels';

export interface AssetRow {
  accountId: string;
  name: string;
  planGroup: PlanGroup;
  valueMinor: number;
  currency: string;
  /** How the value was worked out, for the tag on the row. */
  method: string;
  /** Coretax code and table, or an empty string when the asset has no profile yet. */
  coretax: string;
  stale: boolean;
  /** A holding that has been sold: nothing left, but kept for gains and the tax report. */
  sold: boolean;
  /** An automated deposit with a proposal waiting on its page. */
  due: boolean;
  /**
   * How many pockets this row adds up, or null for an ordinary asset. A row with pockets is their account: its
   * `valueMinor` is their ≈ total in the base currency, for display only — no total ever re-adds it.
   */
  pockets: number | null;
  /** The rates the row could not be added up without (a row with pockets only). */
  missing: string[];
}

export interface AssetGroup {
  group: PlanGroup;
  label: string;
  /** The group in the base currency, or null when a rate is missing — never the sum of the rest. */
  totalMinor: number | null;
  missing: string[];
  rows: AssetRow[];
}

function toRow(value: AssetValueRow, profile: AssetProfileRow | undefined, due: boolean): AssetRow {
  const section = profile?.coretaxSection;
  return {
    accountId: value.accountId,
    name: value.name,
    planGroup: value.planGroup,
    valueMinor: value.valueMinor,
    currency: value.currency,
    method: METHOD_LABELS[value.mode],
    coretax: profile?.coretaxCode && section ? `${profile.coretaxCode} · ${CORETAX_SECTION_LABELS[section] ?? section}` : '',
    stale: value.stale,
    sold: value.mode === 'market' && value.unitsMicro === 0,
    due,
    pockets: null,
    missing: [],
  };
}

export interface AssetGrouping {
  accounts: readonly Pick<AccountRow, 'id' | 'name' | 'parentId' | 'kind'>[];
  baseCurrency: string;
  ratesToBase: Readonly<Record<string, number>>;
  /** The deposits with a proposal waiting (spec §7). Every other caller leaves it out, and nothing is due. */
  due?: ReadonlySet<string>;
}

const isSold = (value: AssetValueRow) => value.mode === 'market' && value.unitsMicro === 0;

/**
 * Assets in balance-sheet order. Sold holdings are listed but never counted in a total. An account with pockets is
 * one row, where its first pocket stood, at their ≈ total. Every total is converted into the base currency through
 * `sumToBase` over the underlying values — each pocket on its own, never the rounded parent figure — and is null,
 * naming the rate, when one is missing.
 */
export function groupAssets(values: AssetValueRow[], profiles: AssetProfileRow[], { accounts, baseCurrency, ratesToBase, due = new Set() }: AssetGrouping): AssetGroup[] {
  const profileByAccount = new Map(profiles.map((profile) => [profile.accountId, profile]));
  const parents = pocketParentIds(accounts);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const parentOf = new Map(accounts.filter((a) => a.parentId && parents.has(a.parentId) && byId.has(a.parentId)).map((a) => [a.id, a.parentId!]));
  const pocketsUnder = new Map<string, AssetValueRow[]>();
  for (const value of values) {
    const parentId = parentOf.get(value.accountId);
    if (parentId) pocketsUnder.set(parentId, [...(pocketsUnder.get(parentId) ?? []), value]);
  }

  const rows: AssetRow[] = [];
  for (const value of values) {
    const parentId = parentOf.get(value.accountId);
    if (!parentId) {
      rows.push(toRow(value, profileByAccount.get(value.accountId), due.has(value.accountId)));
      continue;
    }
    if (rows.some((row) => row.accountId === parentId)) continue;
    const pockets = pocketsUnder.get(parentId)!;
    const total = sumToBase({ amounts: pockets.map((p) => ({ minor: p.valueMinor, currency: p.currency })), baseCurrency, ratesToBase });
    rows.push({
      accountId: parentId,
      name: byId.get(parentId)!.name,
      planGroup: value.planGroup,
      valueMinor: total.totalMinor ?? 0,
      currency: baseCurrency,
      method: 'Pockets',
      coretax: 'Each pocket files its own row',
      stale: false,
      sold: false,
      // A deposit never holds pockets, so a row of pockets is never due.
      due: false,
      pockets: pockets.length,
      missing: total.missing,
    });
  }

  return PLAN_GROUP_ORDER.map((group) => {
    const groupRows = rows.filter((row) => row.planGroup === group);
    const counted = values.filter((value) => groupOf(value, parentOf, rows) === group && !isSold(value));
    const total = sumToBase({ amounts: counted.map((value) => ({ minor: value.valueMinor, currency: value.currency })), baseCurrency, ratesToBase });
    return { group, label: PLAN_GROUP_LABELS[group], totalMinor: total.totalMinor, missing: total.missing, rows: groupRows };
  }).filter((group) => group.rows.length > 0);
}

/** The group a value counts in: its own, or — for a pocket — the group its account's row is drawn in. */
function groupOf(value: AssetValueRow, parentOf: ReadonlyMap<string, string>, rows: readonly AssetRow[]): PlanGroup {
  const parentId = parentOf.get(value.accountId);
  return parentId ? rows.find((row) => row.accountId === parentId)!.planGroup : value.planGroup;
}

export const soldRows = (groups: AssetGroup[]): AssetRow[] => groups.flatMap((group) => group.rows.filter((row) => row.sold));
export const liveGroups = (groups: AssetGroup[]): AssetGroup[] =>
  groups.map((group) => ({ ...group, rows: group.rows.filter((row) => !row.sold) })).filter((group) => group.rows.length > 0);
/** Every group added up, or null with every missing rate named (sorted, once each) when any group has no total. */
export function totalOf(groups: readonly { totalMinor: number | null; missing: readonly string[] }[]): { totalMinor: number | null; missing: string[] } {
  const missing = [...new Set(groups.flatMap((group) => group.missing))].sort();
  if (missing.length > 0 || groups.some((group) => group.totalMinor === null)) return { totalMinor: null, missing };
  return { totalMinor: groups.reduce((total, group) => total + group.totalMinor!, 0), missing: [] };
}
export const staleRows = (groups: AssetGroup[]): AssetRow[] => groups.flatMap((group) => group.rows.filter((row) => row.stale && !row.sold));

/** What the row says under its name: how it is valued, its tax code, and whether it needs attention. */
export function rowSubtitle(row: AssetRow): string {
  return [row.method, row.coretax, row.stale && !row.sold ? 'Update price' : null, row.sold ? 'Sold' : null, row.due ? 'Due' : null]
    .filter(Boolean)
    .join(' · ');
}
