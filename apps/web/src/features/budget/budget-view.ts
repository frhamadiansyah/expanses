import type { BudgetLine } from '@expanses/core';

/*
 * What the Budget page draws, worked out from the sheet: which lines are over, which are capped and how they fold,
 * what no cap covers, and how the take-home divides. Pure, so the arithmetic is tested apart from the page.
 */

/** Days left in the month, today counted; null for a month already past. A month still to come has all of its days. */
export function daysLeft(month: string, today: string): number | null {
  const current = today.slice(0, 7);
  if (month < current) return null;
  const [year, monthNo] = month.split('-').map(Number);
  const length = new Date(Date.UTC(year!, monthNo!, 0)).getUTCDate();
  if (month > current) return length;
  return length - Number(today.slice(8, 10)) + 1;
}

/** Every line of the tree, parents before their children. */
export function flatten(lines: readonly BudgetLine[]): BudgetLine[] {
  return lines.flatMap((line) => [line, ...flatten(line.children)]);
}

export function findLine(lines: readonly BudgetLine[], id: string): BudgetLine | undefined {
  return flatten(lines).find((line) => line.id === id);
}

/** How much of its cap a line has used, 0 upwards. A cap of nothing with anything spent is fully used. */
export function usedShare(line: BudgetLine): number {
  if (line.capMinor === null) return 0;
  if (line.capMinor <= 0) return line.totalMinor > 0 ? 1 : 0;
  return line.totalMinor / line.capMinor;
}

/** What a line spent that no cap on it or above it covers: nothing at all once the line itself is capped. */
export function uncoveredMinor(line: BudgetLine): number {
  if (line.capMinor !== null) return 0;
  return line.children.reduce((total, child) => total + uncoveredMinor(child), line.ownMinor);
}

/** A row of the Budgeted group: one capped line, or a parent folding the capped lines under it. */
export type BudgetedEntry =
  | { kind: 'line'; line: BudgetLine }
  | {
      kind: 'drawer';
      parent: BudgetLine;
      /** The capped lines inside, the parent's own cap first when it has one. */
      lines: BudgetLine[];
      leftMinor: number;
    };

export interface NoBudgetEntry {
  line: BudgetLine;
  spentMinor: number;
  /** The uncapped lines under it, one step in. */
  children: { line: BudgetLine; spentMinor: number }[];
}

export interface SpendingView {
  /** Only the outermost caps, so a purchase is counted once. */
  budgetedMinor: number;
  /** What those outermost caps saw spent. */
  spentMinor: number;
  over: BudgetLine[];
  budgeted: BudgetedEntry[];
  noBudget: NoBudgetEntry[];
  /** What the categories in `noBudget` spent between them. */
  noBudgetMinor: number;
}

const leftOf = (line: BudgetLine) => (line.capMinor ?? 0) - line.totalMinor;
const capped = (line: BudgetLine) => line.capMinor !== null;
const byUse = (a: BudgetLine, b: BudgetLine) => usedShare(b) - usedShare(a) || a.name.localeCompare(b.name);

export function spendingView(lines: readonly BudgetLine[]): SpendingView {
  let budgetedMinor = 0;
  let spentMinor = 0;
  const outermost = (rows: readonly BudgetLine[]) => {
    for (const row of rows) {
      if (capped(row)) {
        budgetedMinor += row.capMinor!;
        spentMinor += row.totalMinor;
      } else outermost(row.children);
    }
  };
  outermost(lines);

  const all = flatten(lines);
  const over = all.filter((line) => line.overMinor > 0).sort((a, b) => b.overMinor - a.overMinor || a.name.localeCompare(b.name));

  // A line over its cap is read in the Over group, so it is not listed a second time here.
  const budgeted: BudgetedEntry[] = [];
  for (const root of lines) {
    const below = flatten(root.children).filter(capped);
    const inside = [root, ...below].filter((line) => capped(line) && line.overMinor === 0);
    if (inside.length === 0) continue;
    // A parent whose capped children are all over reads as the plain line it is.
    if (inside.length === 1 && inside[0]!.id === root.id) {
      budgeted.push({ kind: 'line', line: root });
      continue;
    }
    const own = inside.filter((line) => line.id === root.id);
    const rest = inside.filter((line) => line.id !== root.id).sort(byUse);
    budgeted.push({
      kind: 'drawer',
      parent: root,
      lines: [...own, ...rest],
      leftMinor: capped(root) ? leftOf(root) : rest.reduce((total, line) => total + leftOf(line), 0),
    });
  }
  const share = (entry: BudgetedEntry) => (entry.kind === 'line' ? usedShare(entry.line) : Math.max(...entry.lines.map(usedShare)));
  const nameOf = (entry: BudgetedEntry) => (entry.kind === 'line' ? entry.line.name : entry.parent.name);
  budgeted.sort((a, b) => share(b) - share(a) || nameOf(a).localeCompare(nameOf(b)));

  const noBudget: NoBudgetEntry[] = lines
    .filter((root) => !capped(root))
    .map((root) => ({
      line: root,
      spentMinor: uncoveredMinor(root),
      children: flatten(root.children)
        .filter((child) => !capped(child) && !hasCappedAncestor(root, child.id))
        .map((child) => ({ line: child, spentMinor: uncoveredMinor(child) }))
        .sort((a, b) => b.spentMinor - a.spentMinor || a.line.name.localeCompare(b.line.name)),
    }))
    .sort((a, b) => b.spentMinor - a.spentMinor || a.line.name.localeCompare(b.line.name));

  return {
    budgetedMinor,
    spentMinor,
    over,
    budgeted,
    noBudget,
    noBudgetMinor: noBudget.reduce((total, entry) => total + entry.spentMinor, 0),
  };
}

/** Whether a capped line sits between `root` and the line with this id — its spending is then that cap's. */
function hasCappedAncestor(root: BudgetLine, id: string): boolean {
  const walk = (line: BudgetLine, above: boolean): boolean | null => {
    if (line.id === id) return above;
    for (const child of line.children) {
      const found = walk(child, above || (line.id !== root.id && capped(line)));
      if (found !== null) return found;
    }
    return null;
  };
  return walk(root, false) ?? false;
}

export type PlanPart = 'debt' | 'goals' | 'budgeted' | 'unplanned';

export interface PlanSplit {
  parts: { key: PlanPart; label: string; minor: number; percent: number | null }[];
  /** What the bar is drawn against: the take-home, or what is planned when that is more. */
  scaleMinor: number;
}

/** How the take-home divides: debt first, then goals and caps, and what nothing is planned for. */
export function planSplit(input: { incomeMinor: number; debtMinor: number; goalsMinor: number; budgetedMinor: number }): PlanSplit {
  const planned = input.debtMinor + input.goalsMinor + input.budgetedMinor;
  const unplanned = Math.max(0, input.incomeMinor - planned);
  const percent = (minor: number) => (input.incomeMinor > 0 ? Math.round((minor / input.incomeMinor) * 100) : null);
  return {
    parts: [
      { key: 'debt', label: 'Debt', minor: input.debtMinor, percent: percent(input.debtMinor) },
      { key: 'goals', label: 'Goals', minor: input.goalsMinor, percent: percent(input.goalsMinor) },
      { key: 'budgeted', label: 'Budgeted', minor: input.budgetedMinor, percent: percent(input.budgetedMinor) },
      { key: 'unplanned', label: 'Unplanned', minor: unplanned, percent: percent(unplanned) },
    ],
    scaleMinor: Math.max(input.incomeMinor, planned),
  };
}
