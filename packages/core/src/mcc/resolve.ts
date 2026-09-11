import { DEFAULT_CATEGORY_MCCS } from '../categories/defaults';
import { containsKeyword } from '../text/keywords';

export type MccSource = 'typed' | 'memory' | 'bundled' | 'category';

/** A merchant pattern and its MCC. In merchant memory, a null MCC switches off bundled entries with the same pattern. */
export interface MerchantMcc {
  pattern: string;
  mcc: string | null;
}

export interface MccSources {
  typed: string | null;
  memory: MerchantMcc[];
  bundled: MerchantMcc[];
  categoryDefault: (categoryId: string) => string | null;
}

export const isMcc = (value: string) => /^\d{4}$/.test(value);

/** A four-digit code or an inclusive range such as 3000-3299. */
export function isMccSpec(value: string): boolean {
  const [start, end, ...rest] = value.split('-');
  if (rest.length > 0 || start === undefined || !isMcc(start)) return false;
  return end === undefined || (isMcc(end) && start <= end);
}

export function mccInRange(mcc: string, spec: string): boolean {
  const [start = '', end = start] = spec.split('-');
  return mcc >= start && mcc <= end;
}

const normalise = (pattern: string) => pattern.trim().toLowerCase();

/** The longest pattern found in the description as whole words; ties go to the earlier entry. */
function bestMatch(description: string, entries: readonly MerchantMcc[]): MerchantMcc | undefined {
  let best: MerchantMcc | undefined;
  for (const entry of entries) {
    if (!containsKeyword(description, entry.pattern)) continue;
    if (!best || normalise(entry.pattern).length > normalise(best.pattern).length) best = entry;
  }
  return best;
}

/** Effective MCC of a purchase line: typed, then merchant memory, then the bundled list, then the category default. */
export function resolveMcc(description: string, categoryId: string, sources: MccSources): { mcc: string | null; source: MccSource | null } {
  if (sources.typed) return { mcc: sources.typed, source: 'typed' };
  const remembered = bestMatch(description, sources.memory.filter((entry) => entry.mcc !== null));
  if (remembered) return { mcc: remembered.mcc as string, source: 'memory' };
  const ignored = new Set(sources.memory.filter((entry) => entry.mcc === null).map((entry) => normalise(entry.pattern)));
  const bundled = bestMatch(description, sources.bundled.filter((entry) => entry.mcc !== null && !ignored.has(normalise(entry.pattern))));
  if (bundled) return { mcc: bundled.mcc as string, source: 'bundled' };
  const fallback = sources.categoryDefault(categoryId);
  return fallback ? { mcc: fallback, source: 'category' } : { mcc: null, source: null };
}

/** A category's default MCC: the workspace override, else the built-in default for its key, else its parent's. */
export function categoryDefaultMcc(
  categoryId: string,
  categories: readonly { id: string; parentId: string | null; systemKey: string | null }[],
  overrides: Readonly<Record<string, string>>,
): string | null {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const seen = new Set<string>();
  for (let current = byId.get(categoryId); current && !seen.has(current.id); current = current.parentId ? byId.get(current.parentId) : undefined) {
    seen.add(current.id);
    const mcc = overrides[current.id] ?? (current.systemKey ? DEFAULT_CATEGORY_MCCS[current.systemKey] : undefined);
    if (mcc) return mcc;
  }
  return null;
}
