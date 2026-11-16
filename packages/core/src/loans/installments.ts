export interface CardInstallment {
  totalMinor: number;
  months: number;
  monthlyMinor: number;
  /** First month it appears on a statement, as YYYY-MM. */
  firstBilledMonth: string;
  rateBps: number;
  /** A one-off charge for converting the purchase; billed on its own, not part of the instalments. */
  conversionFeeMinor: number;
  /** Many issuers pay no points on a converted purchase. */
  earnsPoints: boolean;
}

export interface InstallmentSplit {
  billedMinor: number;
  unbilledMinor: number;
  /** The part falling due more than twelve months out, which is long-term on the balance sheet. */
  unbilledBeyond12Minor: number;
  monthsLeft: number;
  /** The month the last instalment is billed, as YYYY-MM. */
  lastMonth: string;
}

const MONTHS_IN_YEAR = 12;

/** Whole months from one YYYY-MM to another. */
function monthsBetween(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  return (toYear! - fromYear!) * MONTHS_IN_YEAR + (toMonth! - fromMonth!);
}

function addMonthsTo(month: string, count: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const total = (monthNumber! - 1) + count;
  return `${year! + Math.floor(total / MONTHS_IN_YEAR)}-${String((((total % MONTHS_IN_YEAR) + MONTHS_IN_YEAR) % MONTHS_IN_YEAR) + 1).padStart(2, '0')}`;
}

/**
 * Where one installment plan stands on a date: what the card has billed, what it has not, and how
 * much of the rest falls due beyond a year. The purchase was spending on the day it happened; these
 * figures only say how the debt is carried.
 */
export function installmentSplit(installment: CardInstallment, onDate: string): InstallmentSplit {
  const month = onDate.slice(0, 7);
  const elapsed = monthsBetween(installment.firstBilledMonth, month);
  const billedMonths = Math.min(installment.months, Math.max(0, elapsed + 1));
  const monthsLeft = installment.months - billedMonths;

  // The last instalment carries any rounding, so the parts always add back to the total.
  const billedMinor = billedMonths >= installment.months ? installment.totalMinor : billedMonths * installment.monthlyMinor;
  const unbilledMinor = installment.totalMinor - billedMinor;
  const beyondMonths = Math.max(0, monthsLeft - MONTHS_IN_YEAR);
  const unbilledBeyond12Minor = Math.min(unbilledMinor, beyondMonths * installment.monthlyMinor);

  return {
    billedMinor,
    unbilledMinor,
    unbilledBeyond12Minor,
    monthsLeft,
    lastMonth: addMonthsTo(installment.firstBilledMonth, installment.months - 1),
  };
}

export interface InstallmentBilling {
  /** 1 for the first instalment. */
  number: number;
  /** The statement date it is billed on. */
  statementOn: string;
  amountMinor: number;
}

/**
 * Each instalment of a plan and the statement it is billed on: the statement that closes in its month, on the
 * card's statement day (the month's last day when that day does not exist). The last instalment carries the
 * rounding, so the parts add back to the total.
 */
export function installmentSchedule(installment: CardInstallment, statementDay: number): InstallmentBilling[] {
  return Array.from({ length: installment.months }, (_, index) => {
    const month = addMonthsTo(installment.firstBilledMonth, index);
    const [year, monthNumber] = month.split('-').map(Number) as [number, number];
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
    const last = index === installment.months - 1;
    return {
      number: index + 1,
      statementOn: `${month}-${String(Math.min(statementDay, lastDay)).padStart(2, '0')}`,
      amountMinor: last ? installment.totalMinor - installment.monthlyMinor * (installment.months - 1) : installment.monthlyMinor,
    };
  });
}

/**
 * How a plan's spending counts (0120): the whole purchase on its own day (`at_purchase`, each instalment then only a
 * repayment of the card), or each instalment as that month's spending on its statement date (`each_month`, the
 * purchase it came from then counting nothing).
 */
export type InstalmentCountMode = 'at_purchase' | 'each_month';

export const INSTALMENT_COUNT_MODES: readonly InstalmentCountMode[] = ['at_purchase', 'each_month'];

/** One share of an amount to hand out: a key (a category) and how much of the whole it stands for. */
export interface PartWeight {
  key: string;
  weight: number;
}

/**
 * An amount shared out by weight, the remainder going to the largest fractions so the parts add back exactly.
 * `whole`, when given, is what all the weights would come to: weights adding up to less (a purchase only partly in the
 * workspace being read) hand out that share of the amount, not all of it. Parts of no weight are left out.
 */
