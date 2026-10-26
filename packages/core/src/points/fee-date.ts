/** Days from `from` to `to`, both `YYYY-MM-DD`; negative when `to` is earlier. */
function dayCount(from: string, to: string): number {
  const ms = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

/** The same month and day in `year`; 29 Feb falls on 28 Feb in a year without one. */
function inYear(date: string, year: number): string {
  const month = date.slice(5, 7);
  let day = Number(date.slice(8, 10));
  if (month === '02' && day === 29 && new Date(Date.UTC(year, 1, 29)).getUTCMonth() !== 1) day = 28;
  return `${String(year).padStart(4, '0')}-${month}-${String(day).padStart(2, '0')}`;
}

/**
 * When an annual fee is next charged: the date it was charged on, rolled forward whole years until it is on or after
 * today. A date still ahead is returned as it is. 29 Feb is charged on 28 Feb in a year with no 29th.
 */
export function nextFeeDate(chargedOn: string, today: string): string {
  if (chargedOn >= today) return chargedOn;
  const year = Number(today.slice(0, 4));
  // Always rolled from the stored date, so a 29 Feb lands on the 29th again in the next leap year.
  const thisYear = inYear(chargedOn, year);
  return thisYear >= today ? thisYear : inYear(chargedOn, year + 1);
}

/** How many days the next fee is away, 0 when it is today. */
export function feeDaysAway(chargedOn: string, today: string): number {
  return dayCount(today, nextFeeDate(chargedOn, today));
}

/** The days ahead within which a coming fee is flagged as due soon. */
export const FEE_SOON_DAYS = 30;

/** The charge a waiver covers: the coming one when it is within 30 days, else the latest one that has passed. */
export function coveredCharge(chargedOn: string, today: string): string {
  const next = nextFeeDate(chargedOn, today);
  if (feeDaysAway(chargedOn, today) <= FEE_SOON_DAYS) return next;
  return inYear(chargedOn, Number(next.slice(0, 4)) - 1);
}

/** Whether the charge a waiver would cover now has been waived: `waivedYear` is the year of the charge it covered. */
export function feeWaived(chargedOn: string, waivedYear: number | null, today: string): boolean {
  return waivedYear !== null && waivedYear === Number(coveredCharge(chargedOn, today).slice(0, 4));
}

/** The next charge once the covered one is waived: the one after it. */
export function chargeAfterWaiver(chargedOn: string, today: string): string {
  const covered = coveredCharge(chargedOn, today);
  return covered >= today ? inYear(chargedOn, Number(covered.slice(0, 4)) + 1) : nextFeeDate(chargedOn, today);
}

export interface UpcomingFee<T> {
  card: T;
  on: string;
  days: number;
}

/**
 * The cards whose annual fee is charged within `within` days (30 by default), soonest first. A card with no date is
 * left out, and so is one whose coming charge was waived.
 */
export function upcomingFees<T extends { annualFeeOn: string | null; annualFeeWaivedYear?: number | null }>(
  cards: readonly T[],
  today: string,
  within = FEE_SOON_DAYS,
): UpcomingFee<T>[] {
  return cards
    .flatMap((card) => {
      if (!card.annualFeeOn || feeWaived(card.annualFeeOn, card.annualFeeWaivedYear ?? null, today)) return [];
      const days = feeDaysAway(card.annualFeeOn, today);
      return days <= within ? [{ card, on: nextFeeDate(card.annualFeeOn, today), days }] : [];
    })
    .sort((a, b) => a.days - b.days);
}
