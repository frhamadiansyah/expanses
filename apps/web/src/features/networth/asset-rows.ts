import type { PlanGroup } from '@expanses/core';
import type { AssetProfileRow, AssetValueRow } from '@expanses/db';
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
}

export interface AssetGroup {
  group: PlanGroup;
  label: string;
  totalMinor: number;
  rows: AssetRow[];
}

function toRow(value: AssetValueRow, profile: AssetProfileRow | undefined): AssetRow {
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
  };
}

/** Assets in balance-sheet order. Sold holdings are listed but never counted in a total. */
export function groupAssets(values: AssetValueRow[], profiles: AssetProfileRow[]): AssetGroup[] {
  const profileByAccount = new Map(profiles.map((profile) => [profile.accountId, profile]));
  const rows = values.map((value) => toRow(value, profileByAccount.get(value.accountId)));
  return PLAN_GROUP_ORDER.map((group) => {
    const groupRows = rows.filter((row) => row.planGroup === group);
    return {
      group,
      label: PLAN_GROUP_LABELS[group],
      totalMinor: groupRows.filter((row) => !row.sold).reduce((total, row) => total + row.valueMinor, 0),
      rows: groupRows,
    };
  }).filter((group) => group.rows.length > 0);
}

export const soldRows = (groups: AssetGroup[]): AssetRow[] => groups.flatMap((group) => group.rows.filter((row) => row.sold));
export const liveGroups = (groups: AssetGroup[]): AssetGroup[] =>
  groups.map((group) => ({ ...group, rows: group.rows.filter((row) => !row.sold) })).filter((group) => group.rows.length > 0);
export const totalOf = (groups: AssetGroup[]): number => groups.reduce((total, group) => total + group.totalMinor, 0);
export const staleRows = (groups: AssetGroup[]): AssetRow[] => groups.flatMap((group) => group.rows.filter((row) => row.stale && !row.sold));
