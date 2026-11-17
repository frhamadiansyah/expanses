import { sumToBase } from '@expanses/core';
import type { DayBalance } from '../accounts/balance-series';

/*
 * Wallet on a wide screen (Mac Wallet, owner 2026-11-17): the cards Wallet holds, grouped by what they are — bank
 * accounts, cash and e-wallets, credit cards, foreign currency — each group with its total in the base currency; the
 * split of where the money sits; and the Balance's month behind it. The cards, their figures and their order are
 * Wallet's own (`useWalletCards`); this only sorts them into groups and adds them up, by the Balance box's rules.
 */

export type DeskGroupKey = 'bank' | 'cash' | 'credit' | 'foreign';

export const DESK_GROUP_TITLES: Record<DeskGroupKey, string> = {
  bank: 'Bank accounts',
  cash: 'Cash & e-wallets',
  credit: 'Credit cards',
  foreign: 'Foreign currency',
};

const GROUP_ORDER: readonly DeskGroupKey[] = ['bank', 'cash', 'credit', 'foreign'];

/** One Wallet card as the groups read it: what it is and its figure. */
export interface DeskItem {
  key: string;
  name: string;
  /** Money (its balance) or a credit card (what is due on it now). */
  side: 'money' | 'credit';
  subtype: string;
  /** Every currency it holds: its own, or its pockets' kept for spending. */
  currencies: readonly string[];
  /**
   * Its figure in `currency`, as its face prints it: a balance (an account with pockets, their total in the base
   * currency), or what a card owes now. Null when a pocket's rate is missing, so its group says nothing either.
   */
  minor: number | null;
  currency: string;
}

/**
 * Which group a card goes in. A credit card is a credit card; money holding any currency but the base — a foreign
 * account, or an account with a foreign pocket — is foreign currency; then a current or saving account is a bank
 * account, and everything else money is (cash, a digital wallet, electronic money, other cash) cash and e-wallets.
 */
export function deskGroupOf(item: Pick<DeskItem, 'side' | 'subtype' | 'currencies'>, baseCurrency: string): DeskGroupKey {
  if (item.side === 'credit') return 'credit';
  if (item.currencies.some((currency) => currency !== baseCurrency)) return 'foreign';
  if (item.subtype === 'bank' || item.subtype === 'savings') return 'bank';
  return 'cash';
}

export interface DeskGroup {
  key: DeskGroupKey;
  title: string;
  /** The cards in it, in Wallet's order. */
  keys: string[];
  /**
   * What its faces add up to in the base currency: the money's balances, or — negative — what the cards owe, each
   * counted as the Balance box's Outstanding on cards counts it (only what is owed, never a card in credit). Null when a
   * rate is missing.
   */
  totalMinor: number | null;
  /** Some of it was converted from another currency, so the total is an estimate. */
  approx: boolean;
}

/** The groups that have cards, in the page's order, each card in Wallet's own order within its group. */
export function deskGroups(items: readonly DeskItem[], baseCurrency: string, rates: Readonly<Record<string, number>>): DeskGroup[] {
  return GROUP_ORDER.flatMap((key) => {
    const members = items.filter((item) => deskGroupOf(item, baseCurrency) === key);
    if (members.length === 0) return [];
    const unknown = members.some((item) => item.minor === null);
    const amounts = members.map((item) => ({
      minor: item.side === 'credit' ? -Math.max(0, item.minor ?? 0) : (item.minor ?? 0),
      currency: item.currency,
    }));
    const total = unknown ? null : sumToBase({ amounts, baseCurrency, ratesToBase: rates }).totalMinor;
    return [
      {
        key,
        title: DESK_GROUP_TITLES[key],
        keys: members.map((item) => item.key),
        totalMinor: total,
        approx: members.some((item) => item.currencies.some((currency) => currency !== baseCurrency)),
      },
    ];
  });
}

/** One part of the split bar: a money card, or the rest folded together. */
export interface SplitPart {
  /** The card's key, or `others` for the rest. */
  key: string;
  name: string;
  minor: number;
  /** Whole percents; the parts add up to 100. */
  percent: number;
  /** How many cards the part holds: 1, or the rest's count. */
  count: number;
}

/**
 * Where the money sits: each money card's share of what the money holds, in the base currency. The largest `named`
 * are named, the rest are one part ("Others", or the one card's name when only one is left). A card holding nothing,
 * overdrawn, or with no figure (a rate missing) has no share. The percents are whole and add up to 100, the remainders
 * going to the largest fractions first.
 */
export function moneySplit(items: readonly { key: string; name: string; baseMinor: number | null }[], named = 2): SplitPart[] {
  const held = items
    .map((item, index) => ({ ...item, index }))
    .filter((item): item is typeof item & { baseMinor: number } => item.baseMinor !== null && item.baseMinor > 0)
    .sort((a, b) => b.baseMinor - a.baseMinor || a.index - b.index);
  const total = held.reduce((sum, item) => sum + item.baseMinor, 0);
  if (total <= 0) return [];
  const top = held.slice(0, named).map((item) => ({
    key: item.key,
    name: item.name,
    minor: item.baseMinor,
    count: 1,
  }));
  const rest = held.slice(named);
  const parts =
    rest.length === 0
      ? top
      : rest.length === 1
        ? [
            ...top,
            {
              key: rest[0]!.key,
              name: rest[0]!.name,
              minor: rest[0]!.baseMinor,
              count: 1,
            },
          ]
        : [
            ...top,
            {
              key: 'others',
              name: 'Others',
              minor: rest.reduce((sum, item) => sum + item.baseMinor, 0),
              count: rest.length,
            },
          ];
  // Largest remainder: each part's floor, then the points left over to the largest fractions.
  const exact = parts.map((part) => (part.minor * 100) / total);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const byFraction = exact.map((value, index) => ({ index, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const { index } of byFraction) {
    if (left <= 0) break;
    floors[index]! += 1;
    left -= 1;
  }
  return parts.map((part, index) => ({ ...part, percent: floors[index]! }));
}

/**
 * How far the Balance moved over its line: today's figure less the line's first day's. The line walks the money back
 * through what moved (`balanceSeries`), so this is what came in less what went out of it; null with no line.
 */
export function lineChange(series: readonly DayBalance[] | null): number | null {
  if (!series || series.length < 2) return null;
  return series.at(-1)!.minor - series[0]!.minor;
}

/**
 * Wallet's order with one card dragged onto another: it takes the other's place, the cards between moving up one (or
 * down one, dragged back). Null when nothing would move.
 */
export function movedOnto(order: readonly string[], dragged: string, target: string): string[] | null {
  const from = order.indexOf(dragged);
  const to = order.indexOf(target);
  if (from < 0 || to < 0 || from === to) return null;
  const next = order.filter((key) => key !== dragged);
  next.splice(to, 0, dragged);
  return next;
}

/** How Wallet's cards are shown on a wide screen: faces, or plain rows. One device's choice, never synced. */
export type DeskView = 'cards' | 'list';
export const DESK_VIEW_KEY = 'wallet.desk-view';

export function readDeskView(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): DeskView {
  try {
    return storage?.getItem(DESK_VIEW_KEY) === 'list' ? 'list' : 'cards';
  } catch {
    return 'cards';
  }
}

export function writeDeskView(view: DeskView, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = globalThis.localStorage): void {
  try {
    if (view === 'cards') storage?.removeItem(DESK_VIEW_KEY);
    else storage?.setItem(DESK_VIEW_KEY, view);
  } catch {
    /* Not remembered: the view still changes for this visit. */
  }
}
