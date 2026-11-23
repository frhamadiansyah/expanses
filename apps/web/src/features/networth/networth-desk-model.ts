import { addMonths, type SheetGroup, type SheetRow } from '@expanses/core';
import { sheetDrawers, type RowKind } from './sheet-drawers';

/*
 * Mac Net worth (owner, 2026-11-17 "ok build"): the page's figures, put together once and drawn by the page. Nothing
 * here reads the database: the balance sheet the phone's Net worth reads is handed in, so the Mac page and the phone's
 * agree to the rupiah — Total assets − Total debts = Net worth, each kind is the sum of its rows, and the treemap's
 * shares add up to 100.
 */

/**
 * Whole per cents that add up to exactly 100, for the shares a treemap and its table print.
 *
 * Largest remainder (each part's floor, then the parts with the biggest leftovers take one more), so no single part
 * swallows the rounding; and a part above nothing never reads 0% — it takes 1 from the largest — because a box drawn on
 * the strip with "0%" on it reads as a mistake. Parts at or below nothing have no share. Nothing to share: all 0.
 */
export function wholeShares(parts: readonly number[]): number[] {
  const held = parts.map((part) => (part > 0 ? part : 0));
  const total = held.reduce((sum, part) => sum + part, 0);
  if (total <= 0) return parts.map(() => 0);
  const exact = held.map((part) => (part * 100) / total);
  const shares = exact.map((value) => Math.floor(value));
  let left = 100 - shares.reduce((sum, share) => sum + share, 0);
  const byRemainder = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || held[b.index]! - held[a.index]!);
  for (const { index } of byRemainder) {
    if (left <= 0) break;
    shares[index] = shares[index]! + 1;
    left -= 1;
  }
  // A held part that rounded to nothing reads 1%, taken from the largest share that can spare it.
  const positive = held.filter((part) => part > 0).length;
  if (positive <= 100) {
    for (let index = 0; index < shares.length; index += 1) {
      if (held[index]! <= 0 || shares[index]! > 0) continue;
      const donor = shares.reduce((best, share, at) => (share > (shares[best] ?? 0) ? at : best), 0);
      shares[donor] = shares[donor]! - 1;
      shares[index] = 1;
    }
  }
  return shares;
}

/** One box along a strip: where it starts and how much of the strip it takes, both in per cent. */
export interface StripSpan {
  start: number;
  size: number;
}

/**
 * A strip divided in proportion to the values, in the order given: the spans meet end to end and add up to exactly 100.
 *
 * A value too small to see still gets `min` per cent — a sliver that can be clicked — and the room it takes comes from
 * the values above that floor, in proportion, so the large boxes stay in proportion to one another. Values at or below
 * nothing have no span (size 0, where the previous one ended). A floor too big for the count of values is dropped.
 */
export function stripLayout(values: readonly number[], min = 0.8): StripSpan[] {
  const held = values.map((value) => (value > 0 ? value : 0));
  const total = held.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => ({ start: 0, size: 0 }));
  const count = held.filter((value) => value > 0).length;
  const floor = min * count >= 100 ? 0 : min;
  // Lift the slivers to the floor and share what is left among the rest in proportion, until nothing is under it.
  const lifted = new Set<number>();
  let sizes: number[] = [];
  for (;;) {
    const free = held.reduce((sum, value, index) => sum + (lifted.has(index) ? 0 : value), 0);
    const room = 100 - floor * lifted.size;
    sizes = held.map((value, index) => (value <= 0 ? 0 : lifted.has(index) ? floor : (value / free) * room));
    const under = sizes.flatMap((size, index) => (held[index]! > 0 && !lifted.has(index) && size < floor ? [index] : []));
    if (under.length === 0) break;
    for (const index of under) lifted.add(index);
  }
  // The last held box closes the strip, so rounding never leaves a gap or an overlap.
  const last = held.reduce((at, value, index) => (value > 0 ? index : at), -1);
  let start = 0;
  return sizes.map((size, index) => {
    const span = { start, size: index === last ? 100 - start : size };
    start += span.size;
    return span;
  });
}

/** A part of a box drawn inside it, top to bottom: Investments as funds, shares, bonds. */
export interface TreemapPart {
  key: string;
  label: string;
  minor: number;
  /** Its share of the box it is in (whole per cent, the parts add up to 100). */
  share: number;
  top: number;
  height: number;
}

/** One box of the treemap strip: a kind, its share of the side, where it sits along the strip, and its parts. */
export interface TreemapBox {
  key: string;
  label: string;
  minor: number;
  /** Its share of the side, in whole per cent: the boxes' shares add up to 100. */
  share: number;
  left: number;
  width: number;
  parts: TreemapPart[];
}

/** What a treemap divides: a kind and what it comes to, and — for the one split inside — its parts. */
export interface TreemapInput {
  key: string;
  label: string;
  minor: number;
  parts?: readonly { key: string; label: string; minor: number }[];
}

