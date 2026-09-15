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
  return `${year! + Math.floor(total / MONTHS_IN_YEAR)}-${String((total % MONTHS_IN_YEAR) + 1).padStart(2, '0')}`;
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
