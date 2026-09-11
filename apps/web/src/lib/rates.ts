import { parseRate } from '@expanses/core';
import { type Database, findRate } from '@expanses/db';

/** Human-readable reading of a typed rate, so "16.500" visibly shows as 16,5 before it is saved. */
export function ratePreview(input: string, from: string, to: string): string | null {
  if (!input.trim()) return null;
  try {
    const rate = parseRate(input);
    return `Reads as 1 ${from} = ${rate.toLocaleString('id-ID', { maximumFractionDigits: 8 })} ${to}`;
  } catch {
    return 'Not a valid rate';
  }
}

/** Rejects a manual rate more than 10× away from the nearest known rate — almost always a decimal separator slip. */
export async function checkManualRate(database: Database, from: string, to: string, onDate: string, rate: number): Promise<void> {
  const reference = (await findRate(database, from, to, onDate)) ?? (await findRate(database, from, to, '9999-12-31'));
  if (!reference) return;
  const ratio = rate / reference.rate;
  if (ratio > 10 || ratio < 0.1) {
    const how = ratio > 1 ? `${Math.round(ratio)}× higher` : `${Math.round(1 / ratio)}× lower`;
    throw new Error(
      `${rate.toLocaleString('id-ID')} is ${how} than the last known ${from}→${to} rate (${reference.rate.toLocaleString('id-ID')}). Check the decimal separator.`,
    );
  }
}
