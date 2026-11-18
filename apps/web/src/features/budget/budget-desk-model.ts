import { type BudgetFrequency, type BudgetLine, formatBp } from '@expanses/core';
import type { BudgetChanges, BudgetRow } from '@expanses/db';
import { bareFigure } from '../networth/debt-rows';
import { flatten, usedShare } from './budget-view';
import { basisOfRow, changesOf, editGroups, type EditState, initialState, keptOf, type RowState, rowStateOf, typedCaps } from './edit-budgets-model';

/*
 * The wide screen's Budget (Mac Budget, the list version, owner-picked 2026-11-17) as data: the Categories table's rows
 * and sums, what needs a look, and what typing a figure into a Budget cell saves — each worked out here, so it is tested
 * without a page. A cell saves exactly what Edit budgets would save for that one row (`changesOf`).
 */

/** From this share of its budget on, a category reads orange; past the whole of it, red. */
export const NEAR_SHARE = 0.85;

export type Tone = 'ok' | 'near' | 'over';

/** How far through its budget a figure is: green, orange from 85%, red once over. Null with no budget. */
export function toneOf(budgetMinor: number | null, spentMinor: number): Tone | null {
  if (budgetMinor === null) return null;
  if (spentMinor > budgetMinor) return 'over';
  const share = budgetMinor > 0 ? spentMinor / budgetMinor : spentMinor > 0 ? 2 : 0;
  return share >= NEAR_SHARE ? 'near' : 'ok';
}

/** How a click (or Return) on a row's Budget cell edits it. */
export type CellEdit =
  /** Typed in place: a month's amount, or a %. */
  | 'cell'
  /** A budget set a week, a quarter or a year at a time: the full editor, which keeps its unit. */
  | 'editor'
  /** This month carries its own figure (Just this month): the category's own cap sheet, which says so. */
  | 'sheet';

export interface DeskRow {
  /** Unique in the table: `group:` or `line:` and the category's id (a parent's own budget is its `line:`), the same in either section. */
  key: string;
  kind: 'group' | 'line';
  section: 'budgeted' | 'none';
  categoryId: string;
  /** "All Household" for a parent's own budget under its group row; the category's name otherwise. */
  label: string;
  /** The category's own name, which the side peek and Needs a look use. */
  name: string;
  depth: number;
  /** The group row that folds it, or null. */
  groupId: string | null;
  budgetMinor: number | null;
  spentMinor: number;
  /** Budget less spent; null with no budget. Below nought when over. */
  leftMinor: number | null;
  /** How much of the budget is used, 0 upwards (the bar's width, capped at the whole). */
  share: number;
  tone: Tone | null;
  /** "20%" for a budget set as a %; null for an amount. */
  percent: string | null;
  /** The unit the plan was typed in. */
  frequency: BudgetFrequency;
  /** This month carries its own figure. */
  overridden: boolean;
  /** Null for a group row: its figures are its rows' sums, not a budget of their own. */
  edit: CellEdit | null;
}

export interface DeskTable {
  rows: DeskRow[];
  /** Total budgeted: the outermost budget in each branch, each budgeted root's whole Spent, and Budget − Spent. */
  total: { budgetMinor: number; spentMinor: number; leftMinor: number };
  /** How many categories sit under No budget yet. */
  noBudgetCount: number;
}

const byName = (a: BudgetLine, b: BudgetLine) => a.name.localeCompare(b.name);
const capped = (line: BudgetLine) => line.capMinor !== null;

/** The outermost budgets under a line (itself, when it has one) and what they saw spent: counted once, as the sheet does. */
export function coveredOf(line: BudgetLine): { budgetMinor: number; spentMinor: number; any: boolean } {
  if (line.capMinor !== null) return { budgetMinor: line.capMinor, spentMinor: line.totalMinor, any: true };
  return line.children.map(coveredOf).reduce((sum, each) => ({ budgetMinor: sum.budgetMinor + each.budgetMinor, spentMinor: sum.spentMinor + each.spentMinor, any: sum.any || each.any }), {
    budgetMinor: 0,
    spentMinor: 0,
    any: false,
  });
}

