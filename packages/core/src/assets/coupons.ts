import { currencyInfo } from '../money/currencies';

/*
 * A bond's coupon: a rate a year on its par value, paid a set number of times a year on a set day of the month, until
 * it matures. Pure arithmetic, so the schedule and the figure are the same on every screen that shows them.
 */

/** How many times a year a coupon is paid: yearly, every 6 months, every 3 months, monthly. */
export const COUPON_FREQUENCIES = [1, 2, 4, 12] as const;
export type CouponsPerYear = (typeof COUPON_FREQUENCIES)[number];

/** One coupon before tax, in minor units: par × rate ÷ payments a year. Par is the bond's units (its par value). */
export function couponGrossMinor(o: { parUnitsMicro: number; rateBps: number; perYear: CouponsPerYear; currency: string }): number {
  const par = o.parUnitsMicro / 1_000_000;
  return Math.round(((par * o.rateBps) / 10_000 / o.perYear) * 10 ** currencyInfo(o.currency).exponent);
}

/** The tax withheld from one coupon, at `taxBps` of it (10% is 1000), never more than the coupon. */
export function couponTaxMinor(grossMinor: number, taxBps: number): number {
  return Math.min(grossMinor, Math.round((grossMinor * taxBps) / 10_000));
}

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The payment after `on`: 12 ÷ per-year months on, on the bond's pay day — the month's last day when it is shorter. */
export function nextCouponOn(on: string, perYear: CouponsPerYear, payDay: number): string {
  const [y, m] = on.split('-').map(Number) as [number, number];
  const months = y * 12 + (m - 1) + 12 / perYear;
  const year = Math.floor(months / 12);
  const month = (months % 12) + 1;
  const day = Math.min(payDay, daysIn(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Every payment from `nextOn` up to and including `today` — and never past `maturesOn` — oldest first. Capped, so a
 * term left years behind cannot record without end in one go.
 */
export function dueCouponDates(o: { nextOn: string; perYear: CouponsPerYear; payDay: number; maturesOn: string | null; today: string }, cap = 60): string[] {
  const out: string[] = [];
  let on = o.nextOn;
  while (on <= o.today && (o.maturesOn === null || on <= o.maturesOn) && out.length < cap) {
    out.push(on);
    on = nextCouponOn(on, o.perYear, o.payDay);
  }
  return out;
}

/** The payment before `on`: 12 ÷ per-year months back, on the bond's pay day — the month's last day when it is shorter. */
export function previousCouponOn(on: string, perYear: CouponsPerYear, payDay: number): string {
  const [y, m] = on.split('-').map(Number) as [number, number];
  const months = y * 12 + (m - 1) - 12 / perYear;
  const year = Math.floor(months / 12);
  const month = (months % 12) + 1;
  const day = Math.min(payDay, daysIn(year, month));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Every payment of a bond's schedule from `from` to `to`, both included, oldest first — walked back from its next
 * payment for the ones before it — and never past `maturesOn`. What the Dividends page reads a bond's coupons from.
 */
export function couponDatesBetween(o: { nextOn: string; perYear: CouponsPerYear; payDay: number; maturesOn: string | null; from: string; to: string }): string[] {
  let start = o.nextOn;
  while (start >= o.from) start = previousCouponOn(start, o.perYear, o.payDay);
  const out: string[] = [];
  for (let on = nextCouponOn(start, o.perYear, o.payDay); on <= o.to && (o.maturesOn === null || on <= o.maturesOn); on = nextCouponOn(on, o.perYear, o.payDay)) {
    if (on >= o.from) out.push(on);
  }
  return out;
}
