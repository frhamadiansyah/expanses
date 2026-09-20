import { formatMinor } from '@expanses/core';

/**
 * What a grouped inset list works out for itself: where its separators go, and what its header says.
 *
 * The header sitting **outside and above** the group is the single most recognisable difference from the app
 * today, where a section title sits inside a ringed card. That is a matter of where a component puts a `<h2>`,
 * so it is not decided here — what is decided here is the arithmetic the group cannot get wrong twice.
 */

export interface RowPosition {
  first: boolean;
  last: boolean;
  /** Whether a hairline is drawn above this row. Never above the first: the group's own edge is the line. */
  separator: boolean;
}

/** Where each of `count` rows sits in its group. */
export function rowPositions(count: number): RowPosition[] {
  return Array.from({ length: count }, (_, index) => ({
    first: index === 0,
    last: index === count - 1,
    separator: index > 0,
  }));
}

export interface HeaderProgress {
  spentMinor: number;
  budgetMinor: number;
  currency: string;
}

export interface GroupHeader {
  /** The title. Drawn uppercase by CSS, so the string keeps its real casing for a screen reader. */
  label: string;
  /** The figure that rides on the header, or null when the header is only a name. */
  trailing: string | null;
}

/**
 * A group's header, with the figure it may carry: `Travel · Rp 12.400.000 of Rp 14.000.000`.
 *
 * The money goes through `formatMinor`, which emits a no-break space after `Rp` — so the symbol can never be
 * left stranded at the end of a line from its own figure — and gives IDR no decimal places.
 */
export function groupHeader(title: string, progress?: HeaderProgress): GroupHeader {
  if (!progress) return { label: title, trailing: null };
  const spent = formatMinor(progress.spentMinor, progress.currency);
  const budget = formatMinor(progress.budgetMinor, progress.currency);
  return { label: title, trailing: `${spent} of ${budget}` };
}
