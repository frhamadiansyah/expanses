import { currencyInfo, formatMinor, groupedMajorString, groupTypedAmount, parseGroupedMajor } from '@expanses/core';

/**
 * Set aside typed in the list (owner, 14 Nov, option A): the sheet's decisions that are not drawing. Two groups — the
 * accounts already in the goal, and the ones that can add to it with what each has free — every row one line, and a
 * bar over the keyboard offering figures for the row being typed in.
 */

/** A money account as the list reads it. A pocket names the multicurrency account it sits in. */
export interface ListAccount {
  id: string;
  name: string;
  currency: string;
  /** The multicurrency account a pocket sits in; null for an account of its own. */
  parentId: string | null;
  parentName: string | null;
}

/** One line of a group: an account typed into, a multicurrency account's name (nothing to type), or one of its currencies under it. */
export type ListLine<A extends ListAccount = ListAccount> =
  | { type: 'account'; key: string; account: A }
  | { type: 'parent'; key: string; parentId: string; name: string }
  | { type: 'pocket'; key: string; account: A; code: string; last: boolean };

export interface SetAsideLists<A extends ListAccount = ListAccount> {
  /** Every account holding money for this goal, in the order the book keeps them. */
  inGoal: ListLine<A>[];
  /** Every account with room and nothing here yet, most free first. */
  canAdd: ListLine<A>[];
}

/** One unit of a group: an account of its own, or a multicurrency account and the pockets of it that belong in the group. */
type Unit<A extends ListAccount> = { parentId: string | null; parentName: string | null; members: A[] };

function unitsOf<A extends ListAccount>(accounts: readonly A[]): Unit<A>[] {
  const units: Unit<A>[] = [];
  const byParent = new Map<string, Unit<A>>();
  for (const account of accounts) {
    if (account.parentId === null) {
      units.push({ parentId: null, parentName: null, members: [account] });
      continue;
    }
    const seen = byParent.get(account.parentId);
    if (seen) {
      seen.members.push(account);
      continue;
    }
    const unit: Unit<A> = { parentId: account.parentId, parentName: account.parentName ?? account.name, members: [account] };
    byParent.set(account.parentId, unit);
    units.push(unit);
  }
  return units;
}

function linesOf<A extends ListAccount>(units: readonly Unit<A>[], group: string): ListLine<A>[] {
  return units.flatMap((unit): ListLine<A>[] => {
    if (unit.parentId === null) return [{ type: 'account', key: `${group}:${unit.members[0]!.id}`, account: unit.members[0]! }];
    return [
      { type: 'parent', key: `${group}:parent:${unit.parentId}`, parentId: unit.parentId, name: unit.parentName ?? '' },
      ...unit.members.map((account, index) => ({ type: 'pocket' as const, key: `${group}:${account.id}`, account, code: account.currency, last: index === unit.members.length - 1 })),
    ];
  });
}

/**
 * Most free first, compared in the goal's money. What has no rate cannot be compared, so it follows the ones that can,
 * in the order the book keeps them (`sort` is stable).
 */
function byMostFree<T>(items: readonly T[], worth: (item: T) => number | null): T[] {
  const rated = items.map((item) => ({ item, value: worth(item) }));
  return [...rated]
    .sort((a, b) => {
      if (a.value === null && b.value === null) return 0;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return b.value - a.value;
    })
    .map((entry) => entry.item);
}

/**
 * The sheet's two groups. Read from what is saved — never from what is typed — so a row typed into stays in its group
 * and its place until the sheet closes. An account with nothing free and nothing here is not listed.
 */
