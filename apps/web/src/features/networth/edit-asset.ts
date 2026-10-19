import { type CoretaxProblem, type CoretaxSection, validateCoretaxFields } from '@expanses/core';
import { type AcquiredParts, acquiredOn, type DatePrecision } from './acquired';

export interface AssetEditStart {
  name: string;
  /** Null for a holding dated by its purchases, whose Edit screen does not ask when it was acquired. */
  acquired: AcquiredParts | null;
  section: CoretaxSection | null;
  fields: Record<string, string>;
}

export interface AssetEditPlan {
  /** The new name, or null when it did not change. */
  rename: string | null;
  /** The new acquired day, or null when it did not change. */
  acquired: { on: string; precision: DatePrecision } | null;
  /** The tax report's fields to save, emptied ones dropped, or null when none changed. */
  fields: Record<string, string> | null;
}

const same = (a: AcquiredParts, b: AcquiredParts) => a.year.trim() === b.year.trim() && a.month === b.month && a.day === b.day;

/** Only the filled fields, trimmed, so a field emptied is a field removed and "  " is never kept. */
function filled(fields: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields)
      .map(([key, value]) => [key, value.trim()] as const)
      .filter(([, value]) => value !== ''),
  );
}

/** Field problems, by key, for the rows to show under themselves. */
export function editProblems(section: CoretaxSection | null, fields: Record<string, string>): CoretaxProblem[] {
  return section ? validateCoretaxFields(section, fields) : [];
}

/**
 * What Save on an asset's Edit screen writes: only what changed. Throws with a message meant for the screen — an
 * empty name, an acquired day that does not hold, or a tax field that does not read well (it names the first).
 */
export function planAssetEdit(start: AssetEditStart, typed: AssetEditStart, today: string): AssetEditPlan {
  const name = typed.name.trim();
  if (!name) throw new Error('Give this asset a name');

  let acquired: AssetEditPlan['acquired'] = null;
  if (typed.acquired && !(start.acquired && same(start.acquired, typed.acquired))) acquired = acquiredOn(typed.acquired, today);

  const problems = editProblems(typed.section, typed.fields);
  if (problems.length > 0) throw new Error(problems[0]!.message);
  const before = filled(start.fields);
  const after = filled(typed.fields);
  const fields = JSON.stringify(before) === JSON.stringify(after) ? null : after;

  return { rename: name === start.name ? null : name, acquired, fields };
}