function editOf(stored: BudgetRow | undefined): CellEdit {
  if (stored?.overridden) return 'sheet';
  if (stored && stored.frequency !== 'monthly') return 'editor';
  return 'cell';
}

/** A row's Left, bar and colour from the Budget and Spent it shows: Left = Budget − Spent; none with no budget. */
export function figuresOf(budgetMinor: number | null, spentMinor: number): Pick<DeskRow, 'budgetMinor' | 'spentMinor' | 'leftMinor' | 'share' | 'tone'> {
  if (budgetMinor === null) return { budgetMinor, spentMinor, leftMinor: null, share: 0, tone: null };
  const share = budgetMinor > 0 ? spentMinor / budgetMinor : spentMinor > 0 ? 2 : 0;
  return { budgetMinor, spentMinor, leftMinor: budgetMinor - spentMinor, share: Math.max(0, share), tone: toneOf(budgetMinor, spentMinor) };
}

function lineRow(line: BudgetLine, at: { key: string; label: string; depth: number; groupId: string | null; section: DeskRow['section'] }, stored: BudgetRow | undefined, spentMinor = line.totalMinor): DeskRow {
  return {
    key: at.key,
    kind: 'line',
    section: at.section,
    categoryId: line.id,
    label: at.label,
    name: line.name,
    depth: at.depth,
    groupId: at.groupId,
    ...figuresOf(line.capMinor, spentMinor),
    percent: stored?.share ? `${formatBp(stored.share.bp)}%` : null,
    frequency: stored?.frequency ?? 'monthly',
    overridden: stored?.overridden ?? false,
    edit: editOf(stored),
  };
}

/**
 * The Categories table. Every root with a budget anywhere in it, by name: a root on its own is one row; a root with
 * sub-categories is a group row, then "All <root>", then each sub-category under it that has a budget or spent something
 * (each one typable). Below, No budget yet: each root nothing is budgeted in that spent something, by what it spent, with
 * its spending sub-categories one step in — as the phone lists them.
 *
 * One plain rule for a group (owner, 17 Nov 2026), so its rows add up the way they read:
 * - the group row's Spent is the category's whole Spent (the phone's and Cashflow's ring); its Budget is its outermost
 *   budgets, as the phone's Budgeted counts them;
 * - "All <root>" is listed only when the root has a budget of its own or money was booked to the root itself, and its
 *   Spent is only that money, against the root's own Budget;
 * - so the sub-category rows and "All <root>" add up to the group's Spent; what no budget covers is Not budgeted.
 *
 * And one rule for Left on every row, the Total budgeted row too (owner, 18 Nov 2026): Left = Budget − Spent, as the
 * row reads, below nought (red, "−") when over; the bar is Spent / Budget on the same figures. A row with no budget has
 * no Left. So an over sub-category takes its group's Left down with it, and a group whose Spent passes its Budget is red.
 */
