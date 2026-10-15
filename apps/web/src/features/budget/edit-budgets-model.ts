import {
  type BudgetFrequency,
  type BudgetLine,
  type CapNode,
  formatBp,
  outermostCapsTotal,
  parseMajor,
  parsePercentBp,
  roundUpToMajor,
  type ShareBasis,
  shareOfMinor,
} from '@expanses/core';
import type { BudgetChanges, BudgetRow } from '@expanses/db';
import { bareFigure } from '../networth/debt-rows';
import { perMonthPreview } from './frequency-form';

/** One field on the Edit budgets screen: a category, named as the list shows it, and where it sits in its tree. */
export interface EditRow {
  id: string;
  /** "All Food" for a root that has children; the category's own name otherwise. */
  label: string;
  name: string;
  depth: number;
  parentId: string | null;
  hasChildren: boolean;
}

export interface EditGroup {
  id: string;
  name: string;
  rows: EditRow[];
}

/** What is typed in one row: the figure as typed, in its unit; `filled` when Fill from last month put it there. */
export interface RowState {
  amount: string;
  frequency: BudgetFrequency;
  filled: boolean;
  /** Typed as an amount in its unit, or as a % (always a month's). */
  mode: 'amount' | 'share';
}

export type EditState = Record<string, RowState>;

const byName = (a: BudgetLine, b: BudgetLine) => a.name.localeCompare(b.name);

/** One group per root, by name: a root with children leads with its own cap as "All <root>", then the tree under it. */
export function editGroups(lines: readonly BudgetLine[]): EditGroup[] {
  return [...lines].sort(byName).map((root) => {
    if (root.children.length === 0) {
      return { id: root.id, name: root.name, rows: [{ id: root.id, label: root.name, name: root.name, depth: 0, parentId: null, hasChildren: false }] };
    }
    const rows: EditRow[] = [{ id: root.id, label: `All ${root.name}`, name: root.name, depth: 0, parentId: null, hasChildren: true }];
    const walk = (parent: BudgetLine, depth: number) => {
      for (const child of [...parent.children].sort(byName)) {
        rows.push({ id: child.id, label: child.name, name: child.name, depth, parentId: parent.id, hasChildren: child.children.length > 0 });
        walk(child, depth + 1);
      }
    };
    walk(root, 1);
    return { id: root.id, name: root.name, rows };
  });
}

/** Every row as stored: the plan as it was typed, in the unit it was typed in. This month's own figure is not shown. */
export function initialState(groups: readonly EditGroup[], budgets: readonly BudgetRow[], currency: string): EditState {
  const byCategory = new Map(budgets.map((row) => [row.categoryAccountId, row]));
  const state: EditState = {};
  for (const row of groups.flatMap((group) => group.rows)) {
    const stored = byCategory.get(row.id);
    state[row.id] = stored?.share
      ? { amount: formatBp(stored.share.bp), frequency: 'monthly', filled: false, mode: 'share' }
      : { amount: stored ? bareFigure(stored.amountAsSetMinor, currency) : '', frequency: stored?.frequency ?? 'monthly', filled: false, mode: 'amount' };
  }
  return state;
}

/** What a row typed as an amount comes to a month, or null when it is empty, unreadable, nothing or a share. */
export function monthlyOf(row: RowState | undefined, currency: string): number | null {
  if (!row || row.mode === 'share') return null;
  const minor = perMonthPreview(row.amount, row.frequency, currency);
  return minor !== null && minor > 0 ? minor : null;
}

/** A share typed in a row, of `baseMinor`; null when it cannot be read or comes to nothing. */
function shareFigure(row: RowState, baseMinor: number, currency: string): number | null {
  try {
    const share = shareOfMinor(baseMinor, parsePercentBp(row.amount), currency);
    return share > 0 ? share : null;
  } catch {
    return null;
  }
}

/** Every row's month figure as typed: a share resolved against its typed parent, or against take-home without one. */
export function typedCaps(lines: readonly BudgetLine[], state: EditState, takeHomeMinor: number, currency: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (rows: readonly BudgetLine[], parentMinor: number | null) => {
    for (const line of rows) {
      const row = rowStateOf(state, line.id);
      const minor = row.mode === 'share' ? shareFigure(row, parentMinor ?? takeHomeMinor, currency) : monthlyOf(row, currency);
      if (minor !== null) out.set(line.id, minor);
      walk(line.children, minor);
    }
  };
  walk(lines, null);
  return out;
}

/** What a row's % is of, by what is typed above it now: its parent's figure, or take-home. */
export function basisOfRow(row: EditRow, figures: ReadonlyMap<string, number>): ShareBasis {
  return row.parentId !== null && figures.has(row.parentId) ? 'parent' : 'take-home';
}