export function splitByParts(amountMinor: number, parts: readonly PartWeight[], whole?: number): { key: string; amountMinor: number }[] {
  const weighted = parts.filter((part) => part.weight > 0);
  const given = weighted.reduce((sum, part) => sum + part.weight, 0);
  if (given <= 0) return [];
  const of = whole && whole > given ? whole : given;
  const target = Math.round((amountMinor * given) / of);
  const exact = weighted.map((part) => (target * part.weight) / given);
  const floors = exact.map(Math.floor);
  let left = target - floors.reduce((sum, n) => sum + n, 0);
  const order = exact.map((value, index) => ({ index, rest: value - floors[index]! })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    floors[index]! += 1;
    left -= 1;
  }
  return weighted.map((part, index) => ({ key: part.key, amountMinor: floors[index]! }));
}

/** One instalment of a plan counted as spending: on its statement date, in one of the purchase's categories. */
export interface InstalmentSpendingLine {
  number: number;
  of: number;
  statementOn: string;
  categoryKey: string;
  amountMinor: number;
}

/**
 * A plan's instalments as spending lines: each on the statement date it is billed on (`installmentSchedule`), shared
 * across the purchase's categories by their weight. The last instalment carries the rounding, so a single-category plan
 * adds back to its total. No category, no lines.
 */
export function instalmentSpendingLines(
  installment: CardInstallment,
  statementDay: number,
  parts: readonly PartWeight[],
  whole?: number,
): InstalmentSpendingLine[] {
  return installmentSchedule(installment, statementDay).flatMap((bill) =>
    splitByParts(bill.amountMinor, parts, whole).map((part) => ({
      number: bill.number,
      of: installment.months,
      statementOn: bill.statementOn,
      categoryKey: part.key,
      amountMinor: part.amountMinor,
    })),
  );
}

/** The lines whose statement date falls in [from, to]: a period's months already follow Month starts on. */
export function instalmentsCountedIn<T extends { statementOn: string }>(lines: readonly T[], from: string, to: string): T[] {
  return lines.filter((line) => line.statementOn >= from && line.statementOn <= to);
}

/** A card line a plan's purchase may be: what a card statement holds of it (`StatementLine`), in the card's currency. */
export interface PlanPurchaseLine {
  transactionId: string;
  occurredOn: string;
  /** What it charged the card, in the card's currency: a purchase abroad is matched by this, not the merchant's figure. */
  owedMinor: number;
  spending: boolean;
  instalment: unknown;
  balancing: boolean;
  convertedTo: { planId: string } | null;
  originalCurrency?: string | null;
  originalAmountMinor?: number | null;
  /** An investment bought with the card (a bond, a stock, a fund): a charge, but never spending. */
  trade?: boolean;
}

/**
 * The card's own charges a plan can be tied to: a purchase or an investment bought with the card — not a payment, an
 * instalment row or a balancing line, nor another plan's.
 */
export function purchaseCandidates<T extends PlanPurchaseLine>(lines: readonly T[], planId: string | null): T[] {
  return lines.filter((line) => (line.spending || line.trade === true) && line.owedMinor > 0 && !line.instalment && !line.balancing && (!line.convertedTo || line.convertedTo.planId === planId));
}

/** Where a plan's purchase is looked for: the first day three months before its first billed month to that month's last day. */
export function planPurchaseWindow(firstBilledMonth: string): { from: string; to: string } {
  const [year, month] = firstBilledMonth.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${addMonthsTo(firstBilledMonth, -3)}-01`, to: `${firstBilledMonth}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * The one purchase on the card a plan was converted from: charging the plan's total, in its window, no other plan's.
 * Null when there is none, or more than one — then it is the owner's to say.
 */
export function matchPlanPurchase(lines: readonly PlanPurchaseLine[], plan: { id: string | null; totalMinor: number; firstBilledMonth: string }): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(plan.firstBilledMonth) || !(plan.totalMinor > 0)) return null;
  const { from, to } = planPurchaseWindow(plan.firstBilledMonth);
  const found = [...new Set(purchaseCandidates(lines, plan.id).filter((line) => line.owedMinor === plan.totalMinor && line.occurredOn >= from && line.occurredOn <= to).map((line) => line.transactionId))];
  return found.length === 1 ? found[0]! : null;
}

/**
 * Whether a plan with no purchase may be counted twice (owner, 16 Nov 2026, simplified): the card holds a purchase of the
 * plan's total that no plan is tied to — very likely the one it was converted from, then billed both whole and a month
 * at a time. Nothing else is guessed: a plan with no purchase is one whose purchase is not in the app.
 */