export function deskTable(lines: readonly BudgetLine[], budgets: readonly BudgetRow[]): DeskTable {
  const storedOf = new Map(budgets.map((row) => [row.categoryAccountId, row]));
  const rows: DeskRow[] = [];
  const total = { budgetMinor: 0, spentMinor: 0, leftMinor: 0 };
  for (const root of [...lines].sort(byName)) {
    const covered = coveredOf(root);
    if (!covered.any) continue;
    // The total reads as the column above it: each budgeted root's Budget and its whole Spent.
    total.budgetMinor += covered.budgetMinor;
    total.spentMinor += root.totalMinor;
    if (root.children.length === 0) {
      rows.push(lineRow(root, { key: `line:${root.id}`, label: root.name, depth: 0, groupId: null, section: 'budgeted' }, storedOf.get(root.id)));
      continue;
    }
    rows.push({
      key: `group:${root.id}`,
      kind: 'group',
      section: 'budgeted',
      categoryId: root.id,
      label: root.name,
      name: root.name,
      depth: 0,
      groupId: null,
      ...figuresOf(covered.budgetMinor, root.totalMinor),
      percent: null,
      frequency: 'monthly',
      overridden: false,
      edit: null,
    });
    if (root.capMinor !== null || root.ownMinor !== 0) {
      // Only what was booked to the root itself: its sub-categories' money is on their own rows.
      rows.push(lineRow(root, { key: `line:${root.id}`, label: `All ${root.name}`, depth: 1, groupId: root.id, section: 'budgeted' }, storedOf.get(root.id), root.ownMinor));
    }
    // A sub-category with no budget that spent nothing is left to Edit budgets, as the phone leaves it.
    const listed = (line: BudgetLine): boolean => coveredOf(line).any || line.totalMinor !== 0;
    const walk = (parent: BudgetLine, depth: number) => {
      for (const child of [...parent.children].sort(byName)) {
        if (!listed(child)) continue;
        rows.push(lineRow(child, { key: `line:${child.id}`, label: child.name, depth, groupId: root.id, section: 'budgeted' }, storedOf.get(child.id)));
        walk(child, depth + 1);
      }
    };
    walk(root, 1);
  }
  total.leftMinor = total.budgetMinor - total.spentMinor;

  const unbudgeted = lines
    .filter((root) => !coveredOf(root).any && root.totalMinor > 0)
    .sort((a, b) => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name));
  for (const root of unbudgeted) {
    rows.push(lineRow(root, { key: `line:${root.id}`, label: root.name, depth: 0, groupId: null, section: 'none' }, storedOf.get(root.id)));
    const spending = flatten(root.children)
      .filter((child) => child.totalMinor > 0)
      .sort((a, b) => b.totalMinor - a.totalMinor || a.name.localeCompare(b.name));
    for (const child of spending) rows.push(lineRow(child, { key: `line:${child.id}`, label: child.name, depth: 1, groupId: null, section: 'none' }, storedOf.get(child.id)));
  }
  return { rows, total, noBudgetCount: unbudgeted.length };
}

/** The rows on show: a folded group keeps its own row and hides the rows under it. */
export function shownRows(rows: readonly DeskRow[], folded: ReadonlySet<string>): DeskRow[] {
  return rows.filter((row) => row.groupId === null || !folded.has(row.groupId));
}

/** Plan view and Spending view list the same rows; only the Budget column moves. */
export type DeskView = 'spending' | 'plan';

/** One line of Needs a look. */
export type LookLine =
  | { kind: 'over'; categoryId: string; name: string; overMinor: number }
  | { kind: 'near'; categoryId: string; name: string; percent: number }
  | { kind: 'unbudgeted'; count: number };

/**
 * Up to three lines, from figures the page already has: the categories over their budget (furthest over first), those
 * at 85% or more (fullest first), and — always last when there are any — how many categories spent with no budget.
 */
export function needsALook(lines: readonly BudgetLine[], noBudgetCount: number, limit = 3): LookLine[] {
  const all = flatten(lines);
  const over: LookLine[] = all
    .filter((line) => line.overMinor > 0)
    .sort((a, b) => b.overMinor - a.overMinor || a.name.localeCompare(b.name))
    .map((line) => ({ kind: 'over', categoryId: line.id, name: line.name, overMinor: line.overMinor }));
  const near: LookLine[] = all
    .filter((line) => capped(line) && line.overMinor === 0 && usedShare(line) >= NEAR_SHARE)
    .sort((a, b) => usedShare(b) - usedShare(a) || a.name.localeCompare(b.name))
    // Floored, so a category not yet over never reads 100%.
    .map((line) => ({ kind: 'near', categoryId: line.id, name: line.name, percent: Math.min(100, Math.floor(usedShare(line) * 100)) }));
  const room = noBudgetCount > 0 ? limit - 1 : limit;
  return [...[...over, ...near].slice(0, Math.max(0, room)), ...(noBudgetCount > 0 ? [{ kind: 'unbudgeted' as const, count: noBudgetCount }] : [])];
}