/** The Budgeted figure as typed so far, counted as the sheet counts it: the outermost cap in each branch. */
export function liveCapsTotal(lines: readonly BudgetLine[], state: EditState, takeHomeMinor: number, currency: string): number {
  const figures = typedCaps(lines, state, takeHomeMinor, currency);
  const node = (line: BudgetLine): CapNode => ({ capMinor: figures.get(line.id) ?? null, children: line.children.map(node) });
  return outermostCapsTotal(lines.map(node));
}

/**
 * Last month's spending, rounded up to a whole unit, into every row that is empty, has no children of its own, sits
 * under no parent with a figure, and spent something. Nothing else is touched.
 */
export function fillFromLastMonth(groups: readonly EditGroup[], state: EditState, history: ReadonlyMap<string, { lastMinor: number }>, currency: string): EditState {
  const next: EditState = { ...state };
  for (const group of groups) {
    const parentOf = new Map(group.rows.map((row) => [row.id, row.parentId]));
    const cappedAbove = (id: string) => {
      for (let up = parentOf.get(id) ?? null; up !== null; up = parentOf.get(up) ?? null) {
        if (monthlyOf(next[up], currency) !== null) return true;
      }
      return false;
    };
    for (const row of group.rows) {
      if (row.hasChildren || next[row.id]?.amount.trim() || cappedAbove(row.id)) continue;
      const spent = history.get(row.id)?.lastMinor ?? 0;
      if (spent <= 0) continue;
      next[row.id] = { amount: bareFigure(roundUpToMajor(spent, currency), currency), frequency: 'monthly', filled: true, mode: 'amount' };
    }
  }
  return next;
}

/**
 * What Save sends: only the rows changed on this screen since it opened — new and changed figures saved, cleared ones
 * removed — and unreadable rows named. A row left alone is never sent, so a budget someone else set or changed while
 * the screen was open (a partner, another device) is not undone. `budgets` is what is stored now, read only to know
 * whether a cleared row has a budget to remove.
 */
export function changesOf(
  groups: readonly EditGroup[],
  state: EditState,
  initial: EditState,
  budgets: readonly BudgetRow[],
  takeHomeMinor: number,
  currency: string,
): BudgetChanges & { unreadable: string[] } {
  const stored = new Set(budgets.map((row) => row.categoryAccountId));
  const out: BudgetChanges & { unreadable: string[] } = { save: [], remove: [], unreadable: [] };
  const rows = groups.flatMap((group) => group.rows);
  // Every row's figure as typed, parents first (editGroups lists a parent before its children), so a share resolves
  // against its parent's figure as typed now.
  const figures = new Map<string, number>();
  for (const row of rows) {
    const typed = rowStateOf(state, row.id);
    const base = row.parentId !== null && figures.has(row.parentId) ? figures.get(row.parentId)! : takeHomeMinor;
    const minor = typed.mode === 'share' ? shareFigure(typed, base, currency) : monthlyOf(typed, currency);
    if (minor !== null) figures.set(row.id, minor);
  }
  for (const row of rows) {
    const typed = rowStateOf(state, row.id);
    const loaded = rowStateOf(initial, row.id);
    if (typed.amount === loaded.amount && typed.frequency === loaded.frequency && typed.mode === loaded.mode) continue;
    if (!typed.amount.trim()) {
      if (stored.has(row.id)) out.remove.push(row.id);
      continue;
    }
    if (typed.mode === 'share') {
      let bp: number;
      try {
        bp = parsePercentBp(typed.amount);
      } catch {
        out.unreadable.push(row.id);
        continue;
      }
      out.save.push({ categoryAccountId: row.id, amountMinor: figures.get(row.id) ?? 0, frequency: 'monthly', share: { basis: basisOfRow(row, figures), bp } });
      continue;
    }
    let minor: number;
    try {
      minor = parseMajor(typed.amount, currency);
    } catch {
      out.unreadable.push(row.id);
      continue;
    }
    out.save.push({ categoryAccountId: row.id, amountMinor: minor, frequency: typed.frequency });
  }
  return out;
}

/** A row's state; one that arrived after the screen opened (a category synced in) reads as empty and monthly. */
export function rowStateOf(state: EditState, id: string): RowState {
  return state[id] ?? { amount: '', frequency: 'monthly', filled: false, mode: 'amount' };
}

export function isDirty(state: EditState, initial: EditState): boolean {
  return Object.keys(state).some((id) => state[id]!.amount !== initial[id]?.amount || state[id]!.frequency !== initial[id]?.frequency || state[id]!.mode !== initial[id]?.mode);
}
