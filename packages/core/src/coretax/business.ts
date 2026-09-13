/**
 * Business and freelance income for the return.
 *
 * This is the one place the app works out tax itself. Everywhere else it adds up figures you
 * recorded from a slip, but no slip exists here: UMKM is a final 0,5% you calculate and pay
 * yourself, and NPPN turns turnover into net income by a percentage that depends on the trade and
 * the city — which only the owner can supply, so nothing is preset.
 */

export type BusinessScheme = 'umkm_final' | 'nppn';

/** PP 55/2022: 0,5% of turnover, final. */
export const UMKM_RATE_BPS = 50;

const BPS = 10_000;

export interface BusinessSource {
  id: string;
  name: string;
  scheme: BusinessScheme;
  /** NPPN only: the norma percentage for this trade, in basis points. Nobody else can know it. */
  normaRateBps: number | null;
  /** UMKM only: whether the exempt first slice of turnover applies. Off once the window is spent. */
  thresholdApplies: boolean;
}

export interface TurnoverMonth {
  /** 1 to 12. */
  month: number;
  amountMinor: number;
}

export interface BusinessInput {
  sources: BusinessSource[];
  /** Turnover by source id. Months arrive in any order, and a month with nothing recorded is nil. */
  turnover: Record<string, TurnoverMonth[]>;
  /** The slice of a year's turnover an individual is not taxed on. */
  thresholdMinor: number;
  /** Above this the scheme stops applying for the year. */
  ceilingMinor: number;
}

export interface UmkmMonth {
  month: number;
  turnoverMinor: number;
  cumulativeMinor: number;
  exemptMinor: number;
  taxableMinor: number;
  taxMinor: number;
}

export interface UmkmResult {
  sourceId: string;
  name: string;
  months: UmkmMonth[];
  grossMinor: number;
  exemptMinor: number;
  taxableMinor: number;
  taxMinor: number;
  /** The month the exempt slice ran out, or null while it still covers everything. */
  crossedInMonth: number | null;
}

export interface NppnResult {
  sourceId: string;
  name: string;
  grossMinor: number;
  normaRateBps: number | null;
  /** Turnover times the norma percentage. Ordinary income, taxed progressively with the rest. */
  netMinor: number;
}

export interface BusinessProblem {
  sourceId: string;
  level: 'blocking' | 'warning';
  message: string;
}

export interface BusinessReport {
  umkm: UmkmResult[];
  nppn: NppnResult[];
  problems: BusinessProblem[];
}

/** Twelve months in order, whatever order they were recorded in. A duplicate month adds up. */
function monthsOf(entries: TurnoverMonth[] | undefined): number[] {
  const byMonth = new Array<number>(12).fill(0);
  for (const entry of entries ?? []) {
    if (!Number.isInteger(entry.month) || entry.month < 1 || entry.month > 12) continue;
    byMonth[entry.month - 1] = (byMonth[entry.month - 1] ?? 0) + entry.amountMinor;
  }
  return byMonth;
}

/**
 * Walks the year in order, spending the exempt slice as it goes. Which month the slice runs out in
 * is what decides the tax, so the walk has to be monthly even though the threshold is annual.
 */
function umkmFor(source: BusinessSource, amounts: number[], thresholdMinor: number): UmkmResult {
  let remaining = source.thresholdApplies ? thresholdMinor : 0;
  let cumulative = 0;
  let crossedInMonth: number | null = null;
  const months: UmkmMonth[] = [];

  for (let index = 0; index < 12; index += 1) {
    const turnoverMinor = amounts[index]!;
    cumulative += turnoverMinor;
    const exemptMinor = Math.min(remaining, Math.max(0, turnoverMinor));
    remaining -= exemptMinor;
    const taxableMinor = turnoverMinor - exemptMinor;
    if (crossedInMonth === null && taxableMinor > 0 && source.thresholdApplies) crossedInMonth = index + 1;
    months.push({
      month: index + 1,
      turnoverMinor,
      cumulativeMinor: cumulative,
      exemptMinor,
      taxableMinor,
      taxMinor: Math.round((taxableMinor * UMKM_RATE_BPS) / BPS),
    });
  }

  const sum = (pick: (month: UmkmMonth) => number) => months.reduce((total, month) => total + pick(month), 0);
  return {
    sourceId: source.id,
    name: source.name,
    months,
    grossMinor: cumulative,
    exemptMinor: sum((month) => month.exemptMinor),
    taxableMinor: sum((month) => month.taxableMinor),
    taxMinor: sum((month) => month.taxMinor),
    crossedInMonth,
  };
}

/**
 * Both schemes for the year, and what is missing before either can be filed.
 * Nothing is guessed: a norma percentage left blank produces a problem, never a default.
 */
export function businessIncomeFor(input: BusinessInput): BusinessReport {
  const report: BusinessReport = { umkm: [], nppn: [], problems: [] };

  for (const source of input.sources) {
    const amounts = monthsOf(input.turnover[source.id]);
    const grossMinor = amounts.reduce((total, amount) => total + amount, 0);

    if (amounts.some((amount) => amount < 0)) {
      report.problems.push({ sourceId: source.id, level: 'blocking', message: `${source.name} has a month of turnover below nought` });
    }

    if (source.scheme === 'umkm_final') {
      report.umkm.push(umkmFor(source, amounts, input.thresholdMinor));
      if (grossMinor > input.ceilingMinor) {
        report.problems.push({
          sourceId: source.id,
          level: 'warning',
          message: `${source.name} passed the ceiling for the 0,5% scheme this year, so it no longer applies`,
        });
      }
      continue;
    }

    const normaRateBps = source.normaRateBps;
    report.nppn.push({
      sourceId: source.id,
      name: source.name,
      grossMinor,
      normaRateBps,
      netMinor: normaRateBps === null ? 0 : Math.round((grossMinor * normaRateBps) / BPS),
    });
    if (normaRateBps === null) {
      report.problems.push({
        sourceId: source.id,
        level: 'blocking',
        message: `${source.name} needs the norma percentage for its KLU before its net income can be worked out`,
      });
    }
    if (grossMinor > input.ceilingMinor) {
      report.problems.push({
        sourceId: source.id,
        level: 'warning',
        message: `${source.name} passed the ceiling for norma, which is only open below it`,
      });
    }
  }

  return report;
}