/** What a Budget cell holds when it opens for typing: the plan as it was typed — "20%" for a share — or nothing. */
export function cellText(stored: BudgetRow | undefined, currency: string): string {
  if (!stored) return '';
  if (stored.share) return `${formatBp(stored.share.bp)}%`;
  return bareFigure(stored.amountAsSetMinor, currency);
}

/** What Return (or Tab) on a typed cell does. */
export type CellPlan =
  /** Nothing changed: the cell closes. */
  | { kind: 'none' }
  /** Save these, as Edit budgets would. */
  | { kind: 'save'; changes: BudgetChanges }
  /** A case Edit budgets asks about first (a cleared parent whose %-children keep their figure): open it there. */
  | { kind: 'editor' }
  /** Refused, in words, before anything is written. */
  | { kind: 'error'; message: string };

/** A typed cell as Edit budgets' row state: "20%" (or "12,5 %") is a share, anything else a month's amount. */
export function typedRow(text: string): RowState {
  const typed = text.trim();
  const share = /%\s*$/.test(typed);
  return { amount: share ? typed.replace(/%\s*$/, '').trim() : typed, frequency: 'monthly', filled: false, mode: share ? 'share' : 'amount' };
}

/**
 * What saving one typed cell sends: the screen's state as Edit budgets would open it, with this one row changed, read by
 * `changesOf` — so a cell takes the same reading of a figure, the same basis for a % (its parent's budget for a
 * sub-category whose parent has one, else take-home), and only this row is ever written. A % with nothing to be a share
 * of, a figure that cannot be read, and a cleared parent with %-children (the editor's confirm) are never guessed at.
 */
export function planCell(lines: readonly BudgetLine[], budgets: readonly BudgetRow[], categoryId: string, text: string, takeHomeMinor: number, currency: string): CellPlan {
  const groups = editGroups(lines);
  const row = groups.flatMap((group) => group.rows).find((each) => each.id === categoryId);
  if (!row) return { kind: 'error', message: 'That category has no budget line this month' };
  const initial = initialState(groups, budgets, currency);
  const typed = typedRow(text);
  const state: EditState = { ...initial, [categoryId]: typed };
  const stored = { initial, budgets };
  if (typed.mode === 'share' && typed.amount) {
    const figures = typedCaps(lines, state, takeHomeMinor, currency, stored);
    const base = basisOfRow(row, figures, budgets) === 'parent' ? (figures.get(row.parentId!) ?? 0) : takeHomeMinor;
    if (base <= 0) return { kind: 'error', message: 'Set a take-home first to budget by %' };
  }
  if (keptOf(groups, state, stored).size > 0) return { kind: 'editor' };
  const changes = changesOf(groups, state, initial, budgets, takeHomeMinor, currency);
  if (changes.unreadable.length > 0) return { kind: 'error', message: typed.mode === 'share' ? 'A share is a percentage with at most two decimals, such as 15 or 12,5' : 'That figure cannot be read' };
  if (changes.save.length === 0 && changes.remove.length === 0) return { kind: 'none' };
  // Typed the same figure again ("500000" for 500.000): nothing to write.
  const was = rowStateOf(initial, categoryId);
  const same = changes.save.length === 1 && was.mode === 'amount' && typed.mode === 'amount' && budgets.find((b) => b.categoryAccountId === categoryId)?.amountAsSetMinor === changes.save[0]!.amountMinor && was.frequency === 'monthly';
  if (same) return { kind: 'none' };
  return { kind: 'save', changes: { save: changes.save, remove: changes.remove } };
}
