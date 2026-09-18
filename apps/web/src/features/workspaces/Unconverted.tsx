import { isoDate } from '@expanses/core';
import { shortDate } from '../transactions/quick-row';

/**
 * What a figure leaves out, said above it.
 *
 * A workspace that reads in its own currency converts each amount at the rate on its own day, and rates are kept
 * one way round: a workspace in dollars needs rupiah→dollar rows. Rather than guess at a day no rate reaches, the
 * amount is left out — so the screen has to say so, or the total would quietly be wrong.
 */
export function Unconverted({ missing, currency }: { missing: readonly { currency: string; onDate: string }[]; currency: string }) {
  if (missing.length === 0) return null;
  return (
    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900" data-testid="unconverted">
      {missing.length} amount{missing.length === 1 ? '' : 's'} in {missing.map((m) => m.currency).join(', ')} are not counted: no{' '}
      {missing[0]!.currency}→{currency} rate for {shortDate(missing[0]!.onDate, isoDate())} or earlier. Use Add transaction to enter one.
    </p>
  );
}
