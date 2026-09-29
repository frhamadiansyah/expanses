import type { CategoryUsage, CategoryUse } from '@expanses/db';
import type { ResolvedNeed } from '@expanses/core';

/**
 * The quiet line under "Spending" on a category's page: where its essential-or-lifestyle answer comes from — a mark
 * of its own or a parent's. None at all says nothing: the control already reads Essential, and the ⓘ says why.
 */
export function needCaption(source: ResolvedNeed['source'], parentName: string | null): string | undefined {
  if (source === 'yours') return 'Set here';
  if (source === 'parent') return parentName ? `Follows ${parentName}` : 'Follows its parent';
  return undefined;
}

/** The line under "Merchant category code": what the code means, and where it came from. Nothing at all when there is no code. */
export function mccCaption(
  card: { mcc: string | null; source: 'yours' | 'default' | 'parent' | null },
  meaning: string | null,
  parentName: string | null,
): string | undefined {
  if (!card.mcc) return undefined;
  const from = card.source === 'yours' ? 'set here' : card.source === 'parent' ? `from ${parentName ?? 'its parent'}` : 'built in';
  return meaning ? `${meaning} · ${from}` : from.charAt(0).toUpperCase() + from.slice(1);
}

const USE_WORDS: Record<Exclude<CategoryUse, 'subcategories'>, [string, string]> = {
  transactions: ['a transaction', 'transactions'],
  drafts: ['a draft waiting for review', 'drafts waiting for review'],
  budgets: ['a budget', 'budgets'],
  bills: ['a recurring bill', 'recurring bills'],
  'event plans': ['an event plan', 'event plans'],
  'card rules': ['a card earning rule', 'card earning rules'],
};

/**
 * Why a greyed "Delete category" cannot be taken, under it in the ⋯ menu: its subcategories by name (they are the
 * thing to move or delete first), then anything else that uses it, or that it is built in. Undefined when it can go.
 */
export function deleteBlockedBy(usage: Pick<CategoryUsage, 'uses' | 'builtIn'>, subcategoryNames: readonly string[]): string | undefined {
  if (usage.builtIn) return 'Built in, so it would come back. Archive it instead.';
  const lines: string[] = [];
  const subs = usage.uses.find((u) => u.use === 'subcategories');
  if (subs) {
    const names = subcategoryNames.length > 0 ? `: ${subcategoryNames.join(', ')}` : '';
    lines.push(subs.count === 1 ? `Has a subcategory${names}.` : `Has ${subs.count} subcategories${names}.`);
  }
  const other = usage.uses.filter((u): u is { use: Exclude<CategoryUse, 'subcategories'>; count: number } => u.use !== 'subcategories');
  if (other.length > 0) {
    const parts = other.map(({ use, count }) => (count === 1 ? USE_WORDS[use][0] : `${count} ${USE_WORDS[use][1]}`));
    const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
    lines.push(`Used by ${list}.`);
  }
  return lines.length > 0 ? lines.join(' ') : undefined;
}