/**
 * The strip a side of the sheet is drawn as: one box a kind above nothing, the largest first, each as wide as its share.
 *
 * A kind below nothing (an overdrawn account taking Cash under 0) has no box — a share of a whole cannot be negative —
 * and the strip divides what is held; the page names it under the strip. A kind with two or more parts above nothing is
 * divided inside, top to bottom, largest first, each part's share being of that box.
 */
export function treemapStrip(kinds: readonly TreemapInput[]): TreemapBox[] {
  const held = kinds.filter((kind) => kind.minor > 0).sort((a, b) => b.minor - a.minor);
  const shares = wholeShares(held.map((kind) => kind.minor));
  const spans = stripLayout(held.map((kind) => kind.minor));
  return held.map((kind, index) => {
    const parts = (kind.parts ?? []).filter((part) => part.minor > 0).sort((a, b) => b.minor - a.minor);
    const split = parts.length > 1;
    const partShares = split ? wholeShares(parts.map((part) => part.minor)) : [];
    const partSpans = split ? stripLayout(parts.map((part) => part.minor), 3) : [];
    return {
      key: kind.key,
      label: kind.label,
      minor: kind.minor,
      share: shares[index]!,
      left: spans[index]!.start,
      width: spans[index]!.size,
      parts: split ? parts.map((part, at) => ({ ...part, share: partShares[at]!, top: partSpans[at]!.start, height: partSpans[at]!.size })) : [],
    };
  });
}

/** One row of a side's table: an account, what it comes to, and the kind it is. */
export interface DeskItem {
  accountId: string;
  name: string;
  /** In the base currency; null when the row has no rate (a partner's item, drawn in its own currency instead). */
  minor: number | null;
  kind: RowKind;
  /** Part of it is another currency, converted: the figure carries ≈. */
  approx: boolean;
}

/** One kind on a side: an asset section (Cash & equivalents, Investments…) or a kind of debt (Home mortgage…). */
export interface DeskKind {
  key: string;
  label: string;
  /** Its rows added up; null while one of them has no rate. */
  totalMinor: number | null;
  /** Its share of the side, in whole per cent; the kinds' shares add up to 100 (0 for a kind at or below nothing). */
  share: number;
  items: DeskItem[];
  /** What it holds, by kind: the treemap's split inside its box (Investments by holding type). */
  parts: { key: string; label: string; minor: number }[];
}

export interface DeskSide {
  kinds: DeskKind[];
  /** The side's total: the sheet's own (assets) or what is owed on every debt, whole. */
  totalMinor: number;
}

/** The sections inside which the treemap draws what a box holds, by kind. */
export const SPLIT_SECTIONS: ReadonlySet<string> = new Set(['invest']);

const shared = (kinds: Omit<DeskKind, 'share'>[]): DeskKind[] => {
  const shares = wholeShares(kinds.map((kind) => kind.totalMinor ?? 0));
  return kinds.map((kind, index) => ({ ...kind, share: shares[index]! }));
};

/**
 * The assets side: one kind a section of the statement, in the statement's order, its rows under it, and — for
 * Investments — what it holds by kind (`rowKind` is how the phone's drawers fold the same rows: listed shares, mutual
 * funds, government bonds). A section's total is its rows added up, which is the sheet's own section total.
 */
export function assetSide(groups: readonly SheetGroup[], rowKind: (section: string, row: SheetRow) => RowKind, unrated: ReadonlySet<string> = new Set()): DeskSide {
  const kinds = groups.map((group) => {
    const items: DeskItem[] = group.rows.map((row) => ({
      accountId: row.accountId,
      name: row.name,
      minor: unrated.has(row.accountId) ? null : row.amountMinor,
      kind: rowKind(group.key, row),
      approx: Boolean((row as { approx?: boolean }).approx),
    }));
    const blank = items.some((item) => item.minor === null);
    const parts = SPLIT_SECTIONS.has(group.key) && !blank ? sheetDrawers(group.rows, (row) => rowKind(group.key, row)).map((drawer) => ({ key: drawer.key, label: drawer.label, minor: drawer.totalMinor })) : [];
    return { key: group.key, label: group.label, totalMinor: blank ? null : items.reduce((sum, item) => sum + item.minor!, 0), items, parts };
  });
  return { kinds: shared(kinds), totalMinor: groups.reduce((sum, group) => sum + group.totalMinor, 0) };
}

/**
 * The debts side: every debt once, whole (the sheet's `debts`, never its two schedule groups), folded by what it is —
 * the same kinds the phone's Liabilities drawers fold by — in the order the kinds first appear.
 */
export function debtSide(debts: SheetGroup, kindOf: (row: SheetRow) => RowKind, unrated: ReadonlySet<string> = new Set()): DeskSide {
  const kinds = sheetDrawers(debts.rows, kindOf).map((drawer) => {
    const items: DeskItem[] = drawer.rows.map((row) => ({ accountId: row.accountId, name: row.name, minor: unrated.has(row.accountId) ? null : row.amountMinor, kind: { key: drawer.key, label: drawer.label }, approx: false }));
    const blank = items.some((item) => item.minor === null);
    return { key: drawer.key, label: drawer.label, totalMinor: blank ? null : drawer.totalMinor, items, parts: [] };
  });
  return { kinds: shared(kinds), totalMinor: debts.totalMinor };
}

