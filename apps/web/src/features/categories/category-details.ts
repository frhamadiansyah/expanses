import type { ResolvedNeed } from '@expanses/core';

/**
 * The quiet line under "Counts as" on a category's page: where its essential-or-lifestyle answer comes from.
 * A mark of its own, a parent's, or none at all — which counts as essential.
 */
export function needCaption(source: ResolvedNeed['source'], parentName: string | null): string {
  if (source === 'yours') return 'Marked by you';
  if (source === 'parent') return parentName ? `Follows ${parentName}` : 'Follows its parent';
  return 'Not marked, so essential';
}

/** The line under "Card MCC": what the code means, and where it came from. Nothing at all when there is no code. */
export function mccCaption(
  card: { mcc: string | null; source: 'yours' | 'default' | 'parent' | null },
  meaning: string | null,
  parentName: string | null,
): string | undefined {
  if (!card.mcc) return undefined;
  const from = card.source === 'yours' ? 'set by you' : card.source === 'parent' ? `from ${parentName ?? 'its parent'}` : 'built in';
  return meaning ? `${meaning} · ${from}` : from.charAt(0).toUpperCase() + from.slice(1);
}
