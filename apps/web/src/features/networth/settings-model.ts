import { type AssetKind, hartaLabel, type PlanGroup } from '@expanses/core';
import { PLAN_GROUP_ORDER } from './labels';

/**
 * The sides of the plan a thing can sensibly count on, by what it is. A house is lived in or rented out; it is never
 * cash or money owed. A broker's cash is cash, or money waiting to be invested. The side it counts on today is always
 * offered, whatever it is, so a choice made before this narrowing still reads back as itself.
 */
const GROUPS_BY_KIND: Record<AssetKind, readonly PlanGroup[]> = {
  cash: ['liquid', 'invest'],
  fund: ['invest', 'liquid'],
  stock: ['invest'],
  bond: ['invest', 'liquid'],
  gold: ['invest', 'use'],
  property: ['use', 'invest'],
  vehicle: ['use', 'invest'],
  other: ['use', 'invest', 'liquid', 'owed'],
};

export function planGroupChoices(kind: AssetKind | null | undefined, subtype: string | undefined, current: PlanGroup): PlanGroup[] {
  const allowed = new Set<PlanGroup>(subtype === 'receivable' ? ['owed'] : kind ? GROUPS_BY_KIND[kind] : PLAN_GROUP_ORDER);
  allowed.add(current);
  return PLAN_GROUP_ORDER.filter((group) => allowed.has(group));
}

/** How a thing's income is taxed, in the few words a row has room for; what each means sits behind the row's ⓘ. */
export const TAX_TREATMENT_LABELS: Record<'final' | 'not_object' | 'ordinary', string> = {
  final: 'Final',
  not_object: 'Not a tax object',
  ordinary: 'Ordinary',
};

/** The code a thing files under, with the table's name for it: "0102 · Tabungan". Empty says the usual code is used. */
export function codeLine(code: string | null | undefined): string {
  const typed = code?.trim() ?? '';
  if (typed === '') return 'Usual code';
  const label = hartaLabel(typed);
  return label ? `${typed} · ${label}` : typed;
}

/**
 * What to save for the tax report's details when one field is left: every field the reader typed that reads well, and
 * the stored answer for any that does not — so one field still being fixed never holds back the rest.
 */
export function fieldsToSave(stored: Readonly<Record<string, string>>, typed: Readonly<Record<string, string>>, wrong: ReadonlySet<string>): Record<string, string> {
  const out: Record<string, string> = { ...stored };
  for (const [key, value] of Object.entries(typed)) if (!wrong.has(key)) out[key] = value;
  for (const key of wrong) {
    if (key in stored) out[key] = stored[key]!;
    else delete out[key];
  }
  return out;
}