export function setAsideLists<A extends ListAccount>(
  accounts: readonly A[],
  opts: {
    /** What the goal holds on the account now (its saved set-aside), in the account's money. */
    heldMinor: (accountId: string) => number;
    /** What the account could hold for this goal (`roomFor`), in its money. */
    roomMinor: (accountId: string) => number;
    /** A figure in the goal's money, or null when no rate is stored for that currency. */
    inGoal: (minor: number, currency: string) => number | null;
  },
): SetAsideLists<A> {
  const held = accounts.filter((account) => opts.heldMinor(account.id) > 0);
  const open = accounts.filter((account) => opts.heldMinor(account.id) <= 0 && opts.roomMinor(account.id) > 0);
  const worth = (account: A) => opts.inGoal(Math.max(0, opts.roomMinor(account.id)), account.currency);
  const units = byMostFree(unitsOf(open), (unit) => {
    const values = unit.members.map(worth).filter((value): value is number => value !== null);
    return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
  }).map((unit) => ({ ...unit, members: byMostFree(unit.members, worth) }));
  return { inGoal: linesOf(unitsOf(held), 'in'), canAdd: linesOf(units, 'add') };
}

/** The figure in a row's field, in minor units: null when nothing is typed, or nothing a figure can be read from. */
export function typedMinor(text: string, currency: string): number | null {
  if (text.trim() === '') return null;
  try {
    return parseGroupedMajor(text, currency);
  } catch {
    return null;
  }
}

/**
 * A row's field as it is typed: grouped as it goes. A dot typed last, in a currency with cents, is the decimal mark —
 * the decimal keyboard of an English phone has a dot where an Indonesian one has a comma — as every other dot is a
 * thousands mark this puts in itself.
 */
export function typedText(raw: string, currency: string): string {
  const text = currencyInfo(currency).exponent > 0 && raw.endsWith('.') && !raw.includes(',') ? `${raw.slice(0, -1)},` : raw;
  return groupTypedAmount(text, currency);
}

/** What a row puts in its field when a slot of the bar is tapped. */
export const fillText = (minor: number, currency: string) => groupedMajorString(Math.max(0, minor), currency);

/** A row's figure, as the sheet counts it: what is typed once anything is, else what the goal holds there. */
export function amountNow(typed: string | undefined, heldMinor: number, currency: string): number {
  if (typed === undefined) return heldMinor;
  return typedMinor(typed, currency) ?? 0;
}

/**
 * True when the row asks for more than the account can hold for this goal: drawn in warn, and the sheet's Save waits.
 * Nothing, or no more than the row already holds, is never over: an account already short (what is free below
 * nothing) can still be taken back from or lowered, since neither adds to what it owes its goals.
 */
export const isOver = (typed: string | undefined, roomMinor: number, heldMinor: number, currency: string): boolean => {
  if (typed === undefined) return false;
  const minor = typedMinor(typed, currency);
  return minor !== null && minor > 0 && minor > Math.max(roomMinor, heldMinor);
};

/** Save waits while any row asks for more than it can hold. */
export const canSaveSetAside = (rows: readonly { over: boolean }[]): boolean => rows.every((row) => !row.over);

/**
 * What the goal still needs, in its money, counting what is typed on the rows: each row's change from what it holds
 * now, at the day's rate. A row whose currency has no rate cannot be counted and is left out. Null when the goal has
 * no target to need anything against.
 */
export function stillNeeded(
  neededMinor: number | null,
  rows: readonly { amountMinor: number; heldMinor: number; currency: string }[],
  inGoal: (minor: number, currency: string) => number | null,
): number | null {
  if (neededMinor === null) return null;
  let left = neededMinor;
  for (const row of rows) {
    const change = inGoal(row.amountMinor - row.heldMinor, row.currency);
    if (change !== null) left -= change;
  }
  return left;
}

/** One slot of the bar over the keyboard: a figure, a small grey word under it, and what a tap puts in the field (null: information only). */
export interface BarSlot {
  key: string;
  title: string;
  detail: string;
  label: string;
  fill: string | null;
  warn?: boolean;
}

/**
 * The bar over the keyboard for the row being typed in. Three slots, as iOS offers words there:
 * - a row new to the goal: all it has free (or as much as fills the goal, when that is less), half of that, and what
 *   the goal still needs — or, in another currency than the goal's, what the row adds in the goal's money (≈);
 * - a row already in the goal: the most it can hold, Rp 0 to take it back, and what the goal still needs;
 * - a row asking for more than it can hold: one slot, in warn, that puts in the most it can.
 */