/** What the treemap of a side divides: each kind with a figure, Investments with its parts. */
export function treemapOf(side: DeskSide): TreemapBox[] {
  return treemapStrip(side.kinds.flatMap((kind) => (kind.totalMinor === null ? [] : [{ key: kind.key, label: kind.label, minor: kind.totalMinor, parts: kind.parts }])));
}

/**
 * The change the chip beside the figure states: today's net worth against the month-end twelve months back, and the
 * per cent of that month's figure (one decimal). Null when the history does not reach that month, has no figure for it
 * (a rate missing then) or held nothing then — "in 12 months" from nothing is a change from before there was anything.
 * The per cent is left out when that month's figure was not above nothing.
 */
export function yearChange(
  points: readonly { month: string; netWorthMinor: number | null; assetsMinor: number | null; liabilitiesMinor: number | null }[],
  thisMonth: string,
  todayMinor: number,
): { changeMinor: number; percent: number | null } | null {
  const then = points.find((point) => point.month === addMonths(thisMonth, -12));
  if (!then || then.netWorthMinor === null) return null;
  if ((then.assetsMinor ?? 0) === 0 && (then.liabilitiesMinor ?? 0) === 0) return null;
  const changeMinor = todayMinor - then.netWorthMinor;
  const percent = then.netWorthMinor > 0 ? Math.round((changeMinor / then.netWorthMinor) * 1000) / 10 : null;
  return { changeMinor, percent };
}

/** Which months the chart names along its foot: every month for a year, fewer for longer, always the last. */
export function monthTicks(count: number, room: number): number[] {
  if (count <= 0) return [];
  const fit = Math.max(1, Math.floor(room / 34));
  const every = Math.max(1, Math.ceil(count / fit));
  const ticks: number[] = [];
  for (let index = count - 1; index >= 0; index -= every) ticks.unshift(index);
  return ticks;
}

/** The rows the peek steps through with ⌃ ⌄: the tables' rows in the order they are drawn, kinds and their open items. */
export type PeekKey = `asset-kind:${string}` | `debt-kind:${string}` | `asset:${string}` | `debt:${string}`;

export function peekOrder(assets: DeskSide, debts: DeskSide, folded: ReadonlySet<string>): PeekKey[] {
  const keys: PeekKey[] = [];
  for (const kind of assets.kinds) {
    keys.push(`asset-kind:${kind.key}`);
    if (!folded.has(`asset-kind:${kind.key}`)) for (const item of kind.items) keys.push(`asset:${item.accountId}`);
  }
  for (const kind of debts.kinds) {
    keys.push(`debt-kind:${kind.key}`);
    if (!folded.has(`debt-kind:${kind.key}`)) for (const item of kind.items) keys.push(`debt:${item.accountId}`);
  }
  return keys;
}

/**
 * The badge under the figure (v1, owner 2026-11-23): today's net worth against last month's month-end ("+2,1% since
 * October"), and the per cent of that figure (one decimal). Null when the history has no figure for last month, or held
 * nothing then. The per cent is left out when that month's figure was not above nothing.
 */
export function monthChange(
  points: readonly { month: string; netWorthMinor: number | null; assetsMinor: number | null; liabilitiesMinor: number | null }[],
  thisMonth: string,
  todayMinor: number,
): { changeMinor: number; percent: number | null; since: string } | null {
  const month = addMonths(thisMonth, -1);
  const then = points.find((point) => point.month === month);
  if (!then || then.netWorthMinor === null) return null;
  if ((then.assetsMinor ?? 0) === 0 && (then.liabilitiesMinor ?? 0) === 0) return null;
  const changeMinor = todayMinor - then.netWorthMinor;
  const percent = then.netWorthMinor > 0 ? Math.round((changeMinor / then.netWorthMinor) * 1000) / 10 : null;
  return { changeMinor, percent, since: new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long' }) };
}

/** Debts against assets, the Debts card's bar: what is owed as a whole per cent of what is held. Null with nothing held. */
export function debtsAgainstAssets(debtsMinor: number, assetsMinor: number): number | null {
  if (assetsMinor <= 0) return null;
  return Math.round((Math.max(0, debtsMinor) / assetsMinor) * 100);
}

/** The title's line: "21 November 2026 · 8 assets · 5 debts" — every row of each side, counted once. */
export function sheetLine(today: string, assets: DeskSide, debts: DeskSide): string {
  const count = (side: DeskSide) => side.kinds.reduce((sum, kind) => sum + kind.items.length, 0);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const day = new Date(`${today}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  return `${day} · ${plural(count(assets), 'asset', 'assets')} · ${plural(count(debts), 'debt', 'debts')}`;
}
