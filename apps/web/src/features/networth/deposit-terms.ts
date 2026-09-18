/**
 * What a time deposit's terms read as, in one line.
 *
 * The maturity and the rate are asked for when the deposit is opened, and until now nothing ever said them
 * back. They are the two facts that make a deposit a deposit — the day the money comes back, and what it pays
 * for waiting — so the account's own page prints them, and so does its row on Accounts.
 */

/** The day in the words a date is said in — "1 Mar 2027", not "2027-03-01". */
export function maturityLabel(maturesOn: string): string {
  const date = new Date(`${maturesOn}T00:00:00`);
  if (Number.isNaN(date.getTime())) return maturesOn;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A rate held in basis points, said the way the form asks for it: 625 is "6,25%". */
export const rateLabel = (rateBps: number): string => `${(rateBps / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;

/** The short line for a deposit. A rate of zero is left off: nobody typed one, so there is nothing to say. */
export function depositLine(terms: { maturesOn: string; rateBps: number }): string {
  const matures = `Matures ${maturityLabel(terms.maturesOn)}`;
  return terms.rateBps > 0 ? `${matures} · ${rateLabel(terms.rateBps)}` : matures;
}
