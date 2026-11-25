import {
  type BudgetLine,
  type CapNode,
  formatBp,
  isoDate,
  outermostCapsTotal,
  parseMajor,
  parsePercentBp,
  roundUpToMajor,
  type ShareBasis,
  shareOfMinor,
} from '@expanses/core';
import type { BudgetChanges, BudgetMonth, BudgetRow } from '@expanses/db';
import { bareFigure } from '../networth/debt-rows';
import { type BudgetUnit, perMonthPreview, repeatOfUnit, unitOf } from './frequency-form';
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
  /** A unit, or every few weeks (Budget C). */
  frequency: BudgetUnit;
  filled: boolean;
  /** Typed as an amount in its unit, or as a % (always a month's). */
  mode: 'amount' | 'share';
  /** What the row held before its last switch, while nothing has been typed since: switching back gives it back exactly. */
  before?: { amount: string; frequency: BudgetUnit; mode: 'amount' | 'share' } | null;
  /** YYYY-MM-DD: the day a stored budget every few weeks is counted from; a new one starts on the day it is saved. */
  startsOn?: string | null;
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
      : {
          amount: stored ? bareFigure(stored.amountAsSetMinor, currency) : '',
          frequency: stored ? unitOf(stored.frequency, stored.everyWeeks) : 'monthly',
          filled: false,
          mode: 'amount',
          ...(stored?.startsOn ? { startsOn: stored.startsOn } : {}),
        };
  }
  return state;
}

/**
 * What a row typed as an amount comes to in the month, or null when it is empty, unreadable, nothing or a share. A day or
 * a week is counted in `month` (Budget C) when it is given, else read as its average month.
 */
export function monthlyOf(row: RowState | undefined, currency: string, month?: BudgetMonth | null, categoryId?: string): number | null {
  if (!row || row.mode === 'share') return null;
  const at = month && categoryId ? { month, categoryId, startsOn: row.startsOn ?? isoDate() } : null;
  const minor = perMonthPreview(row.amount, row.frequency, currency, at);
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

const unchanged = (a: RowState, b: RowState) => a.amount === b.amount && a.frequency === b.frequency && a.mode === b.mode;

/**
 * The children Save turns into amounts: each stored as a % of its parent, left alone here, under a parent with a budget
 * that is cleared. Each keeps its plan for the month on screen — the figure `saveBudgets` writes for it — so the screen
 * shows and counts that figure rather than a share of something about to go.
 */
export function keptOf(groups: readonly EditGroup[], state: EditState, stored: Stored): Map<string, number> {
  const byCategory = new Map(stored.budgets.map((row) => [row.categoryAccountId, row]));
  const kept = new Map<string, number>();
  for (const row of groups.flatMap((group) => group.rows)) {
    const child = byCategory.get(row.id);
    if (row.parentId === null || child?.share?.basis !== 'parent' || !byCategory.has(row.parentId)) continue;
    if (!unchanged(rowStateOf(state, row.id), rowStateOf(stored.initial, row.id))) continue;
    if (rowStateOf(state, row.parentId).amount.trim() || unchanged(rowStateOf(state, row.parentId), rowStateOf(stored.initial, row.parentId))) continue;
    kept.set(row.id, child.planMinor);
  }
  return kept;
}

/** Every row's month figure as typed, parents first (editGroups lists a parent before its children). */
function figuresOf(groups: readonly EditGroup[], state: EditState, stored: Stored, takeHomeMinor: number, currency: string, month?: BudgetMonth | null): Map<string, number> {
  const kept = keptOf(groups, state, stored);
  const figures = new Map<string, number>();
  for (const row of groups.flatMap((group) => group.rows)) {
    const typed = rowStateOf(state, row.id);
    const base = basisOfRow(row, figures, stored.budgets) === 'parent' ? figures.get(row.parentId!)! : takeHomeMinor;
    const minor = kept.get(row.id) ?? (typed.mode === 'share' ? shareFigure(typed, base, currency) : monthlyOf(typed, currency, month, row.id));
    if (minor !== null) figures.set(row.id, minor);
  }
  return figures;
}

/** Every row's month figure as typed: a share resolved against the basis it has (see `basisOfRow`). */
export function typedCaps(lines: readonly BudgetLine[], state: EditState, takeHomeMinor: number, currency: string, stored: Stored, month?: BudgetMonth | null): Map<string, number> {
  return figuresOf(editGroups(lines), state, stored, takeHomeMinor, currency, month);
}

/** The Budgeted figure as typed so far, counted as the sheet counts it: the outermost cap in each branch. */
export function liveCapsTotal(lines: readonly BudgetLine[], state: EditState, takeHomeMinor: number, currency: string, stored: Stored, month?: BudgetMonth | null): number {
  const figures = typedCaps(lines, state, takeHomeMinor, currency, stored, month);
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
  const figures = figuresOf(groups, state, { initial, budgets }, takeHomeMinor, currency);
  for (const row of rows) {
    const typed = rowStateOf(state, row.id);
    const loaded = rowStateOf(initial, row.id);
    if (unchanged(typed, loaded)) continue;
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
    // Every few weeks takes its gap and the day it is counted from: the one it has, else the day it is saved.
    const { frequency, everyWeeks } = repeatOfUnit(typed.frequency);
    out.save.push(
      everyWeeks === null
        ? { categoryAccountId: row.id, amountMinor: minor, frequency }
        : { categoryAccountId: row.id, amountMinor: minor, frequency, everyWeeks, startsOn: typed.startsOn ?? isoDate() },
    );
  }
  return out;
}

/**
 * A row's unit select moved: to % (always a month's), or to a unit. A figure is converted, so nothing typed is lost:
 * an amount to the share its month is, and a share to its month's figure — by the month whatever unit was picked, as
 * there is no exact way to say a month's figure a week or a year. Back to what the row held before the switch, with
 * nothing typed since (and, for an amount, its unit picked again), the figure comes back exactly as it was.
 */
export function switchRow(row: RowState, next: 'share' | BudgetUnit, base: ShareBase, currency: string): RowState {
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