export function unlinkedPurchaseOfTotal(lines: readonly PlanPurchaseLine[], plan: { id: string | null; totalMinor: number }): boolean {
  return purchaseCandidates(lines, plan.id).some((line) => line.owedMinor === plan.totalMinor && !line.convertedTo);
}

/**
 * The instalments billed on or after a day: for a plan tied to a purchase, the day the card starts in the app (one billed
 * before is inside its opening balance); for a plan with no purchase, the statement date of its first instalment not
 * paid (`countedFromOf`). Every instalment with no day.
 */
export function instalmentsFrom<T extends { statementOn: string }>(bills: readonly T[], recordsFrom: string | null): T[] {
  return recordsFrom === null ? [...bills] : bills.filter((bill) => bill.statementOn >= recordsFrom);
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** The first due day after a statement date (the month's last day when that day does not exist). */
export function dueDateAfter(statementOn: string, dueDay: number): string {
  let [y, m] = statementOn.split('-').map(Number) as [number, number];
  for (let i = 0; i < 2; i += 1) {
    const candidate = `${y}-${pad2(m)}-${pad2(Math.min(dueDay, lastDayOf(y, m)))}`;
    if (candidate > statementOn) return candidate;
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return `${y}-${pad2(m)}-${pad2(Math.min(dueDay, lastDayOf(y, m)))}`;
}

/** When an instalment's payment is due: the card's due day after its statement date, or that date with no due day. */
export const instalmentDueOn = (statementOn: string, dueDay: number | null): string => (dueDay === null ? statementOn : dueDateAfter(statementOn, dueDay));

/*
 * A plan with no purchase in the app (owner, 17 Nov 2026) keeps how many of its instalments are paid, `paid_so_far`: set
 * when it is added — every instalment whose payment was due before that day — and changed only by ticking its list.
 * The rest is what the card still owes of it. One rule; nothing else is guessed.
 */

/** How many of a plan's instalments were paid by `addedOn`: those whose payment was due before that day. */
export function paidSoFarOn(plan: CardInstallment, statementDay: number, dueDay: number | null, addedOn: string): number {
  return installmentSchedule(plan, statementDay).filter((bill) => instalmentDueOn(bill.statementOn, dueDay) < addedOn).length;
}

/** What is still owed of a plan with `paidSoFar` instalments paid: the instalments after them, the last carrying the rounding. */
export function owedAfter(plan: CardInstallment, paidSoFar: number): number {
  if (paidSoFar >= plan.months) return 0;
  return plan.totalMinor - plan.monthlyMinor * Math.max(0, paidSoFar);
}

/** Ticking instalment `number` in the plan's list: it and every one before it are paid. Unticking a paid one leaves those before it. */
export const tickedPaidSoFar = (paidSoFar: number, number: number): number => (number > paidSoFar ? number : number - 1);

/** A count of paid instalments that can stand: a whole number from none to all of them. */
export const clampPaidSoFar = (paidSoFar: number, months: number): number => (Number.isInteger(paidSoFar) ? Math.min(Math.max(paidSoFar, 0), months) : 0);

/**
 * The day a plan with no purchase counts from, in every reading of spending and on another phone (plan_spreads'
 * `records_from`): the statement date of its first instalment not paid. Null with none paid (all count); the day after
 * its last with all paid (none counts).
 */
export function countedFromOf(schedule: readonly InstallmentBilling[], paidSoFar: number): string | null {
  if (paidSoFar <= 0 || schedule.length === 0) return null;
  const next = schedule[paidSoFar];
  if (next) return next.statementOn;
  const after = new Date(`${schedule.at(-1)!.statementOn}T00:00:00Z`);
  after.setUTCDate(after.getUTCDate() + 1);
  return after.toISOString().slice(0, 10);
}

/**
 * The month a purchase turned into instalments is first billed in (Turn into instalments): the statement after the one
 * the purchase itself falls on — that one closes on or after the purchase's day, by the card's statement day (the
 * month's last day when that day does not exist) — as the owner's example has it: bought 10 Nov, statement day the
 * 18th, first billed December.
 */
export function firstBilledMonthFor(occurredOn: string, statementDay: number): string {
  const month = occurredOn.slice(0, 7);
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const statementOn = `${month}-${String(Math.min(Math.max(1, statementDay), lastDay)).padStart(2, '0')}`;
  const purchaseStatement = occurredOn <= statementOn ? month : addMonthsTo(month, 1);
  return addMonthsTo(purchaseStatement, 1);
}
