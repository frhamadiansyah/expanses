import { formatMinor } from '@expanses/core';

/**
 * The grey line under Mac Goals' title (v1): how many goals are running, what is saved for them, and how many are done.
 * "3 goals · Rp 32.000.000 saved · 1 done"; one goal reads "1 goal"; none at all reads "No goals yet". The saved figure is
 * `goalsTotals`' own (the running goals' money, in the base currency), never recounted here.
 */
export function goalsTitleLine({ running, done, savedMinor, currency }: { running: number; done: number; savedMinor: number; currency: string }): string {
  if (running === 0 && done === 0) return 'No goals yet';
  const parts = [`${running} ${running === 1 ? 'goal' : 'goals'}`];
  if (running > 0) parts.push(`${formatMinor(savedMinor, currency)} saved`);
  if (done > 0) parts.push(`${done} done`);
  return parts.join(' · ');
}
