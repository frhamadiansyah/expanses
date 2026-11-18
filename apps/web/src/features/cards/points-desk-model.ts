import type { PointsWorth } from '@expanses/core';
import { faceFor, type FaceRef } from './debit-art/faces';
import { formatPoints } from './format-points';
import { programmeFamily, programmeTier } from './programme-art/programmes';

/*
 * Points on a wide screen (Mac Points, owner 2026-11-17, option A): the programmes in one table, each with a small card
 * before its name, over three boxes — what they are worth, what was earned each month, what expires next. The figures
 * are the phone's own (the programme's balance, its value per point or best redemption, its expiry lots); this only
 * picks each programme's face and adds them up.
 */

/**
 * The face a programme wears on the Mac Points page. A programme whose name finds a drawn membership card is that card
 * at its tier (`programmeFaceRef`, as the iPhone draws it). A bank's own points — BCA Rewards, CIMB Xtra, Maybank
 * TreatsPoints, a Jenius cashback — have no membership card, so on the Mac they wear their bank's drawn card instead:
 * the bank named by the programme's own name first, then by each earning card's issuer, then by each earning card's
 * name. A programme none of those name a drawn bank for keeps the plain face (null). The iPhone's faces are not this.
 */
export function pointsFaceRef(input: { name: string; tier: string | null | undefined; banks: readonly (string | null | undefined)[] }): FaceRef | null {
  const family = programmeFamily(input.name);
  if (family) return { key: programmeTier(family, input.tier).key, kind: 'membership', mark: family.mark };
  const bank = faceFor([input.name, ...input.banks], ['debit']);
  return bank ? { key: bank.key, kind: 'debit', mark: bank.mark } : null;
}

/** The tier word the table shows: the family's tier chosen in Settings, or none (a dash) when none is chosen. */
export function tierLabel(name: string, tier: string | null | undefined): string | null {
  const family = programmeFamily(name);
  if (!family || !tier) return null;
  return family.tiers.find((each) => each.id === tier)?.label ?? null;
}

export type PointsUnit = 'points' | 'miles' | 'cashback';
export const UNIT_LABELS: Record<PointsUnit, string> = { miles: 'Miles', points: 'Points', cashback: 'Cashback' };
const UNIT_ORDER: readonly PointsUnit[] = ['miles', 'points', 'cashback'];

/** One programme as the Worth box reads it: its unit and what its balance is worth (null when nothing says). */
export interface WorthInput {
  unit: PointsUnit;
  worth: PointsWorth | null;
}

export interface WorthBox {
  /** What every valued programme comes to in the base currency: exactly its unit rows added up. */
  totalMinor: number;
  /** One row a unit that has a valued programme, miles first. */
  units: { unit: PointsUnit; label: string; minor: number }[];
  /** Programmes with no value per point and no redemption to go by (or one in another currency): not in the total. */
  unvalued: number;
}

/** The Worth box: each unit's programmes' worth in the base currency, and their total, which is the rows' sum. */
export function worthBox(rows: readonly WorthInput[], baseCurrency: string): WorthBox {
  const byUnit = new Map<PointsUnit, number>();
  let unvalued = 0;
  for (const row of rows) {
    if (!row.worth || row.worth.currency !== baseCurrency) {
      unvalued += 1;
      continue;
    }
    byUnit.set(row.unit, (byUnit.get(row.unit) ?? 0) + row.worth.valueMinor);
  }
  const units = UNIT_ORDER.filter((unit) => byUnit.has(unit)).map((unit) => ({ unit, label: UNIT_LABELS[unit], minor: byUnit.get(unit)! }));
  return { totalMinor: units.reduce((sum, unit) => sum + unit.minor, 0), units, unvalued };
}

/** "2026-11" for a date. */
const monthKey = (date: string) => date.slice(0, 7);

function monthsBack(today: string, count: number): string[] {
  const [year, month] = today.split('-').map(Number) as [number, number];
  return Array.from({ length: count }, (_, index) => {
    const at = new Date(Date.UTC(year, month - 1 - (count - 1 - index), 1));
    return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export interface EarnedMonth {
  month: string;
  /** "Nov" */
  label: string;
  quantity: number;
  /** This month: its statements are still open, so its bar is drawn lighter. */
  current: boolean;
}

/**
 * The Earned box: what the cards earned into every programme each month, over the last `count` months, by the month a
 * statement's earning is dated (the day it closes, as each programme's history dates it). A statement still open, dated
 * after this month, is this month's. Only cards' earning counts — never a conversion in, a balance set by hand or a
 * redemption — and points, miles and cashback are counted alike, as the box says.
 */
export function earnedByMonth(rows: readonly { kind: string; on: string; quantity: number }[], today: string, count = 6): EarnedMonth[] {
  const months = monthsBack(today, count);
  const current = months[months.length - 1]!;
  const sums = new Map(months.map((month) => [month, 0]));
  for (const row of rows) {
    if (row.kind !== 'earn' || row.quantity <= 0) continue;
    const month = monthKey(row.on) > current ? current : monthKey(row.on);
    if (sums.has(month)) sums.set(month, sums.get(month)! + row.quantity);
  }
  return months.map((month) => ({
    month,
    label: new Date(`${month}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'short' }),
    quantity: sums.get(month)!,
    current: month === current,
  }));
}

/** A count over a bar, short: "840", "4,8k", "1,2M". */
export function shortCount(n: number): string {
  const abs = Math.abs(n);
  const short = (value: number, suffix: string) => `${value.toLocaleString('id-ID', { maximumFractionDigits: value < 10 ? 1 : 0 })}${suffix}`;
  if (abs < 1000) return formatPoints(n);
  if (abs < 1_000_000) return short(n / 1000, 'k');
  return short(n / 1_000_000, 'M');
}

const dayMonthYear = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** What of a programme expires next: the first date its lots die on, and how much of it is left by then. */
export interface NextExpiry {
  on: string;
  remaining: number;
  /** Within the warning window the phone warns in (its "3.000 expire 31 Dec"): said in orange. */
  soon: boolean;
  /** "6.000 expire 31 Dec" when soon (the phone's words), else "8.200 on 12 Mar 2027". */
  text: string;
}

/**
 * A programme's next expiry, as the table and the peek say it: the phone's own note when points die within its window
 * (`expiryNote`), else the earliest lot left to expire with its date. Null when nothing it holds has a date.
 */
export function nextExpiry(lots: readonly { expiresOn: string; remaining: number }[], phoneNote: string | null): NextExpiry | null {
  const first = lots.find((lot) => lot.remaining > 0);
  if (!first) return null;
  return phoneNote
    ? { on: first.expiresOn, remaining: first.remaining, soon: true, text: phoneNote }
    : { on: first.expiresOn, remaining: first.remaining, soon: false, text: `${formatPoints(first.remaining)} on ${dayMonthYear(first.expiresOn)}` };
}

/** The Expiring soon box: each programme's next expiry, soonest first, at most `limit`. */
export function expiringRows<T extends { name: string; unit: string; expiry: NextExpiry | null }>(rows: readonly T[], limit = 4): (T & { expiry: NextExpiry })[] {
  return rows
    .filter((row): row is T & { expiry: NextExpiry } => row.expiry !== null)
    .sort((a, b) => a.expiry.on.localeCompare(b.expiry.on) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** The singular a value per point is said in: "at Rp 200 a mile". Cashback is money already, so it has none. */
export const PER_UNIT: Record<PointsUnit, string | null> = { points: 'point', miles: 'mile', cashback: null };