export function setAsideBar(p: {
  currency: string;
  goalCurrency: string;
  /** What the goal holds on the account now. */
  heldMinor: number;
  /** The most the account can hold for this goal (`roomFor`): what is free, and what the goal holds there already. */
  roomMinor: number;
  /** The field's text, or undefined when it was never touched. */
  typed: string | undefined;
  /** What the goal still needs counting every other row's figure, but not this one's; null with no target. In the goal's money. */
  neededMinor: number | null;
  inGoal: (minor: number, currency: string) => number | null;
  fromGoal: (minor: number, currency: string) => number | null;
}): BarSlot[] {
  const { currency, goalCurrency } = p;
  const room = Math.max(0, p.roomMinor);
  if (isOver(p.typed, p.roomMinor, p.heldMinor, currency)) {
    return [{ key: 'only', title: `Only ${formatMinor(room, currency)} free`, detail: 'tap to use it', label: `Use the ${formatMinor(room, currency)} free`, fill: fillText(room, currency), warn: true }];
  }
  const own = amountNow(p.typed, p.heldMinor, currency);
  const change = p.inGoal(own - p.heldMinor, currency);
  const needed = p.neededMinor === null ? null : Math.max(0, p.neededMinor - (change ?? 0));
  const neededSlot: BarSlot[] =
    needed === null ? [] : [{ key: 'needed', title: formatMinor(needed, goalCurrency), detail: 'still needed', label: `${formatMinor(needed, goalCurrency)} still needed`, fill: null }];

  if (p.heldMinor > 0) {
    return [
      { key: 'most', title: formatMinor(room, currency), detail: 'Most possible', label: `Most possible, ${formatMinor(room, currency)}`, fill: fillText(room, currency) },
      { key: 'back', title: formatMinor(0, currency), detail: 'Take back', label: 'Take back', fill: fillText(0, currency) },
      ...neededSlot,
    ];
  }

  // Nothing more is needed (the goal is whole, or more than whole, before this row): nothing to fill, only what it says.
  const adds = p.inGoal(own, currency);
  const addsSlot: BarSlot =
    adds === null
      ? { key: 'adds', title: 'No rate yet', detail: 'this adds', label: `No ${goalCurrency} rate yet`, fill: null }
      : { key: 'adds', title: `≈ ${formatMinor(adds, goalCurrency)}`, detail: 'this adds', label: `About ${formatMinor(adds, goalCurrency)} this adds`, fill: null };
  const lastSlot = currency === goalCurrency ? neededSlot : [addsSlot];
  if (p.neededMinor !== null && p.neededMinor <= 0) return lastSlot;

  // Capped by what the goal still needs (before this row's own figure), in the account's money.
  const need = p.neededMinor !== null ? p.fromGoal(p.neededMinor, currency) : null;
  const capped = need !== null && need < room;
  const top = capped ? need : room;
  const half = Math.floor(top / 2);
  const first: BarSlot = capped
    ? { key: 'top', title: formatMinor(top, currency), detail: 'Fills goal', label: `Fills goal, ${formatMinor(top, currency)}`, fill: fillText(top, currency) }
    : { key: 'top', title: formatMinor(top, currency), detail: 'All free', label: `All free, ${formatMinor(top, currency)}`, fill: fillText(top, currency) };
  const halfSlot: BarSlot = { key: 'half', title: formatMinor(half, currency), detail: 'Half', label: `Half, ${formatMinor(half, currency)}`, fill: fillText(half, currency) };
  return [first, halfSlot, ...lastSlot];
}

/**
 * What a figure carries before its digits ("Rp" and its space, "US$"), drawn before the field once it is typed in, so a
 * typed figure reads exactly as the grey one it replaced.
 */
export function currencySign(currency: string): string {
  try {
    return /^[^\d-]*/.exec(formatMinor(0, currency))?.[0] ?? currency;
  } catch {
    return currency;
  }
}
