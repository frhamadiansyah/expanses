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
import { type ShareBase, toAmount, toPercent } from './share-form';

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
  /** What the row held before its last switch, while nothing has been typed since: switching back gives it back exactly. */
  before?: { amount: string; frequency: BudgetFrequency; mode: 'amount' | 'share' } | null;
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

/** What the screen opened with, and the budgets as stored now: what a row's figure and its share's basis are read against. */
export interface Stored {
  initial: EditState;
  budgets: readonly BudgetRow[];
}

/**
 * What a row's % is of. A share saved before keeps its basis while it is there: take-home always, a parent while a
 * figure is typed for it. A new share, or one whose parent has no figure now, takes what is typed above it: its
 * parent's figure, or take-home.
 */
export function basisOfRow(row: EditRow, figures: ReadonlyMap<string, number>, budgets: readonly BudgetRow[]): ShareBasis {
  if (row.parentId === null || !figures.has(row.parentId)) return 'take-home';
  return budgets.find((stored) => stored.categoryAccountId === row.id)?.share?.basis === 'take-home' ? 'take-home' : 'parent';
}

/** Every row's month figure as typed, parents first (editGroups lists a parent before its children). */
function figuresOf(rows: readonly EditRow[], state: EditState, budgets: readonly BudgetRow[], takeHomeMinor: number, currency: string): Map<string, number> {
  const figures = new Map<string, number>();
  for (const row of rows) {
    const typed = rowStateOf(state, row.id);
    const base = basisOfRow(row, figures, budgets) === 'parent' ? figures.get(row.parentId!)! : takeHomeMinor;
    const minor = typed.mode === 'share' ? shareFigure(typed, base, currency) : monthlyOf(typed, currency);
    if (minor !== null) figures.set(row.id, minor);
  }
  return figures;
}

/** Every row's month figure as typed: a share resolved against the basis it has (see `basisOfRow`). */
export function typedCaps(lines: readonly BudgetLine[], state: EditState, takeHomeMinor: number, currency: string, stored: Stored): Map<string, number> {
  return figuresOf(editGroups(lines).flatMap((group) => group.rows), state, stored.budgets, takeHomeMinor, currency);
}

/** The Budgeted figure as typed so far, counted as the sheet counts it: the outermost cap in each branch. */
export function liveCapsTotal(lines: readonly BudgetLine[], state: EditState, takeHomeMinor: number, currency: string, stored: Stored): number {
  const figures = typedCaps(lines, state, takeHomeMinor, currency, stored);
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
  const figures = figuresOf(rows, state, budgets, takeHomeMinor, currency);
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
      out.save.push({ categoryAccountId: row.id, amountMinor: figures.get(row.id) ?? 0, frequency: 'monthly', share: { basis: basisOfRow(row, figures, budgets), bp } });
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

/**
 * A row's unit select moved: to % (always a month's), or to a unit. A figure is converted, so nothing typed is lost:
 * an amount to the share its month is, and a share to its month's figure — by the month whatever unit was picked, as
 * there is no exact way to say a month's figure a week or a year. Back to what the row held before the switch, with
 * nothing typed since (and, for an amount, its unit picked again), the figure comes back exactly as it was.
 */
export function switchRow(row: RowState, next: 'share' | BudgetFrequency, base: ShareBase, currency: string): RowState {
  if (next === 'share' && row.mode === 'share') return row;
  if (next !== 'share' && row.mode === 'amount') return { ...row, frequency: next, filled: false, before: null };
  const shown = { amount: row.amount, frequency: row.frequency, mode: row.mode };
  const back = row.before && (next === 'share' ? row.before.mode === 'share' : row.before.mode === 'amount' && row.before.frequency === next) ? row.before : null;
  if (back) return { ...row, ...back, filled: false, before: shown };
  if (next === 'share') return { ...row, mode: 'share', frequency: 'monthly', amount: toPercent(row.amount, row.frequency, base, currency), filled: false, before: shown };
  return { ...row, mode: 'amount', frequency: 'monthly', amount: toAmount(row.amount, base, currency), filled: false, before: shown };
}

/** A row's state; one that arrived after the screen opened (a category synced in) reads as empty and monthly. */
export function rowStateOf(state: EditState, id: string): RowState {
  return state[id] ?? { amount: '', frequency: 'monthly', filled: false, mode: 'amount' };
}

export function isDirty(state: EditState, initial: EditState): boolean {
  return Object.keys(state).some((id) => state[id]!.amount !== initial[id]?.amount || state[id]!.frequency !== initial[id]?.frequency || state[id]!.mode !== initial[id]?.mode);
}
