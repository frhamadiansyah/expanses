/**
 * The figures a calculator or a goal opens with. Every one is a prefill the user can overwrite; none is a rule.
 * Sourced in research-returns-by-horizon.md (2026-09-19), never in the user's own workbook — whose 18% is a window
 * that starts at the 1997/98 crisis trough and is nine years stale.
 */
export const DEFAULT_INFLATION_BPS = 350;
/** While saving for retirement: 6.28% real against 3.5% inflation. Never raise it without checking the inflation beside it. */
export const RETIREMENT_RETURN_BPS = 1000;
/** Once drawing down: de-risked, so lower. Also the payout's return in life cover. */
export const DRAWDOWN_RETURN_BPS = 500;
/** Fees rise faster than prices. */
export const EDUCATION_INFLATION_BPS = 1000;
/** An emergency fund sits in savings or a deposit, outside the horizon bands. */
export const EMERGENCY_RETURN_BPS = 200;

export interface ReturnBand {
  /** The band covers horizons up to this many months; null for the last, open-ended one. */
  upToMonths: number | null;
  returnBps: number;
  lowBps: number;
  highBps: number;
  label: string;
}

/** Boundaries at 1, 3 and 5 years. Nominal, net of fund fees, before any tax of the investor's own. */
export const RETURN_BANDS: readonly ReturnBand[] = [
  { upToMonths: 12, returnBps: 400, lowBps: 350, highBps: 500, label: '1 year or less' },
  { upToMonths: 36, returnBps: 500, lowBps: 450, highBps: 600, label: '1 to 3 years' },
  { upToMonths: 60, returnBps: 600, lowBps: 500, highBps: 700, label: '3 to 5 years' },
  { upToMonths: null, returnBps: 800, lowBps: 600, highBps: 1000, label: 'more than 5 years' },
];

export function returnBandFor(months: number): ReturnBand {
  return RETURN_BANDS.find((band) => band.upToMonths === null || months <= band.upToMonths)!;
}

export function assumedReturnBps(months: number): number {
  return returnBandFor(months).returnBps;
}

const pct = (bps: number) => (bps / 100).toLocaleString('en-US', { maximumFractionDigits: 1 });

export function bandHint(band: ReturnBand): string {
  return `${pct(band.returnBps)}% · ${band.label} · typically ${pct(band.lowBps)}–${pct(band.highBps)}%, net of fund fees; a deposit taxed at source earns less`;
}
